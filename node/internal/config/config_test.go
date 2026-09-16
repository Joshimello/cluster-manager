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

func TestAcceptsDocumentedSimulationScenarios(t *testing.T) {
	base := Config{PlatformURL: "https://platform.example", WorkstationName: "ws01", CredentialFile: "/tmp/credential", HeartbeatInterval: 10 * time.Second, Simulate: true}
	for _, scenario := range []string{"normal", "free-gpus", "busy-gpus", "multi-process", "owner-use", "reservation-conflict", "mixed-owner", "unknown-owner", "offline"} {
		cfg := base
		cfg.SimulationScenario = scenario
		if err := cfg.Validate(); err != nil {
			t.Errorf("scenario %q should be valid: %v", scenario, err)
		}
	}
	base.SimulationScenario = "surprise"
	if err := base.Validate(); err == nil {
		t.Fatal("expected undocumented scenario to be rejected")
	}
}
