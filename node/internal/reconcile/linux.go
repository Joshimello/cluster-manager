package reconcile

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/Joshimello/cluster-manager/node/internal/protocol"
)

const (
	managedGroup = "cluster-manager-users"
	sshPolicy    = "# Managed by cluster-node\nMatch Group " + managedGroup + "\n    PasswordAuthentication yes\n    PubkeyAuthentication no\n    AuthenticationMethods password\n"
)

func SSHPolicy() string { return sshPolicy }

type Linux struct {
	workstationName  string
	managedStatePath string
}

func NewLinux(workstationName string) *Linux {
	return NewLinuxWithStatePath(workstationName, defaultManagedStatePath)
}

func NewLinuxWithStatePath(workstationName, managedStatePath string) *Linux {
	return &Linux{workstationName: workstationName, managedStatePath: managedStatePath}
}

func (l *Linux) Apply(ctx context.Context, state protocol.DesiredState) ([]protocol.ReconciliationResult, error) {
	if err := Validate(state, l.workstationName); err != nil {
		return nil, err
	}
	if os.Geteuid() != 0 {
		return nil, errors.New("Linux reconciliation requires root")
	}
	managedState, err := loadManagedState(l.managedStatePath)
	if err != nil {
		return nil, err
	}
	managedState.WorkstationID = state.Workstation.ID
	managedState.WorkstationName = state.Workstation.Name

	results := make([]protocol.ReconciliationResult, 0, len(state.Users))
	for _, desired := range state.Users {
		message, errorCode, err := l.applyUser(ctx, &managedState, desired)
		if err != nil {
			results = append(results, result(desired, "error", err.Error(), errorCode))
			continue
		}
		results = append(results, result(desired, "applied", message))
	}
	return results, nil
}

