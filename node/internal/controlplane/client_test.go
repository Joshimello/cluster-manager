package controlplane

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Joshimello/cluster-manager/node/internal/protocol"
)

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
