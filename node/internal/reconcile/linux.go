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

	"github.com/Joshimello/cluster-manager/node/internal/protocol"
)

const (
	managedGroup = "cluster-manager-users"
	sshPolicy    = "# Managed by cluster-manager-node\nMatch Group " + managedGroup + "\n    PasswordAuthentication yes\n    PubkeyAuthentication no\n    AuthenticationMethods password\n"
)

type Linux struct {
	workstationName string
}

func NewLinux(workstationName string) *Linux {
	return &Linux{workstationName: workstationName}
}

func (l *Linux) Apply(ctx context.Context, state protocol.DesiredState) ([]protocol.ReconciliationResult, error) {
	if err := Validate(state, l.workstationName); err != nil {
		return nil, err
	}
	if os.Geteuid() != 0 {
		return nil, errors.New("Linux reconciliation requires root")
	}
	if err := ensureGroup(ctx); err != nil {
		return nil, err
	}
	if err := ensureSSHPolicy(ctx); err != nil {
		return nil, err
	}

	results := make([]protocol.ReconciliationResult, 0, len(state.Users))
	for _, desired := range state.Users {
		message, err := applyUser(ctx, desired)
		if err != nil {
			results = append(results, result(desired, "error", err.Error()))
			continue
		}
		results = append(results, result(desired, "applied", message))
	}
	return results, nil
}

func applyUser(ctx context.Context, desired protocol.DesiredUser) (string, error) {
	account, err := user.Lookup(desired.Username)
	if err != nil && !unknownUser(err) {
		return "", fmt.Errorf("look up Linux account: %w", err)
	}
	if !desired.Enabled {
		if account == nil {
			return "Login disabled; no local account or data was removed.", nil
		}
		if err := run(ctx, "", "usermod", "--lock", desired.Username); err != nil {
			return "", fmt.Errorf("disable login: %w", err)
		}
		return "Login disabled; home data preserved.", nil
	}

	if account == nil {
		if err := run(ctx, "", "useradd", "--create-home", "--shell", "/bin/bash", "--groups", managedGroup, desired.Username); err != nil {
			return "", fmt.Errorf("create Linux account: %w", err)
		}
		account, err = user.Lookup(desired.Username)
		if err != nil {
			return "", fmt.Errorf("look up created Linux account: %w", err)
		}
	} else if err := run(ctx, "", "usermod", "--append", "--groups", managedGroup, desired.Username); err != nil {
		return "", fmt.Errorf("add managed account group: %w", err)
	}

	uid, err := strconv.Atoi(account.Uid)
	if err != nil {
		return "", fmt.Errorf("parse account UID: %w", err)
	}
	gid, err := strconv.Atoi(account.Gid)
	if err != nil {
		return "", fmt.Errorf("parse account GID: %w", err)
	}
	if err := os.MkdirAll(account.HomeDir, 0o700); err != nil {
		return "", fmt.Errorf("create home directory: %w", err)
	}
	if err := os.Chown(account.HomeDir, uid, gid); err != nil {
		return "", fmt.Errorf("set home ownership: %w", err)
	}
	if err := ensureSubordinateIDs(ctx, desired.Username); err != nil {
		return "", err
	}

	currentHash, err := shadowHash(desired.Username)
	if err != nil {
		return "", err
	}
	if currentHash != desired.PasswordHash {
		if err := run(ctx, desired.Username+":"+desired.PasswordHash+"\n", "chpasswd", "--encrypted"); err != nil {
			return "", fmt.Errorf("apply synchronized password: %w", err)
		}
	}
	return "Linux account and synchronized SSH password applied.", nil
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

func ensureSubordinateIDs(ctx context.Context, username string) error {
	hasUID, uidRanges, err := subordinateRanges("/etc/subuid", username)
	if err != nil {
		return err
	}
	hasGID, gidRanges, err := subordinateRanges("/etc/subgid", username)
	if err != nil {
		return err
	}
	if hasUID && hasGID {
		return nil
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
		return fmt.Errorf("configure rootless Podman ID ranges: %w", err)
	}
	return nil
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
