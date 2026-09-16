package inventory

import (
	"context"
	"sync/atomic"
	"time"

	"github.com/Joshimello/cluster-manager/node/internal/protocol"
)

type Simulated struct {
	Name      string
	Scenario  string
	StartedAt time.Time
	samples   atomic.Uint64
}

func NewSimulated(name, scenario string) *Simulated {
	return &Simulated{Name: name, Scenario: scenario, StartedAt: time.Now()}
}

func (s *Simulated) Collect(_ context.Context, version string) (protocol.Heartbeat, error) {
	if s.Scenario == "offline" {
		return protocol.Heartbeat{}, ErrReportingPaused
	}
	cpu, disk := 24.5, 37.0
	sessions := []protocol.Session{{Username: "researcher", Terminal: "pts/0", RemoteHost: "10.20.0.15"}}
	if s.Scenario == "high-cpu" {
		cpu = 94.2
	}
	if s.Scenario == "high-disk" {
		disk = 96.1
	}
	if s.Scenario == "multi-user" {
		sessions = append(sessions, protocol.Session{Username: "analyst", Terminal: "pts/1", RemoteHost: "10.20.0.16"}, protocol.Session{Username: "operator", Terminal: "tty1"})
	}
	memoryTotal := uint64(64 * 1024 * 1024 * 1024)
	storageTotal := uint64(2 * 1024 * 1024 * 1024 * 1024)
	gpus, gpuProcesses := s.gpuInventory()
	return protocol.Heartbeat{
		ObservedAt: time.Now().UTC(), NodeVersion: version, Hostname: s.Name, BootID: "simulation-" + s.Name,
		UptimeSeconds: uint64(time.Since(s.StartedAt).Seconds()) + 3600,
		Inventory: protocol.Inventory{
			OperatingSystem: "Simulated Linux 1.0",
			CPU:             protocol.CPU{LogicalCores: 24, Model: "Simulated Workstation CPU", UtilizationPercent: cpu},
			Memory:          protocol.Memory{TotalBytes: memoryTotal, UsedBytes: memoryTotal * 43 / 100, UtilizationPercent: 43},
			Storage:         protocol.Storage{Path: "/", TotalBytes: storageTotal, UsedBytes: uint64(float64(storageTotal) * disk / 100), UtilizationPercent: disk},
			Sessions:        sessions,
			GPUStatus:       "available",
			GPUs:            gpus,
			GPUProcesses:    gpuProcesses,
		},
	}, nil
}

func (s *Simulated) gpuInventory() ([]protocol.GPU, []protocol.GPUProcess) {
	sample := s.samples.Add(1)
	temperature0, temperature1 := 41.0, 39.0
	gpus := []protocol.GPU{
		{UUID: "GPU-" + s.Name + "-0000", Index: 0, Model: "NVIDIA RTX PRO 6000 Blackwell", MemoryTotalBytes: 96_000_000_000, TemperatureC: &temperature0},
		{UUID: "GPU-" + s.Name + "-0001", Index: 1, Model: "NVIDIA RTX PRO 6000 Blackwell", MemoryTotalBytes: 96_000_000_000, TemperatureC: &temperature1},
	}
	processes := []protocol.GPUProcess{}
	busy := s.Scenario == "busy-gpus" || s.Scenario == "multi-process" || s.Scenario == "multi-user" || s.Scenario == "owner-use" || s.Scenario == "reservation-conflict" || s.Scenario == "mixed-owner" || s.Scenario == "unknown-owner" || (s.Scenario == "normal" && sample%2 == 0)
	if !busy || s.Scenario == "free-gpus" {
		return gpus, processes
	}
	gpus[0].UtilizationPercent = 72 + float64(sample%12)
	gpus[0].MemoryUsedBytes = 38_000_000_000
	temperature0 = 67
	gpus[0].TemperatureC = &temperature0
	processes = append(processes, protocol.GPUProcess{GPUUUID: gpus[0].UUID, PID: 4102, UID: 1001, Username: "researcher", Command: "python", MemoryUsedBytes: 38_000_000_000, ProcessStartTicks: 812345})
	if s.Scenario == "owner-use" || s.Scenario == "reservation-conflict" || s.Scenario == "mixed-owner" || s.Scenario == "unknown-owner" {
		username, uid := "alice", uint32(1001)
		if s.Scenario == "reservation-conflict" {
			username, uid = "bob", 1002
		}
		if s.Scenario == "unknown-owner" {
			username, uid = "unknown", 65534
		}
		processes = []protocol.GPUProcess{{GPUUUID: gpus[0].UUID, PID: 6101, UID: uid, Username: username, Command: "python", MemoryUsedBytes: 30_000_000_000, ProcessStartTicks: 1_012_345}}
		if s.Scenario == "mixed-owner" {
			processes = append(processes, protocol.GPUProcess{GPUUUID: gpus[0].UUID, PID: 6102, UID: 1002, Username: "bob", Command: "trainer", MemoryUsedBytes: 8_000_000_000, ProcessStartTicks: 1_012_400})
		}
	}
	if s.Scenario == "multi-process" || s.Scenario == "multi-user" {
		gpus[1].UtilizationPercent = 54 + float64(sample%10)
		gpus[1].MemoryUsedBytes = 24_000_000_000
		temperature1 = 61
		gpus[1].TemperatureC = &temperature1
		processes = append(processes,
			protocol.GPUProcess{GPUUUID: gpus[1].UUID, PID: 5210, UID: 1002, Username: "analyst", Command: "python", MemoryUsedBytes: 18_000_000_000, ProcessStartTicks: 923456},
			protocol.GPUProcess{GPUUUID: gpus[1].UUID, PID: 5277, UID: 1002, Username: "analyst", Command: "llama-server", MemoryUsedBytes: 6_000_000_000, ProcessStartTicks: 923999},
		)
	}
	return gpus, processes
}