func (l *Linux) applyUser(ctx context.Context, state *ManagedState, desired protocol.DesiredUser) (string, string, error) {
	account, err := user.Lookup(desired.Username)
	if err != nil && !unknownUser(err) {
		return "", "local_apply_failed", fmt.Errorf("look up Linux account: %w", err)
	}
	managed, recorded := state.Users[desired.Username]
	owned := recorded && managed.WorkstationID == state.WorkstationID && managed.WorkstationName == state.WorkstationName
	if !owned && account != nil {
		return "", "username_collision", fmt.Errorf("Linux username %q already exists and is not owned by Cluster Manager; no local ownership or credential data was changed (including password, groups, home ownership, SSH policy, and subordinate IDs)", desired.Username)
	}
	if recorded && !owned && account == nil && desired.Enabled {
		return "", "username_collision", fmt.Errorf("Linux username %q has retained provenance from another workstation identity; no local ownership or credential data was changed", desired.Username)
	}
	if owned {
		if account == nil {
			return "", "managed_identity_mismatch", fmt.Errorf("managed Linux account %q is missing; it was not recreated automatically", desired.Username)
		}
		uid, uidErr := strconv.Atoi(account.Uid)
		gid, gidErr := strconv.Atoi(account.Gid)
		if uidErr != nil || gidErr != nil || uid != managed.UID || gid != managed.GID || account.HomeDir != managed.HomeDirectory {
			return "", "managed_identity_mismatch", fmt.Errorf("managed Linux account %q no longer matches its recorded UID, GID, or home; no changes were made", desired.Username)
		}
	}
	if !desired.Enabled {
		if account == nil {
			return "Login disabled; no local account or data was removed.", "", nil
		}
		if err := run(ctx, "", "usermod", "--lock", desired.Username); err != nil {
			return "", "local_apply_failed", fmt.Errorf("disable login: %w", err)
		}
		return "Login disabled; home data preserved.", "", nil
	}

	if account == nil {
		if err := ensureGroup(ctx); err != nil {
			return "", "local_apply_failed", err
		}
		if err := ensureSSHPolicy(ctx); err != nil {
			return "", "local_apply_failed", err
		}
		if err := run(ctx, "", "useradd", "--create-home", "--shell", "/bin/bash", "--groups", managedGroup, desired.Username); err != nil {
			if existing, lookupErr := user.Lookup(desired.Username); lookupErr == nil && existing != nil {
				return "", "username_collision", fmt.Errorf("Linux username %q appeared while the account was being created and is not trusted; no local ownership or credential data was changed", desired.Username)
			}
			return "", "local_apply_failed", fmt.Errorf("create Linux account: %w", err)
		}
		account, err = user.Lookup(desired.Username)
		if err != nil {
			return "", "local_apply_failed", fmt.Errorf("look up created Linux account: %w", err)
		}
		uid, uidErr := strconv.Atoi(account.Uid)
		gid, gidErr := strconv.Atoi(account.Gid)
		if uidErr != nil || gidErr != nil {
			return "", "local_apply_failed", fmt.Errorf("parse created account identity")
		}
		managed = ManagedUser{Username: desired.Username, AssignmentID: desired.AssignmentID, WorkstationID: state.WorkstationID, WorkstationName: state.WorkstationName, UID: uid, GID: gid, HomeDirectory: account.HomeDir, GroupAdded: true, CreatedAt: time.Now().UTC()}
		state.Users[desired.Username] = managed
		if err := saveManagedState(l.managedStatePath, *state); err != nil {
			return "", "local_apply_failed", err
		}
	} else {
		if err := ensureGroup(ctx); err != nil {
			return "", "local_apply_failed", err
		}
		if err := ensureSSHPolicy(ctx); err != nil {
			return "", "local_apply_failed", err
		}
		if err := run(ctx, "", "usermod", "--append", "--groups", managedGroup, desired.Username); err != nil {
			return "", "local_apply_failed", fmt.Errorf("restore managed account group: %w", err)
		}
	}

	uid, err := strconv.Atoi(account.Uid)
	if err != nil {
		return "", "local_apply_failed", fmt.Errorf("parse account UID: %w", err)
	}
	gid, err := strconv.Atoi(account.Gid)
	if err != nil {
		return "", "local_apply_failed", fmt.Errorf("parse account GID: %w", err)
	}
	if err := os.MkdirAll(account.HomeDir, 0o700); err != nil {
		return "", "local_apply_failed", fmt.Errorf("create home directory: %w", err)
	}
	if err := os.Chown(account.HomeDir, uid, gid); err != nil {
		return "", "local_apply_failed", fmt.Errorf("set home ownership: %w", err)
	}
	uidRange, gidRange, err := ensureSubordinateIDs(ctx, desired.Username)
	if err != nil {
		return "", "local_apply_failed", err
	}
	managed = state.Users[desired.Username]
	managed.AssignmentID = desired.AssignmentID
	if managed.SubordinateUID == nil {
		managed.SubordinateUID = uidRange
	}
	if managed.SubordinateGID == nil {
		managed.SubordinateGID = gidRange
	}
	state.Users[desired.Username] = managed
	if err := saveManagedState(l.managedStatePath, *state); err != nil {
		return "", "local_apply_failed", err
	}

	currentHash, err := shadowHash(desired.Username)
	if err != nil {
		return "", "local_apply_failed", err
	}
	if currentHash != desired.PasswordHash {
		if err := run(ctx, desired.Username+":"+desired.PasswordHash+"\n", "chpasswd", "--encrypted"); err != nil {
			return "", "local_apply_failed", fmt.Errorf("apply synchronized password: %w", err)
		}
	}
	return "Linux account and synchronized SSH password applied.", "", nil
}

func unknownUser(err error) bool {
	var unknown user.UnknownUserError
	return errors.As(err, &unknown)
}

func ensureGroup(ctx context.Context) error {
	if _, err := user.LookupGroup(managedGroup); err == nil {
		return nil
	} else {
		var unknown user.UnknownGroupError
		if !errors.As(err, &unknown) {
			return fmt.Errorf("look up managed group: %w", err)
		}
	}
	if err := run(ctx, "", "groupadd", "--system", managedGroup); err != nil {
		return fmt.Errorf("create managed group: %w", err)
	}
	return nil
}

func ensureSSHPolicy(ctx context.Context) error {
	const path = "/etc/ssh/sshd_config.d/60-cluster-manager.conf"
	existing, readErr := os.ReadFile(path)
	if readErr == nil && string(existing) == sshPolicy {
		return nil
	}
	if readErr != nil && !errors.Is(readErr, os.ErrNotExist) {
		return fmt.Errorf("read SSH policy: %w", readErr)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create SSH policy directory: %w", err)
	}
	temporary := path + ".new"
	if err := os.WriteFile(temporary, []byte(sshPolicy), 0o644); err != nil {
		return fmt.Errorf("write SSH policy: %w", err)
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
		return fmt.Errorf("install SSH policy: %w", err)
	}
	if err := run(ctx, "", "sshd", "-t"); err != nil {
		if readErr == nil {
			_ = os.WriteFile(path, existing, 0o644)
		} else {
			_ = os.Remove(path)
		}
		return fmt.Errorf("validate SSH policy: %w", err)
	}
	if err := run(ctx, "", "systemctl", "reload", "ssh"); err != nil {
		if fallback := run(ctx, "", "service", "ssh", "reload"); fallback != nil {
			return fmt.Errorf("reload SSH service: %w", err)
		}
	}
	return nil
}

