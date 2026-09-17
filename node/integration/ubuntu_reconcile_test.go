package integration

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/Joshimello/cluster-manager/node/internal/protocol"
	"github.com/Joshimello/cluster-manager/node/internal/reconcile"
	"github.com/Joshimello/cluster-manager/node/internal/termination"
)

const (
	initialPassword = "Initial-password-2026!"
	initialHash     = "$6$initialsalt$QtXY/bBXjnVi9rLk8Uie5d5nCAekyztka75UHNwnNJ2dmVDzGN9ASxH8ynD/JfljidHUDKxj.s9o6i09KEz.51"
	changedPassword = "Changed-password-2026!"
	changedHash     = "$6$changesalt$BJbELV8tSHEcNKK.GoEWOAXZ8MJa41XEYN5BvK786Oy/s0aLOrOCm6cOL0yk79hKhHjnkdQfA6ayKfB.yE3nf."
)

func TestUbuntuAccountPasswordAndRevocation(t *testing.T) {
	if os.Getenv("CLUSTER_MANAGER_UBUNTU_INTEGRATION") != "1" {
		t.Skip("set CLUSTER_MANAGER_UBUNTU_INTEGRATION=1 inside the disposable Ubuntu test image")
	}

	desired := protocol.DesiredState{APIVersion: "v1"}
	desired.Workstation.ID = "11111111-1111-4111-8111-111111111111"
	desired.Workstation.Name = "ubuntu-smoke"
	desired.Users = []protocol.DesiredUser{{
		AssignmentID: "22222222-2222-4222-8222-222222222222",
		Username:     "cmtest",
		UID:          20_000,
		GID:          20_000,
		Enabled:      true,
		PasswordHash: initialHash,
		Generation:   1,
	}}
	runner := reconcile.NewLinux("ubuntu-smoke")

	for attempt := 0; attempt < 2; attempt++ {
		results, err := runner.Apply(context.Background(), desired)
		if err != nil || len(results) != 1 || results[0].Status != "applied" {
			t.Fatalf("apply account attempt %d: %#v, %v", attempt+1, results, err)
		}
	}
	account, err := user.Lookup("cmtest")
	if err != nil {
		t.Fatal(err)
	}
	if account.Uid != "20000" || account.Gid != "20000" {
		t.Fatalf("unexpected platform identity uid=%s gid=%s", account.Uid, account.Gid)
	}
	privateGroup, err := user.LookupGroup("cmtest")
	if err != nil || privateGroup.Gid != "20000" {
		t.Fatalf("unexpected private group: %#v, %v", privateGroup, err)
	}
	marker := filepath.Join(account.HomeDir, "preserve-me")
	if err := os.WriteFile(marker, []byte("user data"), 0o600); err != nil {
		t.Fatal(err)
	}
	assertPasswordLogin(t, initialPassword, true)
	assertKeyLoginUnavailable(t, account.HomeDir)

	desired.Users[0].PasswordHash = changedHash
	desired.Users[0].Generation = 2
	if results, err := runner.Apply(context.Background(), desired); err != nil || results[0].Status != "applied" {
		t.Fatalf("apply changed password: %#v, %v", results, err)
	}
	assertPasswordLogin(t, initialPassword, false)
	assertPasswordLogin(t, changedPassword, true)

	desired.Users[0].Enabled = false
	desired.Users[0].PasswordHash = ""
	desired.Users[0].Generation = 3
	if results, err := runner.Apply(context.Background(), desired); err != nil || results[0].Status != "applied" {
		t.Fatalf("revoke account: %#v, %v", results, err)
	}
	assertPasswordLogin(t, changedPassword, false)
	if contents, err := os.ReadFile(marker); err != nil || string(contents) != "user data" {
		t.Fatalf("home data was not preserved: %q, %v", contents, err)
	}
}

