package inventory

import (
	"context"
	"errors"
	"testing"
)

func TestSimulationScenarios(t *testing.T) {
	highCPU, err := NewSimulated("ws01", "high-cpu").Collect(context.Background(), "test")
	if err != nil || highCPU.Inventory.CPU.UtilizationPercent < 90 {
		t.Fatalf("high CPU scenario not applied: %#v, %v", highCPU, err)
	}
	multi, err := NewSimulated("ws02", "multi-user").Collect(context.Background(), "test")
	if err != nil || len(multi.Inventory.Sessions) != 3 || len(multi.Inventory.GPUs) != 2 || len(multi.Inventory.GPUProcesses) != 3 {
		t.Fatalf("multi-user scenario not applied: %#v, %v", multi, err)
	}
	changing := NewSimulated("ws01", "normal")
	first, _ := changing.Collect(context.Background(), "test")
	second, _ := changing.Collect(context.Background(), "test")
	if first.Inventory.GPUs[0].UtilizationPercent == second.Inventory.GPUs[0].UtilizationPercent {
		t.Fatal("normal simulation should move between free and busy GPU states")
	}
	free, _ := NewSimulated("ws03", "free-gpus").Collect(context.Background(), "test")
	if len(free.Inventory.GPUProcesses) != 0 || free.Inventory.GPUs[0].UtilizationPercent != 0 {
		t.Fatalf("free GPU scenario not applied: %#v", free.Inventory)
	}
	_, err = NewSimulated("ws03", "offline").Collect(context.Background(), "test")
	if !errors.Is(err, ErrReportingPaused) {
		t.Fatalf("expected paused reporting, got %v", err)
	}
}
