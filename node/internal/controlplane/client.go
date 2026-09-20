package controlplane

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/Joshimello/cluster-manager/node/internal/protocol"
)

type Client struct {
	baseURL    string
	httpClient *http.Client
}

type Enrollment struct {
	WorkstationID string `json:"workstationId"`
	Name          string `json:"name"`
	Enrolled      bool   `json:"enrolled"`
}

func New(baseURL string) *Client {
	return &Client{baseURL: strings.TrimRight(baseURL, "/"), httpClient: &http.Client{Timeout: 10 * time.Second}}
}

func (c *Client) Enroll(ctx context.Context, name, token, credential string) (Enrollment, error) {
	var enrollment Enrollment
	err := c.postJSON(ctx, "/api/node/v1/enroll", "", map[string]string{"name": name, "token": token, "credential": credential}, &enrollment)
	if err == nil && (!enrollment.Enrolled || enrollment.WorkstationID == "" || enrollment.Name != name) {
		err = fmt.Errorf("invalid enrollment response")
	}
	return enrollment, err
}

func (c *Client) Heartbeat(ctx context.Context, credential string, report protocol.Heartbeat) error {
	return c.post(ctx, "/api/node/v1/heartbeat", credential, report)
}

func (c *Client) DesiredState(ctx context.Context, credential string) (protocol.DesiredState, error) {
	var state protocol.DesiredState
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/api/node/v1/desired-state", nil)
	if err != nil {
		return state, fmt.Errorf("create desired-state request: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Authorization", "Bearer "+credential)
	request.Header.Set("User-Agent", "cluster-node")
	response, err := c.httpClient.Do(request)
	if err != nil {
		return state, fmt.Errorf("desired-state request: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		message, _ := io.ReadAll(io.LimitReader(response.Body, 512))
		return state, fmt.Errorf("desired-state request returned %s: %s", response.Status, strings.TrimSpace(string(message)))
	}
	decoder := json.NewDecoder(io.LimitReader(response.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&state); err != nil {
		return state, fmt.Errorf("decode desired state: %w", err)
	}
	if state.APIVersion != "v1" {
		return state, fmt.Errorf("unsupported desired-state API version %q", state.APIVersion)
	}
	return state, nil
}

func (c *Client) ReportReconciliation(ctx context.Context, credential string, results []protocol.ReconciliationResult) error {
	return c.post(ctx, "/api/node/v1/reconciliation", credential, protocol.ReconciliationReport{Results: results})
}

func (c *Client) NextTermination(ctx context.Context, credential string) (*protocol.TerminationInstruction, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/api/node/v1/termination/next", nil)
	if err != nil {
		return nil, fmt.Errorf("create termination request: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Authorization", "Bearer "+credential)
	request.Header.Set("User-Agent", "cluster-node")
	response, err := c.httpClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("termination request: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNoContent {
		return nil, nil
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		message, _ := io.ReadAll(io.LimitReader(response.Body, 512))
		return nil, fmt.Errorf("termination request returned %s: %s", response.Status, strings.TrimSpace(string(message)))
	}
	var instruction protocol.TerminationInstruction
	decoder := json.NewDecoder(io.LimitReader(response.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&instruction); err != nil {
		return nil, fmt.Errorf("decode termination instruction: %w", err)
	}
	if instruction.APIVersion != "v1" || instruction.InstructionID == "" || instruction.Workstation.Name == "" || instruction.GPUUUID == "" || instruction.PID <= 1 || instruction.ProcessStartTicks == 0 || instruction.ExpiresAt.IsZero() {
		return nil, fmt.Errorf("invalid termination instruction")
	}
	return &instruction, nil
}

func (c *Client) ReportTermination(ctx context.Context, credential string, result protocol.TerminationResult) error {
	return c.post(ctx, "/api/node/v1/termination/result", credential, result)
}

func (c *Client) NextUpdate(ctx context.Context, credential string) (*protocol.NodeUpdateInstruction, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/api/node/v1/update/next", nil)
	if err != nil {
		return nil, fmt.Errorf("create update request: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Authorization", "Bearer "+credential)
	request.Header.Set("User-Agent", "cluster-node")
	response, err := c.httpClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("update request: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNoContent {
		return nil, nil
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		message, _ := io.ReadAll(io.LimitReader(response.Body, 512))
		return nil, fmt.Errorf("update request returned %s: %s", response.Status, strings.TrimSpace(string(message)))
	}
	var instruction protocol.NodeUpdateInstruction
	decoder := json.NewDecoder(io.LimitReader(response.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&instruction); err != nil {
		return nil, fmt.Errorf("decode update instruction: %w", err)
	}
	if instruction.APIVersion != "v1" || instruction.InstructionID == "" || instruction.Workstation.ID == "" || instruction.Workstation.Name == "" || instruction.TargetVersion == "" || instruction.ExpiresAt.IsZero() {
		return nil, fmt.Errorf("invalid update instruction")
	}
	return &instruction, nil
}

func (c *Client) ReportUpdate(ctx context.Context, credential string, result protocol.NodeUpdateResult) error {
	return c.post(ctx, "/api/node/v1/update/result", credential, result)
}

func (c *Client) NextDiagnostic(ctx context.Context, credential string) (*protocol.DiagnosticInstruction, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/api/node/v1/diagnostics/next", nil)
	if err != nil {
		return nil, fmt.Errorf("create diagnostic request: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Authorization", "Bearer "+credential)
	request.Header.Set("User-Agent", "cluster-node")
	response, err := c.httpClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("diagnostic request: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNoContent {
		return nil, nil
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		message, _ := io.ReadAll(io.LimitReader(response.Body, 512))
		return nil, fmt.Errorf("diagnostic request returned %s: %s", response.Status, strings.TrimSpace(string(message)))
	}
	var instruction protocol.DiagnosticInstruction
	decoder := json.NewDecoder(io.LimitReader(response.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&instruction); err != nil {
		return nil, fmt.Errorf("decode diagnostic instruction: %w", err)
	}
	uniqueTargets := make(map[string]struct{}, len(instruction.TargetGPUUUIDs))
	for _, target := range instruction.TargetGPUUUIDs {
		uniqueTargets[target] = struct{}{}
	}
	validWorkload := instruction.Workload == "fp32" || instruction.Workload == "fp64" || instruction.Workload == "tensor"
	validDigest := len(instruction.ImageDigest) == 71 && strings.HasPrefix(instruction.ImageDigest, "sha256:")
	if validDigest {
		for _, character := range instruction.ImageDigest[7:] {
			if (character < '0' || character > '9') && (character < 'a' || character > 'f') {
				validDigest = false
				break
			}
		}
	}
	if instruction.APIVersion != "v1" || instruction.RunID == "" || instruction.Workstation.ID == "" || instruction.Workstation.Name == "" || len(instruction.TargetGPUUUIDs) == 0 || len(instruction.TargetGPUUUIDs) > 32 || len(uniqueTargets) != len(instruction.TargetGPUUUIDs) || instruction.DurationSeconds < 10 || instruction.DurationSeconds > 1800 || instruction.MemoryPercent < 50 || instruction.MemoryPercent > 90 || instruction.TemperatureCutoffC < 70 || instruction.TemperatureCutoffC > 90 || !validWorkload || !validDigest || instruction.ExpiresAt.IsZero() {
		return nil, fmt.Errorf("invalid diagnostic instruction")
	}
	return &instruction, nil
}

func (c *Client) ReportDiagnostic(ctx context.Context, credential string, result protocol.DiagnosticResult) error {
	return c.post(ctx, "/api/node/v1/diagnostics/result", credential, result)
}

func (c *Client) post(ctx context.Context, path, credential string, body any) error {
	return c.postJSON(ctx, path, credential, body, nil)
}

func (c *Client) postJSON(ctx context.Context, path, credential string, body, output any) error {
	payload, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("encode request: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("User-Agent", "cluster-node")
	if credential != "" {
		request.Header.Set("Authorization", "Bearer "+credential)
	}
	response, err := c.httpClient.Do(request)
	if err != nil {
		return fmt.Errorf("request %s: %w", path, err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		message, _ := io.ReadAll(io.LimitReader(response.Body, 512))
		return fmt.Errorf("request %s returned %s: %s", path, response.Status, strings.TrimSpace(string(message)))
	}
	if output == nil {
		_, _ = io.Copy(io.Discard, response.Body)
		return nil
	}
	decoder := json.NewDecoder(io.LimitReader(response.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(output); err != nil {
		return fmt.Errorf("decode response from %s: %w", path, err)
	}
	return nil
}