func TestUbuntuUIDCollisionChangesNothing(t *testing.T) {
	if os.Getenv("CLUSTER_MANAGER_UBUNTU_INTEGRATION") != "1" {
		t.Skip("set CLUSTER_MANAGER_UBUNTU_INTEGRATION=1 inside the disposable Ubuntu test image")
	}
	if output, err := exec.Command("useradd", "--uid", "21001", "--user-group", "uidholder").CombinedOutput(); err != nil {
		t.Fatalf("create UID holder: %v: %s", err, output)
	}
	before := snapshotIdentityFiles(t, "uidholder", "uidcollision")
	results, err := reconcile.NewLinux("ubuntu-smoke").Apply(context.Background(), desiredIdentity("uidcollision", 21001))
	if err != nil || len(results) != 1 || results[0].ErrorCode != "uid_collision" {
		t.Fatalf("expected UID collision: %#v, %v", results, err)
	}
	if after := snapshotIdentityFiles(t, "uidholder", "uidcollision"); after != before {
		t.Fatalf("UID collision modified host state\nbefore: %s\nafter:  %s", before, after)
	}
}

func TestUbuntuGIDCollisionChangesNothing(t *testing.T) {
	if os.Getenv("CLUSTER_MANAGER_UBUNTU_INTEGRATION") != "1" {
		t.Skip("set CLUSTER_MANAGER_UBUNTU_INTEGRATION=1 inside the disposable Ubuntu test image")
	}
	if output, err := exec.Command("groupadd", "--gid", "21002", "gidholder").CombinedOutput(); err != nil {
		t.Fatalf("create GID holder: %v: %s", err, output)
	}
	before := snapshotIdentityFiles(t, "gidholder", "gidcollision")
	results, err := reconcile.NewLinux("ubuntu-smoke").Apply(context.Background(), desiredIdentity("gidcollision", 21002))
	if err != nil || len(results) != 1 || results[0].ErrorCode != "gid_collision" {
		t.Fatalf("expected GID collision: %#v, %v", results, err)
	}
	if after := snapshotIdentityFiles(t, "gidholder", "gidcollision"); after != before {
		t.Fatalf("GID collision modified host state\nbefore: %s\nafter:  %s", before, after)
	}
}

func TestUbuntuInterruptedProvisioningResumesFromJournal(t *testing.T) {
	if os.Getenv("CLUSTER_MANAGER_UBUNTU_INTEGRATION") != "1" {
		t.Skip("set CLUSTER_MANAGER_UBUNTU_INTEGRATION=1 inside the disposable Ubuntu test image")
	}
	if output, err := exec.Command("groupadd", "--system", "cluster-manager-users").CombinedOutput(); err != nil && !strings.Contains(string(output), "already exists") {
		t.Fatalf("create managed group: %v: %s", err, output)
	}

	tests := []struct {
		name        string
		username    string
		id          int
		createGroup bool
		createUser  bool
	}{
		{name: "after ledger write", username: "resumeledger", id: 22_000},
		{name: "after private group creation", username: "resumegroup", id: 22_001, createGroup: true},
		{name: "after user creation", username: "resumeuser", id: 22_002, createGroup: true, createUser: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			statePath := filepath.Join(t.TempDir(), "managed-state.json")
			managed := reconcile.ManagedUser{
				Username:        test.username,
				AssignmentID:    "55555555-5555-4555-8555-555555555555",
				WorkstationID:   "11111111-1111-4111-8111-111111111111",
				WorkstationName: "ubuntu-smoke",
				UID:             test.id,
				GID:             test.id,
				HomeDirectory:   filepath.Join("/home", test.username),
				PrimaryGroup:    test.username,
				GroupCreated:    true,
				CreationPhase:   "pending",
				CreatedAt:       time.Now().UTC(),
			}
			state := reconcile.ManagedState{
				SchemaVersion:   2,
				WorkstationID:   managed.WorkstationID,
				WorkstationName: managed.WorkstationName,
				Users:           map[string]reconcile.ManagedUser{test.username: managed},
			}
			contents, err := json.Marshal(state)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(statePath, contents, 0o600); err != nil {
				t.Fatal(err)
			}
			if test.createGroup {
				if output, err := exec.Command("groupadd", "--gid", fmt.Sprint(test.id), test.username).CombinedOutput(); err != nil {
					t.Fatalf("create interrupted private group: %v: %s", err, output)
				}
			}
			if test.createUser {
				if output, err := exec.Command(
					"useradd", "--uid", fmt.Sprint(test.id), "--gid", test.username,
					"--home-dir", managed.HomeDirectory, "--create-home", "--shell", "/bin/bash",
					"--groups", "cluster-manager-users", test.username,
				).CombinedOutput(); err != nil {
					t.Fatalf("create interrupted user: %v: %s", err, output)
				}
			}

			results, err := reconcile.NewLinuxWithStatePath("ubuntu-smoke", statePath).Apply(
				context.Background(), desiredIdentity(test.username, test.id),
			)
			if err != nil || len(results) != 1 || results[0].Status != "applied" {
				t.Fatalf("resume pending creation: %#v, %v", results, err)
			}
			account, err := user.Lookup(test.username)
			if err != nil || account.Uid != fmt.Sprint(test.id) || account.Gid != fmt.Sprint(test.id) {
				t.Fatalf("unexpected resumed account: %#v, %v", account, err)
			}
			loaded, err := reconcile.LoadManagedState(statePath)
			if err != nil || loaded.Users[test.username].CreationPhase != "active" {
				t.Fatalf("journal did not become active: %#v, %v", loaded, err)
			}
		})
	}
}

