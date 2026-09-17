package reconcile

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

const defaultManagedStatePath = "/var/lib/cluster-manager/managed-state.json"

type IDRange struct {
	Start int `json:"start"`
	Count int `json:"count"`
}

type ManagedUser struct {
	Username        string    `json:"username"`
	AssignmentID    string    `json:"assignmentId"`
	WorkstationID   string    `json:"workstationId"`
	WorkstationName string    `json:"workstationName"`
	UID             int       `json:"uid"`
	GID             int       `json:"gid"`
	HomeDirectory   string    `json:"homeDirectory"`
	GroupAdded      bool      `json:"groupAdded"`
	SubordinateUID  *IDRange  `json:"subordinateUid,omitempty"`
	SubordinateGID  *IDRange  `json:"subordinateGid,omitempty"`
	CreatedAt       time.Time `json:"createdAt"`
}

type ManagedState struct {
	SchemaVersion   int                    `json:"schemaVersion"`
	WorkstationID   string                 `json:"workstationId"`
	WorkstationName string                 `json:"workstationName"`
	Users           map[string]ManagedUser `json:"users"`
}

func loadManagedState(path string) (ManagedState, error) {
	contents, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return ManagedState{SchemaVersion: 1, Users: map[string]ManagedUser{}}, nil
	}
	if err != nil {
		return ManagedState{}, fmt.Errorf("read managed account state: %w", err)
	}
	var state ManagedState
	if err := json.Unmarshal(contents, &state); err != nil {
		return ManagedState{}, fmt.Errorf("parse managed account state: %w", err)
	}
	if state.SchemaVersion != 1 || state.Users == nil {
		return ManagedState{}, fmt.Errorf("unsupported managed account state schema %d", state.SchemaVersion)
	}
	for name, managed := range state.Users {
		if managed.WorkstationID == "" {
			managed.WorkstationID = state.WorkstationID
			managed.WorkstationName = state.WorkstationName
			state.Users[name] = managed
		}
	}
	return state, nil
}

// LoadManagedState reads the provenance ledger for lifecycle safety checks.
func LoadManagedState(path string) (ManagedState, error) { return loadManagedState(path) }

func saveManagedState(path string, state ManagedState) error {
	contents, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return fmt.Errorf("encode managed account state: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("create managed account state directory: %w", err)
	}
	temporary := path + ".new"
	if err := os.WriteFile(temporary, append(contents, '\n'), 0o600); err != nil {
		return fmt.Errorf("write managed account state: %w", err)
	}
	if err := os.Chmod(temporary, 0o600); err != nil {
		_ = os.Remove(temporary)
		return fmt.Errorf("secure managed account state: %w", err)
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
		return fmt.Errorf("install managed account state: %w", err)
	}
	return nil
}
