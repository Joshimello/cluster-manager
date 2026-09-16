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
	if err != nil || len(multi.Inventory.Sessions) != 3 {
		t.Fatalf("multi-user scenario not applied: %#v, %v", multi, err)
	}
	_, err = NewSimulated("ws03", "offline").Collect(context.Background(), "test")
	if !errors.Is(err, ErrReportingPaused) {
		t.Fatalf("expected paused reporting, got %v", err)
	}
}