func desiredIdentity(username string, id int) protocol.DesiredState {
	desired := protocol.DesiredState{APIVersion: "v1"}
	desired.Workstation.ID = "11111111-1111-4111-8111-111111111111"
	desired.Workstation.Name = "ubuntu-smoke"
	desired.Users = []protocol.DesiredUser{{
		AssignmentID: "44444444-4444-4444-8444-444444444444",
		Username:     username,
		UID:          id,
		GID:          id,
		Enabled:      true,
		PasswordHash: changedHash,
		Generation:   1,
	}}
	return desired
}

func snapshotIdentityFiles(t *testing.T, names ...string) string {
	t.Helper()
	var snapshot strings.Builder
	for _, path := range []string{"/etc/passwd", "/etc/shadow", "/etc/group", "/etc/subuid", "/etc/subgid", "/etc/ssh/sshd_config.d/60-cluster-manager.conf"} {
		contents, err := os.ReadFile(path)
		if err != nil && !os.IsNotExist(err) {
			t.Fatal(err)
		}
		for _, line := range strings.Split(string(contents), "\n") {
			matched := strings.Contains(path, "60-cluster-manager.conf")
			for _, name := range names {
				matched = matched || strings.HasPrefix(line, name+":")
			}
			if matched {
				snapshot.WriteString(path + "=" + line + "\n")
			}
		}
	}
	return snapshot.String()
}

func TestUbuntuPreExistingUsernameCollisionChangesNothing(t *testing.T) {
	if os.Getenv("CLUSTER_MANAGER_UBUNTU_INTEGRATION") != "1" {
		t.Skip("set CLUSTER_MANAGER_UBUNTU_INTEGRATION=1 inside the disposable Ubuntu test image")
	}
	if output, err := exec.Command("useradd", "--create-home", "collisiontest").CombinedOutput(); err != nil {
		t.Fatalf("create pre-existing account: %v: %s", err, output)
	}
	account, err := user.Lookup("collisiontest")
	if err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(account.HomeDir, "ownership-marker")
	if err := os.WriteFile(marker, []byte("must remain untouched"), 0o640); err != nil {
		t.Fatal(err)
	}
	before := snapshotCollisionAccount(t, account, marker)

	desired := protocol.DesiredState{APIVersion: "v1"}
	desired.Workstation.ID = "11111111-1111-4111-8111-111111111111"
	desired.Workstation.Name = "ubuntu-smoke"
	desired.Users = []protocol.DesiredUser{{
		AssignmentID: "33333333-3333-4333-8333-333333333333",
		Username:     "collisiontest",
		UID:          20_001,
		GID:          20_001,
		Enabled:      true,
		PasswordHash: changedHash,
		Generation:   1,
	}}
	results, err := reconcile.NewLinux("ubuntu-smoke").Apply(context.Background(), desired)
	if err != nil || len(results) != 1 || results[0].Status != "error" || results[0].ErrorCode != "username_collision" {
		t.Fatalf("expected collision result: %#v, %v", results, err)
	}
	if !strings.Contains(results[0].Message, "no local ownership or credential data was changed") {
		t.Fatalf("unsafe remediation message: %q", results[0].Message)
	}
	if after := snapshotCollisionAccount(t, account, marker); after != before {
		t.Fatalf("collision modified host state\nbefore: %s\nafter:  %s", before, after)
	}

	desired.Users[0].Enabled = false
	desired.Users[0].PasswordHash = ""
	desired.Users[0].Generation++
	results, err = reconcile.NewLinux("ubuntu-smoke").Apply(context.Background(), desired)
	if err != nil || results[0].ErrorCode != "username_collision" {
		t.Fatalf("disabled collision must remain untouched: %#v, %v", results, err)
	}
	if after := snapshotCollisionAccount(t, account, marker); after != before {
		t.Fatalf("disabled collision modified host state\nbefore: %s\nafter:  %s", before, after)
	}
}

