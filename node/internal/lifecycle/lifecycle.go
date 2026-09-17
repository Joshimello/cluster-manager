package lifecycle

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/Joshimello/cluster-manager/node/internal/config"
	"github.com/Joshimello/cluster-manager/node/internal/controlplane"
	"github.com/Joshimello/cluster-manager/node/internal/credential"
	"github.com/Joshimello/cluster-manager/node/internal/reconcile"
	"golang.org/x/term"
)

const (
	Repository         = "Joshimello/cluster-manager"
	ManagedStatePath   = "/var/lib/cluster-manager/managed-state.json"
	defaultReleaseAPI  = "https://api.github.com/repos/" + Repository
	defaultReleaseBase = "https://github.com/" + Repository + "/releases/download"
)

type Paths struct {
	Config, Credential, State, Binary, Unit, OldBinary, OldUnit, SSHPolicy string
}

func DefaultPaths() Paths {
	return Paths{
		Config:     config.DefaultPath,
		Credential: "/var/lib/cluster-manager/node-credential",
		State:      ManagedStatePath,
		Binary:     "/usr/local/sbin/cluster-node",
		Unit:       "/etc/systemd/system/cluster-node.service",
		OldBinary:  "/usr/local/sbin/cluster-manager-node",
		OldUnit:    "/etc/systemd/system/cluster-manager-node.service",
		SSHPolicy:  "/etc/ssh/sshd_config.d/60-cluster-manager.conf",
	}
}

type Manager struct {
	Paths       Paths
	Version     string
	In          io.Reader
	Out         io.Writer
	Err         io.Writer
	HTTPClient  *http.Client
	ReleaseAPI  string
	ReleaseBase string
	input       *bufio.Reader
}

func New(version string, in io.Reader, out, errOut io.Writer) *Manager {
	return &Manager{Paths: DefaultPaths(), Version: version, In: in, Out: out, Err: errOut, HTTPClient: &http.Client{Timeout: 30 * time.Second}, ReleaseAPI: defaultReleaseAPI, ReleaseBase: defaultReleaseBase, input: bufio.NewReader(in)}
}

type SetupOptions struct{ PlatformURL, Name, EnrollmentTokenFile string }

func (m *Manager) Setup(ctx context.Context, options SetupOptions) error {
	if err := requireRoot(); err != nil {
		return err
	}
	if err := validateHost(ctx); err != nil {
		return err
	}
	platformURL, err := m.setupPlatformURL(ctx, options.PlatformURL)
	if err != nil {
		return err
	}
	name, err := m.setupWorkstationName(ctx, options.Name)
	if err != nil {
		return err
	}
	cfg := config.Config{PlatformURL: platformURL, WorkstationName: name, CredentialFile: m.Paths.Credential, HeartbeatInterval: 15 * time.Second, SimulationScenario: "normal"}
	if err := cfg.Validate(); err != nil {
		return err
	}
	if err := m.ensurePackages(ctx); err != nil {
		return err
	}
	if err := command(ctx, "sshd", "-t"); err != nil {
		return fmt.Errorf("OpenSSH validation failed: %w", err)
	}
	if err := command(ctx, "nvidia-smi"); err != nil {
		return fmt.Errorf("NVIDIA validation failed (drivers remain operator-managed): %w", err)
	}
	token, err := m.readToken(ctx, options.EnrollmentTokenFile)
	if err != nil {
		return err
	}
	nodeCredential, err := credential.Load(m.Paths.Credential)
	if err != nil {
		if !errors.Is(errors.Unwrap(err), os.ErrNotExist) {
			return err
		}
		nodeCredential, err = credential.Generate()
		if err != nil {
			return err
		}
		if err := credential.Write(m.Paths.Credential, nodeCredential); err != nil {
			return err
		}
	}
	enrollment, err := controlplane.New(cfg.PlatformURL).Enroll(ctx, cfg.WorkstationName, token, nodeCredential)
	if err != nil {
		return fmt.Errorf("enroll workstation: %w", err)
	}
	if err := config.Write(m.Paths.Config, cfg); err != nil {
		return err
	}
	if err := m.installSelf(); err != nil {
		return err
	}
	if err := atomicWrite(m.Paths.Unit, []byte(ServiceUnit), 0o644); err != nil {
		return err
	}
	if err := command(ctx, "systemctl", "daemon-reload"); err != nil {
		return err
	}
	legacyWasActive := exec.CommandContext(ctx, "systemctl", "is-active", "--quiet", "cluster-manager-node.service").Run() == nil
	if legacyWasActive {
		if err := command(ctx, "systemctl", "stop", "cluster-manager-node.service"); err != nil {
			return err
		}
	}
	if err := command(ctx, "systemctl", "enable", "--now", "cluster-node.service"); err != nil {
		if legacyWasActive {
			_ = command(ctx, "systemctl", "start", "cluster-manager-node.service")
		}
		return fmt.Errorf("start cluster-node.service: %w", err)
	}
	if err := m.removeLegacy(ctx); err != nil {
		return err
	}
	fmt.Fprintf(m.Out, "Enrolled %s (%s) and started cluster-node.service.\n", enrollment.Name, enrollment.WorkstationID)
	return nil
}

