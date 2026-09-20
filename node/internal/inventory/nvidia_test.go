package inventory

import (
	"context"
	"errors"
	"testing"
)

func TestParseGPUCSV(t *testing.T) {
	gpus, err := parseGPUCSV([]byte("GPU-a, 0, NVIDIA RTX PRO 6000, 72, 1024, 98304, 67, 312.5\nGPU-b, 1, NVIDIA RTX PRO 6000, 0, 0, 98304, N/A, N/A\n"))
	if err != nil || len(gpus) != 2 {
		t.Fatalf("unexpected GPUs: %#v, %v", gpus, err)
	}
	if gpus[0].MemoryUsedBytes != 1024*mebibyte || gpus[0].TemperatureC == nil || gpus[0].PowerWatts == nil || *gpus[0].PowerWatts != 312.5 || gpus[1].TemperatureC != nil || gpus[1].PowerWatts != nil {
		t.Fatalf("unexpected GPU telemetry: %#v", gpus)
	}
}

func TestParseProcessCSVSkipsExitedProcesses(t *testing.T) {
	known := map[string]struct{}{"GPU-a": {}}
	processes, err := parseProcessCSV([]byte("GPU-a, 4102, 2048\nGPU-a, 9999, 100\nGPU-unknown, 7, 50\n"), known, func(pid int) (processIdentity, error) {
		if pid == 9999 {
			return processIdentity{}, errors.New("exited")
		}
		return processIdentity{UID: 1001, Username: "researcher", Command: "python", StartTicks: 812345}, nil
	})
	if err != nil || len(processes) != 1 {
		t.Fatalf("unexpected processes: %#v, %v", processes, err)
	}
	if processes[0].Username != "researcher" || processes[0].MemoryUsedBytes != 2048*mebibyte {
		t.Fatalf("unexpected process: %#v", processes[0])
	}
}

func TestNVIDIAUnavailableDoesNotFailCollection(t *testing.T) {
	status, gpus, processes := collectNVIDIAWithRunner(context.Background(), func(context.Context, string, ...string) ([]byte, error) {
		return nil, errors.New("nvidia-smi not found")
	})
	if status != "unavailable" || len(gpus) != 0 || len(processes) != 0 {
		t.Fatalf("unexpected unavailable result: %q %#v %#v", status, gpus, processes)
	}
}

func TestSubordinateIDOwner(t *testing.T) {
	contents := []byte("researcher:100000:65536\nanalyst:165536:65536\ninvalid\n")
	if owner := subordinateIDOwner(contents, 100042); owner != "researcher" {
		t.Fatalf("expected researcher, got %q", owner)
	}
	if owner := subordinateIDOwner(contents, 165600); owner != "analyst" {
		t.Fatalf("expected analyst, got %q", owner)
	}
	if owner := subordinateIDOwner(contents, 99999); owner != "" {
		t.Fatalf("expected no owner, got %q", owner)
	}
}
