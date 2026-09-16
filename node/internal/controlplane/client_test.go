package controlplane

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Joshimello/cluster-manager/node/internal/protocol"
)

func TestDesiredStateAndReconciliationUseScopedBearerAPI(t *testing.T) {
	credential := "cmnode_secret"
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer "+credential {
			t.Errorf("missing bearer credential")
		}
		response.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case "/api/node/v1/desired-state":
			_, _ = response.Write([]byte(`{"apiVersion":"v1","generatedAt":"2026-09-16T00:00:00Z","workstation":{"id":"11111111-1111-4111-8111-111111111111","name":"ws01"},"users":[{"assignmentId":"22222222-2222-4222-8222-222222222222","username":"alice","enabled":false,"generation":2}]}`))
		case "/api/node/v1/reconciliation":
			var report protocol.ReconciliationReport
			if err := json.NewDecoder(request.Body).Decode(&report); err != nil {
				t.Errorf("decode reconciliation report: %v", err)
			}
			if len(report.Results) != 1 || report.Results[0].AssignmentID == "" {
				t.Errorf("unexpected reconciliation report: %#v", report)
			}
			_, _ = response.Write([]byte(`{"accepted":1}`))
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()

	client := New(server.URL)
	state, err := client.DesiredState(context.Background(), credential)
	if err != nil || state.Workstation.Name != "ws01" || len(state.Users) != 1 {
		t.Fatalf("unexpected desired state: %#v, %v", state, err)
	}
	result := protocol.ReconciliationResult{AssignmentID: state.Users[0].AssignmentID, Generation: 2, Status: "applied"}
	if err := client.ReportReconciliation(context.Background(), credential, []protocol.ReconciliationResult{result}); err != nil {
		t.Fatal(err)
	}
}

func TestHeartbeatUsesBearerCredential(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/node/v1/heartbeat" {
			t.Errorf("unexpected path %s", request.URL.Path)
		}
		if request.Header.Get("Authorization") != "Bearer cmnode_secret" {
			t.Errorf("missing bearer credential")
		}
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(`{"accepted":true}`))
	}))
	defer server.Close()
	err := New(server.URL).Heartbeat(context.Background(), "cmnode_secret", protocol.Heartbeat{ObservedAt: time.Now()})
	if err != nil {
		t.Fatal(err)
	}
}

func TestNonSuccessIsAnError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		http.Error(response, "no", http.StatusUnauthorized)
	}))
	defer server.Close()
	if err := New(server.URL).Enroll(context.Background(), "ws01", "bad", "bad"); err == nil {
		t.Fatal("expected an error")
	}
}