func (m *Manager) Status(ctx context.Context) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	state := "unknown"
	if output, runErr := exec.CommandContext(ctx, "systemctl", "is-active", "cluster-node.service").Output(); runErr == nil {
		state = strings.TrimSpace(string(output))
	} else if len(output) > 0 {
		state = strings.TrimSpace(string(output))
	}
	fmt.Fprintf(m.Out, "Version: %s\nService: %s\nWorkstation: %s\nPlatform: %s\n", m.Version, state, cfg.WorkstationName, cfg.PlatformURL)
	for _, item := range []struct{ label, path string }{{"Configuration", m.Paths.Config}, {"Credential", cfg.CredentialFile}, {"Provenance ledger", m.Paths.State}} {
		if info, statErr := os.Stat(item.path); statErr == nil {
			fmt.Fprintf(m.Out, "%s: %s (%04o)\n", item.label, item.path, info.Mode().Perm())
		} else {
			fmt.Fprintf(m.Out, "%s: %s (missing)\n", item.label, item.path)
		}
	}
	return nil
}

func (m *Manager) Doctor(ctx context.Context) error {
	if err := m.Status(ctx); err != nil {
		return fmt.Errorf("configuration: %w", err)
	}
	cfg, _ := config.Load()
	nodeCredential, err := credential.Load(cfg.CredentialFile)
	if err != nil {
		return err
	}
	checks := []struct {
		name string
		fn   func() error
	}{
		{"platform authentication", func() error {
			_, err := controlplane.New(cfg.PlatformURL).DesiredState(ctx, nodeCredential)
			return err
		}},
		{"sshd configuration", func() error { return command(ctx, "sshd", "-t") }},
		{"service state", func() error { return command(ctx, "systemctl", "is-active", "--quiet", "cluster-node.service") }},
		{"systemd unit", func() error { return command(ctx, "systemd-analyze", "verify", m.Paths.Unit) }},
		{"NVIDIA", func() error { return command(ctx, "nvidia-smi") }},
	}
	for _, check := range checks {
		if err := check.fn(); err != nil {
			return fmt.Errorf("%s check failed: %w", check.name, err)
		}
		fmt.Fprintf(m.Out, "OK: %s\n", check.name)
	}
	policy, err := os.ReadFile(m.Paths.SSHPolicy)
	if err == nil && string(policy) != reconcile.SSHPolicy() {
		return errors.New("managed SSH policy is modified")
	}
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("read managed SSH policy: %w", err)
	}
	permissionPaths := []string{m.Paths.Config, cfg.CredentialFile}
	if _, statErr := os.Stat(m.Paths.State); statErr == nil {
		permissionPaths = append(permissionPaths, m.Paths.State)
	}
	for _, path := range permissionPaths {
		info, err := os.Stat(path)
		if err != nil || info.Mode().Perm() != 0o600 {
			return fmt.Errorf("%s must exist with mode 0600", path)
		}
	}
	if errors.Is(err, os.ErrNotExist) {
		fmt.Fprintln(m.Out, "OK: managed SSH policy not needed until the first account is created")
	} else {
		fmt.Fprintln(m.Out, "OK: managed SSH policy")
	}
	fmt.Fprintln(m.Out, "OK: state permissions")
	return nil
}