func shadowHash(username string) (string, error) {
	contents, err := os.ReadFile("/etc/shadow")
	if err != nil {
		return "", fmt.Errorf("read shadow database: %w", err)
	}
	scanner := bufio.NewScanner(bytes.NewReader(contents))
	for scanner.Scan() {
		fields := strings.Split(scanner.Text(), ":")
		if len(fields) >= 2 && fields[0] == username {
			return fields[1], nil
		}
	}
	if err := scanner.Err(); err != nil {
		return "", fmt.Errorf("scan shadow database: %w", err)
	}
	return "", fmt.Errorf("shadow entry for %s was not found", username)
}

func ensureSubordinateIDs(ctx context.Context, username string) (*IDRange, *IDRange, error) {
	hasUID, uidRanges, err := subordinateRanges("/etc/subuid", username)
	if err != nil {
		return nil, nil, err
	}
	hasGID, gidRanges, err := subordinateRanges("/etc/subgid", username)
	if err != nil {
		return nil, nil, err
	}
	if hasUID && hasGID {
		uidRange, _ := userSubordinateRange("/etc/subuid", username)
		gidRange, _ := userSubordinateRange("/etc/subgid", username)
		return uidRange, gidRange, nil
	}
	args := []string{}
	if !hasUID {
		start := availableSubordinateRange(uidRanges)
		end := start + 65_535
		args = append(args, "--add-subuids", fmt.Sprintf("%d-%d", start, end))
	}
	if !hasGID {
		start := availableSubordinateRange(gidRanges)
		end := start + 65_535
		args = append(args, "--add-subgids", fmt.Sprintf("%d-%d", start, end))
	}
	args = append(args, username)
	if err := run(ctx, "", "usermod", args...); err != nil {
		return nil, nil, fmt.Errorf("configure rootless Podman ID ranges: %w", err)
	}
	uidRange, uidErr := userSubordinateRange("/etc/subuid", username)
	gidRange, gidErr := userSubordinateRange("/etc/subgid", username)
	if uidErr != nil || gidErr != nil {
		return nil, nil, fmt.Errorf("read configured subordinate ID ranges")
	}
	return uidRange, gidRange, nil
}

func userSubordinateRange(path, username string) (*IDRange, error) {
	contents, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	scanner := bufio.NewScanner(bytes.NewReader(contents))
	for scanner.Scan() {
		fields := strings.Split(scanner.Text(), ":")
		if len(fields) != 3 || fields[0] != username {
			continue
		}
		start, startErr := strconv.Atoi(fields[1])
		count, countErr := strconv.Atoi(fields[2])
		if startErr == nil && countErr == nil {
			return &IDRange{Start: start, Count: count}, nil
		}
	}
	return nil, scanner.Err()
}

type subordinateRange struct {
	start int
	end   int
}

func subordinateRanges(path, username string) (bool, []subordinateRange, error) {
	contents, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil, nil
	}
	if err != nil {
		return false, nil, fmt.Errorf("read %s: %w", path, err)
	}
	found := false
	ranges := []subordinateRange{}
	scanner := bufio.NewScanner(bytes.NewReader(contents))
	for scanner.Scan() {
		fields := strings.Split(scanner.Text(), ":")
		if len(fields) != 3 {
			continue
		}
		if fields[0] == username {
			found = true
			continue
		}
		start, startErr := strconv.Atoi(fields[1])
		count, countErr := strconv.Atoi(fields[2])
		if startErr == nil && countErr == nil && count > 0 {
			ranges = append(ranges, subordinateRange{start: start, end: start + count - 1})
		}
	}
	return found, ranges, scanner.Err()
}

func availableSubordinateRange(existing []subordinateRange) int {
	const size = 65_536
	for candidate := 100_000; ; candidate += size {
		end := candidate + size - 1
		available := true
		for _, current := range existing {
			if candidate <= current.end && end >= current.start {
				available = false
				break
			}
		}
		if available {
			return candidate
		}
	}
}

func run(ctx context.Context, stdin, name string, args ...string) error {
	command := exec.CommandContext(ctx, name, args...)
	if stdin != "" {
		command.Stdin = strings.NewReader(stdin)
	}
	output, err := command.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s failed: %w: %s", name, err, strings.TrimSpace(string(output)))
	}
	return nil
}
