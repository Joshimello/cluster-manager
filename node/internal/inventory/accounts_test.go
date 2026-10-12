package inventory

import (
	"context"
	"testing"
	"time"

	"github.com/Joshimello/cluster-manager/node/internal/protocol"
	"github.com/Joshimello/cluster-manager/node/internal/reconcile"
)

func TestSimulatedAccountImportRemovalAndReplay(t *testing.T) {
	s := NewSimulated("simulation", "normal")
	snapshot := s.DiscoverAccounts()
	if !snapshot.Complete || len(snapshot.Accounts) != 2 {
		t.Fatal("missing migration fixtures")
	}
	a := snapshot.Accounts[0]
	i := reconcile.AccountInstruction{ID: "import", Kind: "adopt", WorkstationID: "new-registration", WorkstationName: s.Name, Account: a, ExpiresAt: time.Now().Add(time.Minute)}
	if r := s.ExecuteAccount(context.Background(), i); r.Status != "completed" {
		t.Fatalf("import: %#v", r)
	}
	i.ID = "remove"
	i.Kind = "remove"
	if r := s.ExecuteAccount(context.Background(), i); r.Status != "completed" {
		t.Fatalf("remove: %#v", r)
	}
	s.SetDesiredUsers("new-registration", []protocol.DesiredUser{{Username: a.Username, UID: a.UID, GID: a.GID, Enabled: true}})
	var recreated reconcile.LocalAccount
	for _, entry := range s.DiscoverAccounts().Accounts {
		if entry.Username == a.Username {
			recreated = entry
		}
	}
	if recreated.Fingerprint == a.Fingerprint || recreated.OwnerWorkstationID != "new-registration" {
		t.Fatal("recreated identity must have a new incarnation")
	}
	if r := s.ExecuteAccount(context.Background(), i); r.Status != "completed" {
		t.Fatal("duplicate receipt not returned")
	}
	if len(s.DiscoverAccounts().Accounts) != 2 {
		t.Fatal("duplicate removed a recreated account")
	}
	i.ID = "changed"
	if r := s.ExecuteAccount(context.Background(), i); r.Status != "blocked" {
		t.Fatal("changed identity accepted")
	}
}

func TestSimulatedBusyCleanupNeedsANewOperation(t *testing.T) {
	s := NewSimulated("simulation", "account-busy")
	a := s.DiscoverAccounts().Accounts[0]
	i := reconcile.AccountInstruction{ID: "import", Kind: "adopt", WorkstationID: "new-registration", WorkstationName: s.Name, Account: a, ExpiresAt: time.Now().Add(time.Minute)}
	s.ExecuteAccount(context.Background(), i)
	i.ID = "remove"
	i.Kind = "remove"
	if s.ExecuteAccount(context.Background(), i).Status != "blocked" {
		t.Fatal("busy account removed")
	}
	s.Scenario = "normal"
	if s.ExecuteAccount(context.Background(), i).Status != "blocked" {
		t.Fatal("blocked instruction resumed automatically")
	}
	i.ID = "retry"
	if s.ExecuteAccount(context.Background(), i).Status != "completed" {
		t.Fatal("explicit retry failed")
	}
}