func (m *Manager) ReEnroll(ctx context.Context, tokenFile string) error {
	if err := requireRoot(); err != nil {
		return err
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	token, err := m.readToken(ctx, tokenFile)
	if err != nil {
		return err
	}
	_ = command(ctx, "systemctl", "stop", "cluster-node.service")
	restart := true
	defer func() {
		if restart {
			_ = command(context.Background(), "systemctl", "start", "cluster-node.service")
		}
	}()
	newCredential, err := credential.Generate()
	if err != nil {
		return err
	}
	if _, err := controlplane.New(cfg.PlatformURL).Enroll(ctx, cfg.WorkstationName, token, newCredential); err != nil {
		return fmt.Errorf("re-enrollment failed; existing credential retained: %w", err)
	}
	if err := credential.Write(cfg.CredentialFile, newCredential); err != nil {
		return err
	}
	if err := command(ctx, "systemctl", "start", "cluster-node.service"); err != nil {
		return err
	}
	restart = false
	fmt.Fprintln(m.Out, "Node credential replaced and cluster-node.service restarted.")
	return nil
}

func (m *Manager) Upgrade(ctx context.Context, requestedVersion string) error {
	if err := requireRoot(); err != nil {
		return err
	}
	version := requestedVersion
	if version == "" {
		var err error
		version, err = m.latestVersion(ctx)
		if err != nil {
			return err
		}
	}
	if !validVersion(version) {
		return fmt.Errorf("invalid release version %q", version)
	}
	arch, err := releaseArchitecture(runtime.GOARCH)
	if err != nil {
		return err
	}
	asset := "cluster-node-linux-" + arch
	base := strings.TrimRight(m.ReleaseBase, "/") + "/" + version
	checksums, err := m.download(ctx, base+"/checksums.txt", 1<<20)
	if err != nil {
		return err
	}
	expected, err := checksumFor(checksums, asset)
	if err != nil {
		return err
	}
	binary, err := m.download(ctx, base+"/"+asset, 256<<20)
	if err != nil {
		return err
	}
	actual := sha256.Sum256(binary)
	if hex.EncodeToString(actual[:]) != expected {
		return errors.New("downloaded binary SHA-256 does not match checksums.txt")
	}
	if err := atomicWrite(m.Paths.Binary, binary, 0o755); err != nil {
		return err
	}
	if err := atomicWrite(m.Paths.Unit, []byte(ServiceUnit), 0o644); err != nil {
		return err
	}
	legacyWasActive := exec.CommandContext(ctx, "systemctl", "is-active", "--quiet", "cluster-manager-node.service").Run() == nil
	if legacyWasActive {
		if err := command(ctx, "systemctl", "stop", "cluster-manager-node.service"); err != nil {
			return err
		}
	}
	if err := command(ctx, "systemctl", "daemon-reload"); err != nil {
		return err
	}
	if err := command(ctx, "systemctl", "enable", "--now", "cluster-node.service"); err != nil {
		if legacyWasActive {
			_ = command(ctx, "systemctl", "start", "cluster-manager-node.service")
		}
		return err
	}
	if err := m.removeLegacy(ctx); err != nil {
		return err
	}
	fmt.Fprintf(m.Out, "Upgraded cluster-node to %s.\n", version)
	return nil
}

func (m *Manager) latestVersion(ctx context.Context) (string, error) {
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, m.ReleaseAPI+"/releases/latest", nil)
	response, err := m.HTTPClient.Do(request)
	if err != nil {
		return "", fmt.Errorf("query latest release: %w", err)
	}
	defer response.Body.Close()
	var release struct {
		Tag        string `json:"tag_name"`
		Prerelease bool   `json:"prerelease"`
	}
	if response.StatusCode != http.StatusOK || json.NewDecoder(response.Body).Decode(&release) != nil || release.Prerelease || !validVersion(release.Tag) {
		return "", errors.New("latest stable release could not be selected")
	}
	return release.Tag, nil
}

