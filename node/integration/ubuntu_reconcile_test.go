package integration

import (
	"context"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Joshimello/cluster-manager/node/internal/protocol"
	"github.com/Joshimello/cluster-manager/node/internal/reconcile"
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
