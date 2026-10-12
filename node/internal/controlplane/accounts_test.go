package controlplane

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Joshimello/cluster-manager/node/internal/reconcile"
)

func TestAccountOperationsUseSeparateAuthenticatedEndpoints(t *testing.T) {
	command := reconcile.AccountInstruction{APIVersion: "v1", ID: "operation", Kind: "adopt", WorkstationID: "workstation", ExpiresAt: time.Now().Add(time.Minute)}
	reported := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer cmnode_secret" {
			t.Error("missing account-operation credential")
		}
		switch r.URL.Path {
		case "/api/node/v1/accounts/next":
			if r.Method != "GET" {
				t.Error("expected GET")
			}
			if reported {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			_ = json.NewEncoder(w).Encode(command)
		case "/api/node/v1/accounts/result":
			if r.Method != "POST" {
				t.Error("expected POST")
			}
			var result reconcile.AccountResult
			if err := json.NewDecoder(r.Body).Decode(&result); err != nil || result.ID != command.ID || result.Status != "completed" {
				t.Errorf("bad result: %#v %v", result, err)
			}
			reported = true
			_, _ = w.Write([]byte(`{"accepted":true}`))
		default:
			t.Errorf("unexpected path: %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	client := New(server.URL)
	instruction, err := client.NextAccount(context.Background(), "cmnode_secret")
	if err != nil || instruction.ID != command.ID {
		t.Fatalf("account instruction: %#v %v", instruction, err)
	}
	if err := client.ReportAccount(context.Background(), "cmnode_secret", reconcile.AccountResult{ID: command.ID, Status: "completed"}); err != nil {
		t.Fatal(err)
	}
	if instruction, err := client.NextAccount(context.Background(), "cmnode_secret"); err != nil || instruction != nil {
		t.Fatalf("no pending operation: %#v %v", instruction, err)
	}
}