func (m *Manager) Uninstall(ctx context.Context, dryRun, purge bool) error {
	if err := requireRoot(); err != nil {
		return err
	}
	var managed reconcile.ManagedState
	if purge {
		var err error
		managed, err = reconcile.LoadManagedState(m.Paths.State)
		if err != nil {
			return fmt.Errorf("purge requires a valid provenance ledger: %w", err)
		}
		if err := m.printPurgeScan(ctx, managed); err != nil {
			return err
		}
	}
	if dryRun {
		fmt.Fprintln(m.Out, "Dry run only; no files, services, or users were changed.")
		return nil
	}
	for _, service := range []string{"cluster-node.service", "cluster-manager-node.service"} {
		_ = command(ctx, "systemctl", "stop", service)
	}
	if purge {
		hostname, _ := os.Hostname()
		input, terminal := m.In.(*os.File)
		if !terminal || !term.IsTerminal(int(input.Fd())) {
			return errors.New("destructive uninstall confirmation requires an interactive terminal")
		}
		answer, err := m.value(ctx, "", "Type DELETE "+hostname+" to delete the listed users")
		if err != nil || answer != "DELETE "+hostname {
			return errors.New("destructive uninstall cancelled")
		}
		if err := m.printPurgeScan(ctx, managed); err != nil {
			return fmt.Errorf("activity changed before deletion: %w", err)
		}
		for username := range managed.Users {
			if err := command(ctx, "userdel", "--remove", username); err != nil {
				return fmt.Errorf("delete %s failed; stop and inspect the host before retrying: %w", username, err)
			}
			record := managed.Users[username]
			if record.GroupCreated {
				group, lookupErr := user.LookupGroup(record.PrimaryGroup)
				if lookupErr == nil {
					gid, gidErr := strconv.Atoi(group.Gid)
					if gidErr != nil || gid != record.GID || group.Name != record.PrimaryGroup {
						return fmt.Errorf("private group %s differs from provenance after deleting %s; preserve it and inspect manually", record.PrimaryGroup, username)
					}
					if err := command(ctx, "groupdel", record.PrimaryGroup); err != nil {
						return fmt.Errorf("delete private group %s failed after deleting %s: %w", record.PrimaryGroup, username, err)
					}
				} else {
					var unknown user.UnknownGroupError
					if !errors.As(lookupErr, &unknown) {
						return fmt.Errorf("inspect private group %s: %w", record.PrimaryGroup, lookupErr)
					}
				}
			}
		}
		if err := m.removeUnusedPolicy(ctx); err != nil {
			return err
		}
		if err := os.Remove(m.Paths.State); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	for _, service := range []string{"cluster-node.service", "cluster-manager-node.service"} {
		_ = command(ctx, "systemctl", "disable", "--now", service)
	}
	for _, path := range []string{m.Paths.Config, m.Paths.Credential, m.Paths.Unit, m.Paths.OldUnit, m.Paths.Binary, m.Paths.OldBinary} {
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("remove %s: %w", path, err)
		}
	}
	_ = command(ctx, "systemctl", "daemon-reload")
	fmt.Fprintln(m.Out, "Local node software removed. Revoke or disable this workstation in the platform.")
	if !purge {
		fmt.Fprintln(m.Out, "Linux users, homes, SSH policy, subordinate IDs, managed group, and provenance ledger were retained.")
	}
	return nil
}

func (m *Manager) printPurgeScan(ctx context.Context, state reconcile.ManagedState) error {
	fmt.Fprintln(m.Out, "Eligible provenance-confirmed users:")
	for username, record := range state.Users {
		account, err := user.Lookup(username)
		if err != nil {
			return fmt.Errorf("managed user %s is missing or unreadable", username)
		}
		uid, _ := strconv.Atoi(account.Uid)
		gid, _ := strconv.Atoi(account.Gid)
		if uid != record.UID || gid != record.GID || account.HomeDir != record.HomeDirectory {
			return fmt.Errorf("managed user %s identity differs from provenance; refusing purge", username)
		}
		group, groupErr := user.LookupGroup(record.PrimaryGroup)
		if groupErr != nil {
			return fmt.Errorf("managed private group %s is missing or unreadable", record.PrimaryGroup)
		}
		groupGID, groupGIDErr := strconv.Atoi(group.Gid)
		if groupGIDErr != nil || groupGID != record.GID || group.Name != record.PrimaryGroup {
			return fmt.Errorf("managed private group %s differs from provenance; refusing purge", record.PrimaryGroup)
		}
		if err := verifyRecordedRange("/etc/subuid", username, record.SubordinateUID); err != nil {
			return err
		}
		if err := verifyRecordedRange("/etc/subgid", username, record.SubordinateGID); err != nil {
			return err
		}
		processes := nonemptyLines(commandOutput(ctx, "pgrep", "-u", username))
		sessions := strings.TrimSpace(commandOutput(ctx, "loginctl", "list-sessions", "--no-legend"))
		sessionCount := sessionCountForUser(sessions, username)
		mounts := mountsUnder(record.HomeDirectory)
		size := strings.TrimSpace(commandOutput(ctx, "du", "-sh", record.HomeDirectory))
		fmt.Fprintf(m.Out, "- %s uid=%d gid=%d home=%s size=%s sessions=%d processes=%d mounts=%s\n", username, uid, gid, record.HomeDirectory, size, sessionCount, len(processes), printableMounts(mounts))
		if len(processes) > 0 || sessionCount > 0 || len(mounts) > 0 {
			return fmt.Errorf("%s has active sessions, processes, or home mounts; no changes made", username)
		}
	}
	fmt.Fprintf(m.Out, "Preserved unowned managed-group users: %s\n", strings.Join(unownedGroupMembers(state), ", "))
	fmt.Fprintln(m.Out, "All other usernames absent from the provenance ledger are also preserved.")
	return nil
}

