package inventory

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Joshimello/cluster-manager/node/internal/protocol"
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
	for scenario, usernames := range map[string][]string{
		"owner-use":            {"alice"},
		"reservation-conflict": {"bob"},
		"mixed-owner":          {"alice", "bob"},
		"unknown-owner":        {"unknown"},
	} {
		report, scenarioErr := NewSimulated("ws03", scenario).Collect(context.Background(), "test")
		if scenarioErr != nil || len(report.Inventory.GPUProcesses) != len(usernames) {
			t.Fatalf("%s process count: %#v, %v", scenario, report.Inventory.GPUProcesses, scenarioErr)
		}
		for index, username := range usernames {
			if report.Inventory.GPUProcesses[index].Username != username {
				t.Fatalf("%s process %d should belong to %s: %#v", scenario, index, username, report.Inventory.GPUProcesses[index])
			}
		}
	}
	_, err = NewSimulated("ws03", "offline").Collect(context.Background(), "test")
	if !errors.Is(err, ErrReportingPaused) {
		t.Fatalf("expected paused reporting, got %v", err)
	}
}

func TestSimulatedTerminationRemovesOnlyExactTarget(t *testing.T) {
	simulated := NewSimulated("ws01", "reservation-conflict")
	report, err := simulated.Collect(context.Background(), "test")
	if err != nil || len(report.Inventory.GPUProcesses) != 1 {
		t.Fatalf("expected one simulated conflict: %#v, %v", report.Inventory.GPUProcesses, err)
	}
	target := report.Inventory.GPUProcesses[0]
	instruction := protocol.TerminationInstruction{
		APIVersion:        "v1",
		InstructionID:     "instruction-1",
		ExpiresAt:         time.Now().Add(time.Minute),
		GPUUUID:           target.GPUUUID,
		PID:               target.PID,
		UID:               target.UID,
		ProcessStartTicks: target.ProcessStartTicks,
	}
	instruction.Workstation.Name = "ws01"
	wrong := instruction
	wrong.ProcessStartTicks++
	if result := simulated.Execute(context.Background(), wrong); result.Outcome != "refused_identity" || result.TermSent {
		t.Fatalf("mismatched identity must be refused: %#v", result)
	}
	if result := simulated.Execute(context.Background(), instruction); result.Outcome != "terminated" || !result.TermSent {
		t.Fatalf("exact target should terminate: %#v", result)
	}
	report, _ = simulated.Collect(context.Background(), "test")
	if len(report.Inventory.GPUProcesses) != 0 {
		t.Fatalf("terminated process should stay absent: %#v", report.Inventory.GPUProcesses)
	}
	if result := simulated.Execute(context.Background(), instruction); result.Outcome != "already_exited" || result.TermSent {
		t.Fatalf("replay should be harmless: %#v", result)
	}
}
