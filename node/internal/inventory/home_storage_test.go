package inventory

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/Joshimello/cluster-manager/node/internal/reconcile"
)

func TestHomeStorageOnlyReportsOwnedIdentities(t *testing.T) {
	path := filepath.Join(t.TempDir(), "managed.json")
	state := reconcile.ManagedState{SchemaVersion: 2, WorkstationID: "workstation-id", WorkstationName: "ws01", Users: map[string]reconcile.ManagedUser{
		"missing-metrics-user": {Username: "missing-metrics-user", WorkstationID: "workstation-id", WorkstationName: "ws01", UID: 20001, GID: 20001, HomeDirectory: "/", PrimaryGroup: "missing-metrics-user", CreationPhase: "active"},
		"unowned":              {Username: "unowned", WorkstationID: "another-id", WorkstationName: "ws01", UID: 20002, GID: 20002, PrimaryGroup: "unowned", CreationPhase: "active"},
	}}
	data, _ := json.Marshal(state)
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	values := newHomeStorageCollector("ws01", path).collect(context.Background())
	if len(values) != 1 || values[0].Bytes != nil || values[0].Status != "identity_mismatch" {
		t.Fatalf("unowned storage was measured: %#v", values)
	}
	if values := newHomeStorageCollector("ws02", path).collect(context.Background()); len(values) != 0 {
		t.Fatalf("another workstation ledger was read: %#v", values)
	}
}

func TestHomeDiskBytesDoesNotFollowSymlinks(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("the node uses Linux coreutils du")
	}
	home, outside := t.TempDir(), t.TempDir()
	if err := os.WriteFile(filepath.Join(home, "owned"), make([]byte, 4096), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outside, "other"), make([]byte, 10*1024*1024), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(home, "link")); err != nil {
		t.Fatal(err)
	}
	bytes, err := homeDiskBytes(context.Background(), home)
	if err != nil {
		t.Fatal(err)
	}
	if bytes == 0 || bytes >= 10*1024*1024 {
		t.Fatalf("followed symlink or lost owned blocks: %d", bytes)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := homeDiskBytes(ctx, home); err == nil {
		t.Fatal("cancelled scan succeeded")
	}
}