func (m *Manager) removeUnusedPolicy(ctx context.Context) error {
	group, err := user.LookupGroup("cluster-manager-users")
	if err == nil {
		members := strings.TrimSpace(commandOutput(ctx, "getent", "group", group.Name))
		parts := strings.Split(members, ":")
		if len(parts) >= 4 && strings.TrimSpace(parts[3]) != "" {
			fmt.Fprintln(m.Out, "Preserved managed group and SSH policy because unremoved accounts depend on them.")
			return nil
		}
		if err := command(ctx, "groupdel", group.Name); err != nil {
			return err
		}
	}
	contents, err := os.ReadFile(m.Paths.SSHPolicy)
	if err == nil && string(contents) == reconcile.SSHPolicy() {
		if err := os.Remove(m.Paths.SSHPolicy); err != nil {
			return err
		}
	} else if err == nil {
		fmt.Fprintln(m.Out, "Preserved modified SSH policy for manual review.")
	}
	return nil
}

func (m *Manager) removeLegacy(ctx context.Context) error {
	if _, err := os.Stat(m.Paths.OldUnit); err == nil {
		_ = command(ctx, "systemctl", "disable", "--now", "cluster-manager-node.service")
	}
	for _, path := range []string{m.Paths.OldUnit, m.Paths.OldBinary} {
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("remove legacy path %s: %w", path, err)
		}
	}
	return command(ctx, "systemctl", "daemon-reload")
}

func (m *Manager) installSelf() error {
	source, err := os.Executable()
	if err != nil {
		return err
	}
	if sameFile(source, m.Paths.Binary) {
		return nil
	}
	contents, err := os.ReadFile(source)
	if err != nil {
		return err
	}
	return atomicWrite(m.Paths.Binary, contents, 0o755)
}

func (m *Manager) ensurePackages(ctx context.Context) error {
	missing := []string{}
	for _, name := range []string{"openssh-server", "uidmap"} {
		output, err := exec.CommandContext(ctx, "dpkg-query", "-W", "-f=${Status}", name).CombinedOutput()
		if err != nil || strings.TrimSpace(string(output)) != "install ok installed" {
			missing = append(missing, name)
		}
	}
	if len(missing) == 0 {
		return nil
	}
	fmt.Fprintf(m.Out, "Missing required packages: %s\n", strings.Join(missing, ", "))
	answer, err := m.value(ctx, "", "Install them with apt? [y/N]")
	if err != nil || !strings.EqualFold(answer, "y") {
		return errors.New("required package installation declined")
	}
	if err := command(ctx, "apt-get", "update"); err != nil {
		return err
	}
	return command(ctx, "apt-get", append([]string{"install", "-y"}, missing...)...)
}

type inputResult struct {
	value string
	err   error
}

func (m *Manager) setupPlatformURL(ctx context.Context, existing string) (string, error) {
	interactive := strings.TrimSpace(existing) == ""
	for {
		value, err := m.value(ctx, existing, "Platform URL")
		if err != nil {
			return "", err
		}
		value = strings.TrimRight(strings.TrimSpace(value), "/")
		if err := config.ValidatePlatformURL(value, false); err == nil {
			return value, nil
		} else if !interactive {
			return "", fmt.Errorf("platform URL %w", err)
		} else {
			fmt.Fprintf(m.Out, "Invalid platform URL: %v. Please try again.\n", err)
			existing = ""
		}
	}
}

func (m *Manager) setupWorkstationName(ctx context.Context, existing string) (string, error) {
	interactive := strings.TrimSpace(existing) == ""
	for {
		value, err := m.value(ctx, existing, "Workstation name")
		if err != nil {
			return "", err
		}
		value = strings.ToLower(strings.TrimSpace(value))
		if err := config.ValidateWorkstationName(value); err == nil {
			return value, nil
		} else if !interactive {
			return "", fmt.Errorf("workstation name %w", err)
		} else {
			fmt.Fprintf(m.Out, "Invalid workstation name: %v. Please try again.\n", err)
			existing = ""
		}
	}
}

