package reconcile

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestManagedStateRoundTripIsRootOnlyAndAtomic(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state", "managed-state.json")
	want := ManagedState{
		SchemaVersion:   managedStateSchemaVersion,
		WorkstationID:   "11111111-1111-4111-8111-111111111111",
		WorkstationName: "ws01",
		Users: map[string]ManagedUser{
			"alice": {
				Username:        "alice",
				AssignmentID:    "22222222-2222-4222-8222-222222222222",
				WorkstationID:   "11111111-1111-4111-8111-111111111111",
				WorkstationName: "ws01",
				UID:             1001,
				GID:             1001,
				HomeDirectory:   "/home/alice",
				PrimaryGroup:    "alice",
				GroupCreated:    true,
				CreationPhase:   "active",
				GroupAdded:      true,
				SubordinateUID:  &IDRange{Start: 100000, Count: 65536},
				SubordinateGID:  &IDRange{Start: 100000, Count: 65536},
				CreatedAt:       time.Date(2026, 9, 17, 0, 0, 0, 0, time.UTC),
			},
		},
	}
	if err := saveManagedState(path, want); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("managed state mode is %o, want 600", info.Mode().Perm())
	}
	got, err := loadManagedState(path)
	if err != nil {
		t.Fatal(err)
	}
	if got.WorkstationID != want.WorkstationID || got.Users["alice"].UID != 1001 {
		t.Fatalf("unexpected managed state: %#v", got)
	}
	if _, err := os.Stat(path + ".new"); !os.IsNotExist(err) {
		t.Fatalf("temporary state file remains: %v", err)
	}
}

func TestMissingManagedStateStartsEmptyAndFailsSafe(t *testing.T) {
	state, err := loadManagedState(filepath.Join(t.TempDir(), "missing.json"))
	if err != nil {
		t.Fatal(err)
	}
	if state.SchemaVersion != managedStateSchemaVersion || len(state.Users) != 0 {
		t.Fatalf("unexpected empty state: %#v", state)
	}
}

func TestManagedStateRejectsUnknownSchema(t *testing.T) {
	path := filepath.Join(t.TempDir(), "managed-state.json")
	if err := os.WriteFile(path, []byte(`{"schemaVersion":1,"users":{}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadManagedState(path); err == nil {
		t.Fatal("expected unknown schema to fail")
	}
}
