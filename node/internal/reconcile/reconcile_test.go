package reconcile

import (
	"context"
	"testing"
	"time"

	"github.com/Joshimello/cluster-manager/node/internal/protocol"
)

const testHash = "$6$saltstring$adDbXsJjcDlq2662QPgd.tkSOVmnG9Tt3oXl4HR60SusC3AGjirnDenVZp3DGwLwqy6iYKCzannhaX9DR72nN1"

func desiredState(users ...protocol.DesiredUser) protocol.DesiredState {
	state := protocol.DesiredState{APIVersion: "v1", GeneratedAt: time.Now(), Users: users}
	state.Workstation.ID = "11111111-1111-4111-8111-111111111111"
	state.Workstation.Name = "ws01"
	return state
}

func TestValidateRejectsWholeUnsafeState(t *testing.T) {
	valid := protocol.DesiredUser{
		AssignmentID: "22222222-2222-4222-8222-222222222222",
		Username:     "alice",
		Enabled:      true,
		PasswordHash: testHash,
		Generation:   1,
	}
	tests := []struct {
		name  string
		state protocol.DesiredState
	}{
		{"wrong workstation", func() protocol.DesiredState {
			value := desiredState(valid)
			value.Workstation.Name = "ws02"
			return value
		}()},
		{"unsafe username", desiredState(protocol.DesiredUser{AssignmentID: valid.AssignmentID, Username: "Alice;rm", Generation: 1})},
		{"invalid hash", desiredState(protocol.DesiredUser{AssignmentID: valid.AssignmentID, Username: "alice", Enabled: true, PasswordHash: "$6$bad", Generation: 1})},
		{"disabled hash", desiredState(protocol.DesiredUser{AssignmentID: valid.AssignmentID, Username: "alice", PasswordHash: testHash, Generation: 1})},
		{"duplicate username", desiredState(valid, valid)},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := Validate(test.state, "ws01"); err == nil {
				t.Fatal("expected desired state to be rejected")
			}
		})
	}
}

func TestSimulatedReconciliationIsIdempotent(t *testing.T) {
	reconciler := NewSimulated("ws01")
	state := desiredState(protocol.DesiredUser{
		AssignmentID: "22222222-2222-4222-8222-222222222222",
		Username:     "alice",
		Enabled:      true,
		PasswordHash: testHash,
		Generation:   3,
	})
	for attempt := 0; attempt < 2; attempt++ {
		results, err := reconciler.Apply(context.Background(), state)
		if err != nil {
			t.Fatalf("apply desired state: %v", err)
		}
		if len(results) != 1 || results[0].Status != "applied" || results[0].Generation != 3 {
			t.Fatalf("unexpected result: %#v", results)
		}
	}
}

func TestSimulatedRevocationDisablesWithoutDeletingState(t *testing.T) {
	reconciler := NewSimulated("ws01")
	enabled := protocol.DesiredUser{
		AssignmentID: "22222222-2222-4222-8222-222222222222",
		Username:     "alice",
		Enabled:      true,
		PasswordHash: testHash,
		Generation:   1,
	}
	if _, err := reconciler.Apply(context.Background(), desiredState(enabled)); err != nil {
		t.Fatal(err)
	}
	enabled.Enabled = false
	enabled.PasswordHash = ""
	enabled.Generation = 2
	results, err := reconciler.Apply(context.Background(), desiredState(enabled))
	if err != nil {
		t.Fatal(err)
	}
	if reconciler.users["alice"] || results[0].Status != "applied" {
		t.Fatalf("expected alice to remain managed but disabled: %#v", results)
	}
}