func (m *Manager) value(ctx context.Context, existing, prompt string) (string, error) {
	if value := strings.TrimSpace(existing); value != "" {
		return value, nil
	}
	fmt.Fprintf(m.Out, "%s: ", prompt)
	return m.readLine(ctx)
}

func (m *Manager) readLine(ctx context.Context) (string, error) {
	result := make(chan inputResult, 1)
	go func() {
		line, err := m.input.ReadString('\n')
		if errors.Is(err, io.EOF) && line != "" {
			err = nil
		}
		result <- inputResult{value: strings.TrimSpace(line), err: err}
	}()
	select {
	case <-ctx.Done():
		return "", ctx.Err()
	case result := <-result:
		if errors.Is(result.err, io.EOF) {
			return "", errors.New("input ended")
		}
		return result.value, result.err
	}
}

func (m *Manager) readToken(ctx context.Context, path string) (string, error) {
	if path != "" {
		info, err := os.Lstat(path)
		if err != nil {
			return "", err
		}
		stat, ok := info.Sys().(*syscall.Stat_t)
		if !info.Mode().IsRegular() || !ok || stat.Uid != 0 || info.Mode().Perm()&0o077 != 0 {
			return "", errors.New("enrollment token file must be a regular, root-owned file inaccessible by group or other users")
		}
		contents, err := os.ReadFile(path)
		return strings.TrimSpace(string(contents)), err
	}
	fmt.Fprint(m.Out, "Enrollment token: ")
	if file, ok := m.In.(*os.File); ok && term.IsTerminal(int(file.Fd())) {
		fd := int(file.Fd())
		state, _ := term.GetState(fd)
		result := make(chan inputResult, 1)
		go func() {
			contents, err := term.ReadPassword(fd)
			result <- inputResult{value: strings.TrimSpace(string(contents)), err: err}
		}()
		select {
		case <-ctx.Done():
			if state != nil {
				_ = term.Restore(fd, state)
			}
			fmt.Fprintln(m.Out)
			return "", ctx.Err()
		case result := <-result:
			fmt.Fprintln(m.Out)
			return result.value, result.err
		}
	}
	return m.readLine(ctx)
}

func (m *Manager) download(ctx context.Context, url string, limit int64) ([]byte, error) {
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	response, err := m.HTTPClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("download %s: %w", url, err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("download %s returned %s", url, response.Status)
	}
	return io.ReadAll(io.LimitReader(response.Body, limit))
}

func checksumFor(contents []byte, asset string) (string, error) {
	for _, line := range strings.Split(string(contents), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && strings.TrimPrefix(fields[1], "*") == asset {
			if _, err := hex.DecodeString(fields[0]); err == nil && len(fields[0]) == 64 {
				return strings.ToLower(fields[0]), nil
			}
		}
	}
	return "", fmt.Errorf("checksums.txt has no valid SHA-256 for %s", asset)
}

func releaseArchitecture(value string) (string, error) {
	switch value {
	case "amd64":
		return "amd64", nil
	case "arm64":
		return "arm64", nil
	default:
		return "", fmt.Errorf("unsupported architecture %q", value)
	}
}

func validVersion(value string) bool {
	if len(value) < 2 || value[0] != 'v' {
		return false
	}
	for _, character := range value[1:] {
		if (character < '0' || character > '9') && character != '.' && character != '-' && character != '+' && (character < 'a' || character > 'z') && (character < 'A' || character > 'Z') {
			return false
		}
	}
	return true
}

func validateHost(ctx context.Context) error {
	if runtime.GOOS != "linux" || (runtime.GOARCH != "amd64" && runtime.GOARCH != "arm64") {
		return fmt.Errorf("cluster-node setup supports Ubuntu Linux amd64 and arm64")
	}
	contents, err := os.ReadFile("/etc/os-release")
	if err != nil || !strings.Contains(string(contents), "ID=ubuntu") {
		return errors.New("Ubuntu 24.04 or newer is required")
	}
	version := osReleaseValue(string(contents), "VERSION_ID")
	major, _ := strconv.Atoi(strings.Split(version, ".")[0])
	if major < 24 {
		return errors.New("Ubuntu 24.04 or newer is required")
	}
	if err := command(ctx, "systemctl", "--version"); err != nil {
		return errors.New("systemd is required")
	}
	return nil
}

