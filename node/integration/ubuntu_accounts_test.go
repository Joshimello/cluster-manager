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
	"testing"
	"time"

	"github.com/Joshimello/cluster-manager/node/internal/protocol"
	"github.com/Joshimello/cluster-manager/node/internal/reconcile"
)

const accountWS = "77777777-7777-4777-8777-777777777777"
const accountAssignment = "88888888-8888-4888-8888-888888888888"

func disposableAccounts(t *testing.T) {
	t.Helper()
	if os.Getenv("CLUSTER_MANAGER_UBUNTU_INTEGRATION") != "1" {
		t.Skip("requires disposable Ubuntu integration image")
	}
}
func localUser(t *testing.T, name string, uid int) {
	t.Helper()
	hostCommand(t, "groupadd", "--gid", fmt.Sprint(uid), name)
	hostCommand(t, "useradd", "--uid", fmt.Sprint(uid), "--gid", name, "--create-home", "--shell", "/bin/bash", name)
}
func hostCommand(t *testing.T, name string, args ...string) {
	t.Helper()
	if output, err := exec.Command(name, args...).CombinedOutput(); err != nil {
		t.Fatalf("%s: %v: %s", name, err, output)
	}
}
func discovered(t *testing.T, runner *reconcile.Linux, name string) reconcile.LocalAccount {
	t.Helper()
	scan := runner.DiscoverAccounts()
	if !scan.Complete {
		t.Fatal("incomplete discovery")
	}
	for _, a := range scan.Accounts {
		if a.Username == name {
			return a
		}
	}
	t.Fatalf("missing discovery %s: %#v", name, scan)
	return reconcile.LocalAccount{}
}
func operation(a reconcile.LocalAccount, kind string, serial int) reconcile.AccountInstruction {
	return reconcile.AccountInstruction{APIVersion: "v1", ID: fmt.Sprintf("99999999-9999-4999-8999-%012d", serial), WorkstationID: accountWS, WorkstationName: "ubuntu-smoke", AssignmentID: accountAssignment, Generation: serial, Kind: kind, Account: a, ExpiresAt: time.Now().Add(time.Minute)}
}
func completed(t *testing.T, r reconcile.AccountResult) {
	t.Helper()
	if r.Status != "completed" {
		t.Fatalf("operation refused: %#v", r)
	}
}
func sshLogin(t *testing.T, name, password string) {
	t.Helper()
	if out, err := exec.Command("sshpass", "-p", password, "ssh", "-o", "ConnectTimeout=3", "-o", "PreferredAuthentications=password", "-o", "PubkeyAuthentication=no", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", name+"@127.0.0.1", "true").CombinedOutput(); err != nil {
		t.Fatalf("SSH password login: %v: %s", err, out)
	}
}
func runningWork(t *testing.T, uid int) *exec.Cmd {
	t.Helper()
	cmd := exec.Command("setpriv", "--reuid", fmt.Sprint(uid), "--regid", fmt.Sprint(uid), "--clear-groups", "sleep", "120")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	// Confirm the test process has switched identity before asserting the busy guard.
	for i := 0; i < 100; i++ {
		if out, _ := exec.Command("pgrep", "-u", fmt.Sprint(uid)).Output(); len(out) > 0 {
			return cmd
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("test process did not start")
	return cmd
}

func TestUbuntuImportTransfersOwnershipAndPreservesRunningWork(t *testing.T) {
	disposableAccounts(t)
	const name = "cmimport"
	localUser(t, name, 40003)
	hostCommand(t, "groupadd", "--gid", "61000", "import-extra")
	hostCommand(t, "usermod", "--append", "--groups", "import-extra", name)
	path := filepath.Join(t.TempDir(), "managed-state.json")
	prior := reconcile.ManagedState{SchemaVersion: 2, WorkstationID: "11111111-1111-4111-8111-111111111111", WorkstationName: "old-node", Users: map[string]reconcile.ManagedUser{name: {Username: name, UID: 40003, GID: 40003, HomeDirectory: "/home/" + name, PrimaryGroup: name, WorkstationID: "11111111-1111-4111-8111-111111111111", WorkstationName: "old-node", AssignmentID: accountAssignment, CreationPhase: "active", GroupCreated: true, CreatedAt: time.Now()}}}
	data, _ := json.Marshal(prior)
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	runner := reconcile.NewLinuxWithStatePath("ubuntu-smoke", path)
	marker := "/home/" + name + "/keep-me"
	if err := os.WriteFile(marker, []byte("existing data"), 0600); err != nil {
		t.Fatal(err)
	}
	before := snapshotIdentityFiles(t, name)
	a := discovered(t, runner, name)
	if !a.Eligible || a.OwnerWorkstationID != prior.WorkstationID {
		t.Fatalf("unexpected import candidate: %#v", a)
	}
	if after := snapshotIdentityFiles(t, name); after != before {
		t.Fatal("discovery changed account state")
	}
	work := runningWork(t, a.UID)
	instruction := operation(a, "adopt", 1)
	completed(t, runner.ExecuteAccount(context.Background(), instruction))
	hostCommand(t, "kill", "-0", fmt.Sprint(work.Process.Pid))
	completed(t, runner.ExecuteAccount(context.Background(), instruction))
	state, err := reconcile.LoadManagedState(path)
	if err != nil {
		t.Fatal(err)
	}
	if state.Users[name].WorkstationID != accountWS || !state.Users[name].Adopted {
		t.Fatalf("ownership not transferred: %#v", state.Users[name])
	}
	desired := protocol.DesiredState{APIVersion: "v1", Users: []protocol.DesiredUser{{AssignmentID: accountAssignment, Username: name, UID: a.UID, GID: a.GID, Enabled: true, PasswordHash: changedHash, Generation: 1}}}
	desired.Workstation.ID = accountWS
	desired.Workstation.Name = "ubuntu-smoke"
	subuid, _ := exec.Command("grep", "^"+name+":", "/etc/subuid").Output()
	subgid, _ := exec.Command("grep", "^"+name+":", "/etc/subgid").Output()
	applied, err := runner.Apply(context.Background(), desired)
	if err != nil || applied[0].Status != "applied" {
		t.Fatalf("password sync: %#v %v", applied, err)
	}
	afterUID, _ := exec.Command("grep", "^"+name+":", "/etc/subuid").Output()
	afterGID, _ := exec.Command("grep", "^"+name+":", "/etc/subgid").Output()
	if string(subuid) != string(afterUID) || string(subgid) != string(afterGID) {
		t.Fatal("import changed subordinate IDs")
	}
	groups, _ := exec.Command("id", "-nG", name).Output()
	if !strings.Contains(string(groups), "import-extra") {
		t.Fatal("import lost supplementary group")
	}
	if contents, _ := os.ReadFile(marker); string(contents) != "existing data" {
		t.Fatal("import changed files")
	}
	sshLogin(t, name, changedPassword)
	hostCommand(t, "kill", "-0", fmt.Sprint(work.Process.Pid))
}

func TestUbuntuRemovalRefusesBusyAndRequiresExplicitRetry(t *testing.T) {
	disposableAccounts(t)
	const name = "cmbusyremove"
	localUser(t, name, 40004)
	path := filepath.Join(t.TempDir(), "managed-state.json")
	runner := reconcile.NewLinuxWithStatePath("ubuntu-smoke", path)
	completed(t, runner.ExecuteAccount(context.Background(), operation(discovered(t, runner, name), "adopt", 10)))
	a := discovered(t, runner, name)
	work := runningWork(t, a.UID)
	instruction := operation(a, "remove", 11)
	r := runner.ExecuteAccount(context.Background(), instruction)
	if r.Status != "blocked" || !strings.Contains(r.Detail, "running processes") {
		t.Fatalf("expected busy refusal: %#v", r)
	}
	hostCommand(t, "kill", "-0", fmt.Sprint(work.Process.Pid))
	_ = work.Process.Kill()
	_ = work.Wait()
	if runner.ExecuteAccount(context.Background(), instruction).Status != "blocked" {
		t.Fatal("busy command silently executed later")
	}
	retry := operation(discovered(t, runner, name), "remove", 12)
	completed(t, runner.ExecuteAccount(context.Background(), retry))
	if _, err := user.Lookup(name); err == nil {
		t.Fatal("account remains")
	}
	if _, err := os.Stat(a.Home); err != nil {
		t.Fatal("default removal lost home")
	}
	// A receipt remains available after lost acknowledgements, even after command expiry.
	receipt := runner.PendingAccountResults()
	if len(receipt) < 2 {
		t.Fatalf("missing durable receipts: %#v", receipt)
	}
	runner.AcknowledgeAccountResult(retry.ID)
	restarted := reconcile.NewLinuxWithStatePath("ubuntu-smoke", path)
	for _, r := range restarted.PendingAccountResults() {
		if r.ID == retry.ID {
			t.Fatal("acknowledgement not durable")
		}
	}
	// Recreate the same POSIX account as an administrator. Replaying the old command must leave it intact.
	localUser(t, name, 40004)
	completed(t, restarted.ExecuteAccount(context.Background(), retry))
	if _, err := user.Lookup(name); err != nil {
		t.Fatal("duplicate command removed recreated identity")
	}
	stale := protocol.DesiredState{APIVersion: "v1", Users: []protocol.DesiredUser{{AssignmentID: accountAssignment, Username: name, UID: 40004, GID: 40004, Enabled: true, PasswordHash: initialHash, Generation: 11}}}
	stale.Workstation.ID = accountWS
	stale.Workstation.Name = "ubuntu-smoke"
	results, err := restarted.Apply(context.Background(), stale)
	if err != nil || results[0].ErrorCode != "managed_identity_mismatch" {
		t.Fatalf("stale recreation was not blocked: %#v %v", results, err)
	}
}

func TestUbuntuHomeDeletionSharedGroupAndUnsafeIdentity(t *testing.T) {
	disposableAccounts(t)
	const name = "cmhomeremove"
	localUser(t, name, 40005)
	runner := reconcile.NewLinuxWithStatePath("ubuntu-smoke", filepath.Join(t.TempDir(), "managed-state.json"))
	a := discovered(t, runner, name)
	approved := operation(a, "adopt", 20)
	hostCommand(t, "chown", "root:root", a.Home)
	if r := runner.ExecuteAccount(context.Background(), approved); r.Status != "blocked" || !strings.Contains(r.Detail, "identity changed") {
		t.Fatalf("ownership change not blocked: %#v", r)
	}
	hostCommand(t, "chown", "40005:40005", a.Home)
	completed(t, runner.ExecuteAccount(context.Background(), operation(discovered(t, runner, name), "adopt", 21)))
	hostCommand(t, "useradd", "--uid", "40006", "--gid", name, "--no-create-home", "cmsharedgroup")
	outside := filepath.Join(t.TempDir(), "outside")
	if err := os.WriteFile(outside, []byte("preserved"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, a.Home+"/external-link"); err != nil {
		t.Fatal(err)
	}
	removal := operation(discovered(t, runner, name), "remove", 22)
	removal.DeleteHome = true
	completed(t, runner.ExecuteAccount(context.Background(), removal))
	if _, err := os.Stat(a.Home); !os.IsNotExist(err) {
		t.Fatal("requested home deletion not applied")
	}
	if data, err := os.ReadFile(outside); err != nil || string(data) != "preserved" {
		t.Fatal("cleanup followed external symlink")
	}
	if group, err := user.LookupGroup(name); err != nil || group.Gid != "40005" {
		t.Fatal("shared private group removed")
	}
}

func TestUbuntuRemovalMountAndInterruptedJournal(t *testing.T) {
	disposableAccounts(t)
	const name = "cmmountguard"
	localUser(t, name, 40007)
	path := filepath.Join(t.TempDir(), "managed-state.json")
	runner := reconcile.NewLinuxWithStatePath("ubuntu-smoke", path)
	completed(t, runner.ExecuteAccount(context.Background(), operation(discovered(t, runner, name), "adopt", 30)))
	a := discovered(t, runner, name)
	// This image is run with CAP_SYS_ADMIN exclusively for a disposable bind-mount safety test.
	mount := a.Home + "/mounted"
	if err := os.Mkdir(mount, 0700); err != nil {
		t.Fatal(err)
	}
	hostCommand(t, "mount", "--bind", mount, mount)
	removal := operation(discovered(t, runner, name), "remove", 31)
	removal.DeleteHome = true
	r := runner.ExecuteAccount(context.Background(), removal)
	hostCommand(t, "umount", mount)
	if r.Status != "blocked" || !strings.Contains(r.Detail, "mounts") {
		t.Fatalf("mount cleanup not blocked: %#v", r)
	}
	if _, err := os.Stat(a.Home); err != nil {
		t.Fatal("mounted home removed")
	}
	// A process crash after intent journaling must require a new operation rather than resuming deletion.
	interrupted := operation(discovered(t, runner, name), "remove", 32)
	data, _ := json.Marshal(map[string]any{"results": map[string]any{interrupted.ID: map[string]string{"id": interrupted.ID, "status": "executing"}}})
	if err := os.WriteFile(filepath.Join(filepath.Dir(path), "account-operations.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	if r := runner.ExecuteAccount(context.Background(), interrupted); r.Status != "blocked" || !strings.Contains(r.Detail, "interrupted") {
		t.Fatalf("interrupted command resumed: %#v", r)
	}
	if _, err := user.Lookup(name); err != nil {
		t.Fatal("interrupted operation removed account")
	}
}

func TestUbuntuUnsafeHomeExpiredApprovalAndPartialCleanup(t *testing.T) {
	disposableAccounts(t)
	const name = "cmunsafehome"
	localUser(t, name, 40008)
	runner := reconcile.NewLinuxWithStatePath("ubuntu-smoke", filepath.Join(t.TempDir(), "managed-state.json"))
	a := discovered(t, runner, name)
	expired := operation(a, "adopt", 40)
	expired.ExpiresAt = time.Now().Add(-time.Minute)
	if runner.ExecuteAccount(context.Background(), expired).Status != "blocked" {
		t.Fatal("expired approval accepted")
	}
	expired.ExpiresAt = time.Now().Add(time.Minute)
	if runner.ExecuteAccount(context.Background(), expired).Status != "blocked" {
		t.Fatal("expired approval silently revived")
	}
	approved := operation(a, "adopt", 41)
	if err := os.Rename(a.Home, a.Home+"-original"); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(a.Home+"-original", a.Home); err != nil {
		t.Fatal(err)
	}
	if discovered(t, runner, name).Eligible {
		t.Fatal("symlink home is importable")
	}
	if runner.ExecuteAccount(context.Background(), approved).Status != "blocked" {
		t.Fatal("changed home adopted")
	}
	if err := os.Remove(a.Home); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(a.Home+"-original", a.Home); err != nil {
		t.Fatal(err)
	}
	if runner.ExecuteAccount(context.Background(), approved).Status != "blocked" {
		t.Fatal("refused approval silently revived after home restoration")
	}
	completed(t, runner.ExecuteAccount(context.Background(), operation(discovered(t, runner, name), "adopt", 42)))
	// Recover cleanup interrupted after userdel but before home/ledger cleanup.
	hostCommand(t, "userdel", name)
	missing := discovered(t, runner, name)
	if missing.Exists || missing.OwnerWorkstationID != accountWS {
		t.Fatalf("missing partial-cleanup ownership: %#v", missing)
	}
	cleanup := operation(missing, "remove", 43)
	cleanup.DeleteHome = true
	completed(t, runner.ExecuteAccount(context.Background(), cleanup))
	if _, err := os.Stat(a.Home); !os.IsNotExist(err) {
		t.Fatal("partial cleanup did not remove the approved retained home")
	}
}
