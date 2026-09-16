package config

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLoadUsesFileAndEnvironmentOverrides(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "node.json")
	if err := os.WriteFile(path, []byte(`{"platformUrl":"https://example.test","workstationName":"from-file","heartbeatInterval":"20s"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("NODE_CONFIG_FILE", path)
	t.Setenv("NODE_WORKSTATION_NAME", "from-env")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.WorkstationName != "from-env" || cfg.HeartbeatInterval != 20*time.Second {
		t.Fatalf("unexpected config: %#v", cfg)
	}
}

func TestRejectsHTTPByDefault(t *testing.T) {
	cfg := Config{PlatformURL: "http://platform:3000", WorkstationName: "ws01", CredentialFile: "/tmp/credential", HeartbeatInterval: 10 * time.Second}
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected insecure URL to be rejected")
	}
	cfg.AllowInsecureHTTP = true
	if err := cfg.Validate(); err != nil {
		t.Fatalf("development HTTP should be allowed explicitly: %v", err)
	}
}