func osReleaseValue(contents, key string) string {
	for _, line := range strings.Split(contents, "\n") {
		if strings.HasPrefix(line, key+"=") {
			return strings.Trim(strings.TrimPrefix(line, key+"="), "\"")
		}
	}
	return ""
}

func requireRoot() error {
	if os.Geteuid() != 0 {
		return errors.New("this command must be run as root")
	}
	return nil
}

func atomicWrite(path string, contents []byte, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	temporary := path + ".new"
	if err := os.WriteFile(temporary, contents, mode); err != nil {
		return err
	}
	if err := os.Chmod(temporary, mode); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	return nil
}

func command(ctx context.Context, name string, args ...string) error {
	cmd := exec.CommandContext(ctx, name, args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s %s: %w: %s", name, strings.Join(args, " "), err, strings.TrimSpace(string(output)))
	}
	return nil
}

func commandOutput(ctx context.Context, name string, args ...string) string {
	output, _ := exec.CommandContext(ctx, name, args...).CombinedOutput()
	return string(output)
}

func sameFile(left, right string) bool {
	a, errA := os.Stat(left)
	b, errB := os.Stat(right)
	return errA == nil && errB == nil && os.SameFile(a, b)
}

func mountsUnder(home string) []string {
	contents, _ := os.ReadFile("/proc/mounts")
	result := []string{}
	for _, line := range strings.Split(string(contents), "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 2 && (fields[1] == home || strings.HasPrefix(fields[1], strings.TrimRight(home, "/")+"/")) {
			result = append(result, fields[1])
		}
	}
	return result
}

func sessionCountForUser(output, username string) int {
	count := 0
	for _, line := range strings.Split(output, "\n") {
		for _, field := range strings.Fields(line) {
			if field == username {
				count++
				break
			}
		}
	}
	return count
}

func nonemptyLines(output string) []string {
	result := []string{}
	for _, line := range strings.Split(strings.TrimSpace(output), "\n") {
		if strings.TrimSpace(line) != "" {
			result = append(result, line)
		}
	}
	return result
}

func printableMounts(mounts []string) string {
	if len(mounts) == 0 {
		return "none"
	}
	return strings.Join(mounts, ",")
}

func unownedGroupMembers(state reconcile.ManagedState) []string {
	group, err := user.LookupGroup("cluster-manager-users")
	if err != nil {
		return []string{"none"}
	}
	parts := strings.Split(strings.TrimSpace(commandOutput(context.Background(), "getent", "group", group.Name)), ":")
	if len(parts) < 4 || strings.TrimSpace(parts[3]) == "" {
		return []string{"none"}
	}
	result := []string{}
	for _, name := range strings.Split(parts[3], ",") {
		if _, owned := state.Users[name]; !owned {
			result = append(result, name)
		}
	}
	if len(result) == 0 {
		return []string{"none"}
	}
	return result
}

func verifyRecordedRange(path, username string, recorded *reconcile.IDRange) error {
	contents, err := os.ReadFile(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	lines := []string{}
	for _, line := range strings.Split(string(contents), "\n") {
		if strings.HasPrefix(line, username+":") {
			lines = append(lines, line)
		}
	}
	if recorded == nil && len(lines) == 0 {
		return nil
	}
	want := ""
	if recorded != nil {
		want = fmt.Sprintf("%s:%d:%d", username, recorded.Start, recorded.Count)
	}
	if len(lines) != 1 || lines[0] != want {
		return fmt.Errorf("%s contains modified or unrecognized ranges for %s; preserving it and refusing purge", path, username)
	}
	return nil
}

// ServiceUnit is installed verbatim by setup and upgrade.
const ServiceUnit = `[Unit]
Description=Cluster Manager workstation node
After=network-online.target ssh.service
Wants=network-online.target

[Service]
Type=simple
User=root
Group=root
ExecStart=/usr/local/sbin/cluster-node run
Restart=on-failure
RestartSec=5s
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
ProtectClock=true
ProtectHostname=true
ProtectKernelLogs=true
LockPersonality=true
RestrictRealtime=true
RestrictNamespaces=true
RestrictSUIDSGID=true
RemoveIPC=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
SystemCallArchitectures=native

[Install]
WantedBy=multi-user.target
`
