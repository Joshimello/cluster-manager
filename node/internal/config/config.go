package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type fileConfig struct {
	PlatformURL        string `json:"platformUrl"`
	WorkstationName    string `json:"workstationName"`
	EnrollmentToken    string `json:"enrollmentToken"`
	CredentialFile     string `json:"credentialFile"`
	HeartbeatInterval  string `json:"heartbeatInterval"`
	Simulate           bool   `json:"simulate"`
	SimulationScenario string `json:"simulationScenario"`
	AllowInsecureHTTP  bool   `json:"allowInsecureHttp"`
}

const DefaultPath = "/etc/cluster-manager/node.json"

type Config struct {
	PlatformURL        string
	WorkstationName    string
	EnrollmentToken    string
	CredentialFile     string
	HeartbeatInterval  time.Duration
	Simulate           bool
	SimulationScenario string
	AllowInsecureHTTP  bool
}

func Load() (Config, error) {
	var raw fileConfig
	path := strings.TrimSpace(os.Getenv("NODE_CONFIG_FILE"))
	if path == "" {
		if _, err := os.Stat(DefaultPath); err == nil {
			path = DefaultPath
		}
	}
	if path != "" {
		contents, err := os.ReadFile(path)
		if err != nil {
			return Config{}, fmt.Errorf("read NODE_CONFIG_FILE: %w", err)
		}
		if err := json.Unmarshal(contents, &raw); err != nil {
			return Config{}, fmt.Errorf("parse NODE_CONFIG_FILE: %w", err)
		}
	}
	override(&raw.PlatformURL, "NODE_PLATFORM_URL")
	override(&raw.WorkstationName, "NODE_WORKSTATION_NAME")
	override(&raw.EnrollmentToken, "NODE_ENROLLMENT_TOKEN")
	override(&raw.CredentialFile, "NODE_CREDENTIAL_FILE")
	override(&raw.HeartbeatInterval, "NODE_HEARTBEAT_INTERVAL")
	override(&raw.SimulationScenario, "NODE_SIMULATION_SCENARIO")
	if value, ok := os.LookupEnv("NODE_SIMULATE"); ok {
		parsed, err := strconv.ParseBool(value)
		if err != nil {
			return Config{}, fmt.Errorf("NODE_SIMULATE: %w", err)
		}
		raw.Simulate = parsed
	}
	if value, ok := os.LookupEnv("NODE_ALLOW_INSECURE_HTTP"); ok {
		parsed, err := strconv.ParseBool(value)
		if err != nil {
			return Config{}, fmt.Errorf("NODE_ALLOW_INSECURE_HTTP: %w", err)
		}
		raw.AllowInsecureHTTP = parsed
	}
	if path := strings.TrimSpace(os.Getenv("NODE_ENROLLMENT_TOKEN_FILE")); path != "" {
		contents, err := os.ReadFile(path)
		if err != nil {
			return Config{}, fmt.Errorf("read NODE_ENROLLMENT_TOKEN_FILE: %w", err)
		}
		raw.EnrollmentToken = strings.TrimSpace(string(contents))
	}
	interval := 15 * time.Second
	if raw.HeartbeatInterval != "" {
		parsed, err := time.ParseDuration(raw.HeartbeatInterval)
		if err != nil {
			return Config{}, fmt.Errorf("heartbeat interval: %w", err)
		}
		interval = parsed
	}
	credentialFile := raw.CredentialFile
	if credentialFile == "" {
		credentialFile = filepath.Join("/var/lib/cluster-manager", "node-credential")
	}
	scenario := raw.SimulationScenario
	if scenario == "" {
		scenario = "normal"
	}
	cfg := Config{PlatformURL: strings.TrimRight(strings.TrimSpace(raw.PlatformURL), "/"), WorkstationName: strings.ToLower(strings.TrimSpace(raw.WorkstationName)), EnrollmentToken: strings.TrimSpace(raw.EnrollmentToken), CredentialFile: credentialFile, HeartbeatInterval: interval, Simulate: raw.Simulate, SimulationScenario: scenario, AllowInsecureHTTP: raw.AllowInsecureHTTP}
	return cfg, cfg.Validate()
}

