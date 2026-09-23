package diagnostics

import (
	"context"
	"errors"
	"io"
	"log"
	"os"
	"strings"
	"testing"
	"time"

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

func TestPodmanSecurityArgumentsAllowNVIDIACDIHook(t *testing.T) {
	arguments := strings.Join(podmanSecurityArguments("nvidia.com/gpu=all"), " ")
	if strings.Contains(arguments, "--read-only") {
		t.Fatal("a read-only root prevents the NVIDIA CDI hook from starting on supported hosts")
	}
	for _, required := range []string{"--network=none", "--pull=never", "--cap-drop=all", "--security-opt=no-new-privileges", "--pids-limit=128"} {
		if !strings.Contains(arguments, required) {
			t.Fatalf("missing diagnostic isolation option %s", required)
		}
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

func TestStopDiagnosticKillsWorkersBeforeSystemdWrapper(t *testing.T) {
	var calls []string
	manager := New(log.New(io.Discard, "", 0))
	manager.runner = runnerFunc(func(_ context.Context, name string, arguments ...string) ([]byte, error) {
		call := strings.Join(append([]string{name}, arguments...), " ")
		calls = append(calls, call)
		switch {
		case strings.HasPrefix(call, "podman top"):
			return []byte("HPID\n100\n101\n102\n"), nil
		case strings.HasPrefix(call, "podman ps"):
			return nil, nil
		case strings.HasPrefix(call, "nvidia-smi"):
			return nil, nil
		default:
			return nil, nil
		}
	})
	current := state{Unit: "test-unit", Container: "test-container", Instruction: protocol.DiagnosticInstruction{RunID: "test", TargetGPUUUIDs: []string{"GPU-one"}}}
	if !manager.stopDiagnostic(context.Background(), current) {
		t.Fatal("expected cleanup to confirm no active GPU processes")
	}
	want := []string{
		"podman top test-container hpid",
		"kill -KILL 102",
		"kill -KILL 101",
		"kill -KILL 100",
		"podman kill test-container",
		"systemctl stop test-unit.service",
		"podman ps --filter name=test-container --format {{.Names}}",
		"nvidia-smi --query-compute-apps=gpu_uuid --format=csv,noheader,nounits",
	}
	if strings.Join(calls, "\n") != strings.Join(want, "\n") {
		t.Fatalf("unexpected cleanup order:\n%s", strings.Join(calls, "\n"))
	}
}

func TestStopDiagnosticWaitsWhenTargetGPUIsStillBusy(t *testing.T) {
	manager := New(log.New(io.Discard, "", 0))
	manager.runner = runnerFunc(func(_ context.Context, name string, arguments ...string) ([]byte, error) {
		if name == "podman" && len(arguments) > 0 && arguments[0] == "top" {
			return nil, errors.New("container already removed")
		}
		if name == "nvidia-smi" {
			return []byte("GPU-one\n"), nil
		}
		return nil, nil
	})
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	current := state{Unit: "test-unit", Container: "test-container", Instruction: protocol.DiagnosticInstruction{RunID: "test", TargetGPUUUIDs: []string{"GPU-one"}}}
	if manager.stopDiagnostic(ctx, current) {
		t.Fatal("cleanup must not confirm while a target GPU process remains")
	}
}

func TestRunKeepsDeadlineFailureWhenOutputIsIncomplete(t *testing.T) {
	manager := New(log.New(io.Discard, "", 0))
	manager.manifestPath = t.TempDir() + "/manifest.json"
	if err := os.WriteFile(manager.manifestPath, []byte(`{"schemaVersion":1,"image":"ghcr.io/joshimello/cluster-manager/gpu-burn","digest":"sha256:`+strings.Repeat("a", 64)+`","upstreamCommit":"3ead140"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	manager.runner = runnerFunc(func(_ context.Context, name string, arguments ...string) ([]byte, error) {
		if name == "podman" && len(arguments) > 0 && arguments[0] == "top" {
			return nil, errors.New("container already removed")
		}
		return nil, nil
	})
	current := state{
		Unit: "test-unit", Container: "test-container", StartedAt: time.Now().Add(-2 * time.Minute),
		Instruction: protocol.DiagnosticInstruction{RunID: "test", DurationSeconds: 20, TargetGPUUUIDs: []string{"GPU-one"}},
	}
	result := manager.run(context.Background(), current, false)
	if result.Status != "failed" || !strings.Contains(result.Detail, "local deadline") {
		t.Fatalf("expected the deadline reason, got %#v", result)
	}
}
