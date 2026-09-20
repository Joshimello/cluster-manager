package diagnostics

import (
	"context"
	"errors"
	"io"
	"log"
	"strings"
	"testing"

	"github.com/Joshimello/cluster-manager/node/internal/protocol"
)

type runnerFunc func(context.Context, string, ...string) ([]byte, error)

func (function runnerFunc) Run(ctx context.Context, name string, arguments ...string) ([]byte, error) {
	return function(ctx, name, arguments...)
}

func TestLoadManifestBytes(t *testing.T) {
	digest := "sha256:" + strings.Repeat("a", 64)
	manifest, err := LoadManifestBytes([]byte(`{"schemaVersion":1,"image":"ghcr.io/joshimello/cluster-manager/gpu-burn","digest":"` + digest + `","upstreamCommit":"3ead140434da9473582b68452f7115967a7a0581"}`))
	if err != nil || manifest.Digest != digest {
		t.Fatalf("unexpected manifest: %#v, %v", manifest, err)
	}
	if _, err := LoadManifestBytes([]byte(`{"schemaVersion":1,"image":"docker.io/untrusted/image","digest":"` + digest + `","upstreamCommit":"3ead140"}`)); err == nil {
		t.Fatal("expected an untrusted image repository to be rejected")
	}
}

func TestParseResultsUsesFinalStatusAndTelemetryIdentity(t *testing.T) {
	maxima := map[string]*gpuMaximum{
		"GPU-a": {Index: 2, Model: "RTX A", Temperature: 81, Utilization: 99, Memory: 1234},
		"GPU-b": {Index: 7, Model: "RTX B", Temperature: 79, Utilization: 98, Memory: 5678},
	}
	output := "10.0% proc'd: 4 (100 Gflop/s) - 4 (200 Gflop/s) errors: 0 - 2 (WARNING!) temps: 70 C - 71 C\r20.0% proc'd: 8 (120 Gflop/s) - 8 (220 Gflop/s) errors: 0 - 3 (WARNING!) temps: 72 C - 73 C\nTested 2 GPUs:\n\tGPU 0: OK\n\tGPU 1: FAULTY\n"
	results, faulty, complete := parseResults(output, []string{"GPU-a", "GPU-b"}, maxima)
	if !faulty || !complete || len(results) != 2 {
		t.Fatalf("unexpected parse state: faulty=%v complete=%v results=%#v", faulty, complete, results)
	}
	if results[0].LocalIndex != 2 || results[0].Model != "RTX A" || results[0].MaximumGFLOPS == nil || *results[0].MaximumGFLOPS != 120 {
		t.Fatalf("unexpected first result: %#v", results[0])
	}
	if results[1].Outcome != "faulty" || results[1].ErrorCount != 3 || results[1].MaximumGFLOPS == nil || *results[1].MaximumGFLOPS != 220 {
		t.Fatalf("unexpected second result: %#v", results[1])
	}
}

func TestParseResultsRequiresEveryTarget(t *testing.T) {
	_, _, complete := parseResults("GPU 0: OK\n", []string{"GPU-a", "GPU-b"}, nil)
	if complete {
		t.Fatal("expected incomplete final output to fail closed")
	}
}

func TestBoundedOutputKeepsTail(t *testing.T) {
	value := strings.Repeat("a", maximumOutputBytes) + "tail"
	result := bounded(value)
	if len(result) != maximumOutputBytes || !strings.HasSuffix(result, "tail") {
		t.Fatalf("unexpected bounded output length=%d suffix=%q", len(result), result[len(result)-4:])
	}
}

func TestProcessDiscoveryFailsClosed(t *testing.T) {
	runner := runnerFunc(func(context.Context, string, ...string) ([]byte, error) {
		return nil, errors.New("nvidia-smi unavailable")
	})
	if _, err := sampleGPUProcessUUIDs(context.Background(), runner); err == nil {
		t.Fatal("expected process discovery failure to be reported")
	}

	runner = runnerFunc(func(context.Context, string, ...string) ([]byte, error) {
		return []byte("GPU-one\nGPU-two\n"), nil
	})
	processes, err := sampleGPUProcessUUIDs(context.Background(), runner)
	if err != nil || len(processes) != 2 || processes[1] != "GPU-two" {
		t.Fatalf("unexpected process identities: %#v, %v", processes, err)
	}
}

func TestCancellationBeforeLocalStartReportsCancelled(t *testing.T) {
	manager := New(log.New(io.Discard, "", 0))
	manager.statePath = t.TempDir() + "/diagnostic-state.json"
	instruction := &protocol.DiagnosticInstruction{
		RunID:           "123e4567-e89b-42d3-a456-426614174000",
		CancelRequested: true,
	}
	var reported protocol.DiagnosticResult
	manager.Handle(context.Background(), instruction, "node", func(_ context.Context, result protocol.DiagnosticResult) error {
		reported = result
		return nil
	})
	if reported.Status != "cancelled" || reported.RunID != instruction.RunID {
		t.Fatalf("unexpected cancellation report: %#v", reported)
	}
}
