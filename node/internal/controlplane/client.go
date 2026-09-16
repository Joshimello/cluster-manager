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

func New(baseURL string) *Client {
	return &Client{baseURL: strings.TrimRight(baseURL, "/"), httpClient: &http.Client{Timeout: 10 * time.Second}}
}

func (c *Client) Enroll(ctx context.Context, name, token, credential string) error {
	return c.post(ctx, "/api/node/v1/enroll", "", map[string]string{"name": name, "token": token, "credential": credential})
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
	request.Header.Set("User-Agent", "cluster-manager-node")
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

func (c *Client) post(ctx context.Context, path, credential string, body any) error {
	payload, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("encode request: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("User-Agent", "cluster-manager-node")
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
	_, _ = io.Copy(io.Discard, response.Body)
	return nil
}