func snapshotCollisionAccount(t *testing.T, account *user.User, marker string) string {
	t.Helper()
	paths := []string{"/etc/passwd", "/etc/shadow", "/etc/group", "/etc/subuid", "/etc/subgid", "/etc/ssh/sshd_config.d/60-cluster-manager.conf", marker}
	var snapshot strings.Builder
	for _, path := range paths {
		contents, err := os.ReadFile(path)
		if err != nil && !os.IsNotExist(err) {
			t.Fatal(err)
		}
		for _, line := range strings.Split(string(contents), "\n") {
			if path == marker || strings.HasPrefix(line, account.Username+":") || strings.Contains(path, "60-cluster-manager.conf") {
				snapshot.WriteString(path + "=" + line + "\n")
			}
		}
	}
	info, err := os.Stat(marker)
	if err != nil {
		t.Fatal(err)
	}
	stat := info.Sys().(*syscall.Stat_t)
	fmt.Fprintf(&snapshot, "marker-mode=%o uid=%d gid=%d", info.Mode().Perm(), stat.Uid, stat.Gid)
	return snapshot.String()
}

func TestUbuntuSafeProcessTermination(t *testing.T) {
	if os.Getenv("CLUSTER_MANAGER_UBUNTU_INTEGRATION") != "1" {
		t.Skip("set CLUSTER_MANAGER_UBUNTU_INTEGRATION=1 inside the disposable Ubuntu test image")
	}

	t.Run("SIGTERM", func(t *testing.T) {
		command := exec.Command("sleep", "30")
		if err := command.Start(); err != nil {
			t.Fatal(err)
		}
		defer reap(command)
		instruction, process := terminationFixture(t, command.Process.Pid)
		runner := termination.NewLinuxWithGrace(func(context.Context) ([]protocol.GPUProcess, error) {
			return []protocol.GPUProcess{process}, nil
		}, 300*time.Millisecond)
		result := runner.Execute(context.Background(), instruction)
		if result.Outcome != "terminated" || !result.TermSent || result.KillSent {
			t.Fatalf("expected graceful termination: %#v", result)
		}
	})

	t.Run("SIGKILL escalation", func(t *testing.T) {
		command := exec.Command("bash", "-c", "trap '' TERM; while :; do sleep 1; done")
		if err := command.Start(); err != nil {
			t.Fatal(err)
		}
		defer reap(command)
		time.Sleep(50 * time.Millisecond)
		instruction, process := terminationFixture(t, command.Process.Pid)
		instruction.AllowSIGKILL = true
		runner := termination.NewLinuxWithGrace(func(context.Context) ([]protocol.GPUProcess, error) {
			return []protocol.GPUProcess{process}, nil
		}, 150*time.Millisecond)
		result := runner.Execute(context.Background(), instruction)
		if result.Outcome != "killed" || !result.TermSent || !result.KillSent {
			t.Fatalf("expected SIGKILL escalation: %#v", result)
		}
	})

	t.Run("identity mismatch", func(t *testing.T) {
		command := exec.Command("sleep", "30")
		if err := command.Start(); err != nil {
			t.Fatal(err)
		}
		defer reap(command)
		instruction, process := terminationFixture(t, command.Process.Pid)
		instruction.ProcessStartTicks++
		process.ProcessStartTicks = instruction.ProcessStartTicks
		runner := termination.NewLinuxWithGrace(func(context.Context) ([]protocol.GPUProcess, error) {
			return []protocol.GPUProcess{process}, nil
		}, 100*time.Millisecond)
		result := runner.Execute(context.Background(), instruction)
		if result.Outcome != "refused_identity" || result.TermSent {
			t.Fatalf("identity mismatch must not signal: %#v", result)
		}
		if err := syscall.Kill(command.Process.Pid, 0); err != nil {
			t.Fatalf("mismatched target should remain alive: %v", err)
		}
	})
}