// Write stores the active node configuration without enrollment material.
func Write(path string, cfg Config) error {
	if err := cfg.Validate(); err != nil {
		return err
	}
	raw := fileConfig{
		PlatformURL:        cfg.PlatformURL,
		WorkstationName:    cfg.WorkstationName,
		CredentialFile:     cfg.CredentialFile,
		HeartbeatInterval:  cfg.HeartbeatInterval.String(),
		Simulate:           cfg.Simulate,
		SimulationScenario: cfg.SimulationScenario,
		AllowInsecureHTTP:  cfg.AllowInsecureHTTP,
	}
	contents, err := json.MarshalIndent(raw, "", "  ")
	if err != nil {
		return fmt.Errorf("encode node configuration: %w", err)
	}
	contents = append(contents, '\n')
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("create configuration directory: %w", err)
	}
	temporary := path + ".new"
	if err := os.WriteFile(temporary, contents, 0o600); err != nil {
		return fmt.Errorf("write configuration: %w", err)
	}
	if err := os.Chmod(temporary, 0o600); err != nil {
		_ = os.Remove(temporary)
		return fmt.Errorf("secure configuration: %w", err)
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
		return fmt.Errorf("install configuration: %w", err)
	}
	return nil
}

func override(target *string, key string) {
	if value, ok := os.LookupEnv(key); ok {
		*target = value
	}
}

func (c Config) Validate() error {
	if err := ValidatePlatformURL(c.PlatformURL, c.AllowInsecureHTTP); err != nil {
		return fmt.Errorf("NODE_PLATFORM_URL %w", err)
	}
	if err := ValidateWorkstationName(c.WorkstationName); err != nil {
		return fmt.Errorf("NODE_WORKSTATION_NAME %w", err)
	}
	if c.HeartbeatInterval < time.Second || c.HeartbeatInterval > 10*time.Minute {
		return errors.New("heartbeat interval must be between 1s and 10m")
	}
	if c.CredentialFile == "" {
		return errors.New("credential file path is required")
	}
	validScenarios := map[string]bool{
		"normal": true, "high-cpu": true, "high-disk": true, "multi-user": true,
		"free-gpus": true, "busy-gpus": true, "multi-process": true,
		"owner-use": true, "reservation-conflict": true, "mixed-owner": true,
		"unknown-owner": true, "offline": true,
	}
	validScenario := validScenarios[c.SimulationScenario]
	if c.Simulate && !validScenario {
		return fmt.Errorf("unknown simulation scenario %q", c.SimulationScenario)
	}
	return nil
}

// ValidatePlatformURL validates a platform base URL without requiring a full
// node configuration. Interactive setup uses this before moving to its next
// prompt.
func ValidatePlatformURL(value string, allowInsecureHTTP bool) error {
	value = strings.TrimSpace(value)
	if value == "" {
		return errors.New("is required")
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" {
		return errors.New("must be an absolute URL")
	}
	if parsed.Scheme != "https" && !(parsed.Scheme == "http" && allowInsecureHTTP) {
		return errors.New("must use HTTPS (set NODE_ALLOW_INSECURE_HTTP=true only for development)")
	}
	return nil
}

// ValidateWorkstationName validates a normalized workstation name without
// requiring a full node configuration.
func ValidateWorkstationName(value string) error {
	if !validName(strings.TrimSpace(value)) {
		return errors.New("must be 2-32 lowercase letters, numbers, or hyphens and start with a letter")
	}
	return nil
}

func validName(value string) bool {
	if len(value) < 2 || len(value) > 32 || value[0] < 'a' || value[0] > 'z' {
		return false
	}
	for _, character := range value[1:] {
		if !(character >= 'a' && character <= 'z') && !(character >= '0' && character <= '9') && character != '-' {
			return false
		}
	}
	return true
}