func terminationFixture(t *testing.T, pid int) (protocol.TerminationInstruction, protocol.GPUProcess) {
	t.Helper()
	uid, startTicks, err := termination.ReadIdentity(pid)
	if err != nil {
		t.Fatal(err)
	}
	process := protocol.GPUProcess{GPUUUID: "GPU-test", PID: pid, UID: uid, ProcessStartTicks: startTicks}
	instruction := protocol.TerminationInstruction{
		APIVersion:        "v1",
		InstructionID:     "11111111-1111-4111-8111-111111111111",
		ExpiresAt:         time.Now().Add(time.Minute),
		GPUUUID:           process.GPUUUID,
		PID:               pid,
		UID:               uid,
		ProcessStartTicks: startTicks,
	}
	instruction.Workstation.Name = "ubuntu-smoke"
	return instruction, process
}

func reap(command *exec.Cmd) {
	_ = command.Process.Kill()
	_ = command.Wait()
}

func assertPasswordLogin(t *testing.T, password string, shouldSucceed bool) {
	t.Helper()
	command := exec.Command(
		"sshpass", "-p", password, "ssh",
		"-o", "ConnectTimeout=3",
		"-o", "PreferredAuthentications=password",
		"-o", "PubkeyAuthentication=no",
		"-o", "StrictHostKeyChecking=no",
		"-o", "UserKnownHostsFile=/dev/null",
		"cmtest@127.0.0.1", "true",
	)
	err := command.Run()
	if shouldSucceed && err != nil {
		t.Fatalf("password login should succeed: %v", err)
	}
	if !shouldSucceed && err == nil {
		t.Fatal("password login should fail")
	}
}

func assertKeyLoginUnavailable(t *testing.T, home string) {
	t.Helper()
	temporary := t.TempDir()
	key := filepath.Join(temporary, "id_ed25519")
	if output, err := exec.Command("ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", key).CombinedOutput(); err != nil {
		t.Fatalf("generate SSH key: %v: %s", err, output)
	}
	publicKey, err := os.ReadFile(key + ".pub")
	if err != nil {
		t.Fatal(err)
	}
	sshDirectory := filepath.Join(home, ".ssh")
	if err := os.MkdirAll(sshDirectory, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sshDirectory, "authorized_keys"), publicKey, 0o600); err != nil {
		t.Fatal(err)
	}
	account, _ := user.Lookup("cmtest")
	uid := numeric(t, account.Uid)
	gid := numeric(t, account.Gid)
	_ = os.Chown(sshDirectory, uid, gid)
	_ = os.Chown(filepath.Join(sshDirectory, "authorized_keys"), uid, gid)

	command := exec.Command(
		"ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=3",
		"-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null",
		"-i", key, "cmtest@127.0.0.1", "true",
	)
	if output, err := command.CombinedOutput(); err == nil {
		t.Fatalf("SSH public-key login unexpectedly succeeded: %s", strings.TrimSpace(string(output)))
	}
}

func numeric(t *testing.T, value string) int {
	t.Helper()
	result := 0
	for _, character := range value {
		if character < '0' || character > '9' {
			t.Fatalf("invalid numeric ID %q", value)
		}
		result = result*10 + int(character-'0')
	}
	return result
}
