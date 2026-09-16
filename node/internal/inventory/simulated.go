package inventory

import (
	"context"
	"time"

	"github.com/Joshimello/cluster-manager/node/internal/protocol"
)

type Simulated struct {
	Name      string
	Scenario  string
	StartedAt time.Time
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
	return protocol.Heartbeat{
		ObservedAt: time.Now().UTC(), NodeVersion: version, Hostname: s.Name, BootID: "simulation-" + s.Name,
		UptimeSeconds: uint64(time.Since(s.StartedAt).Seconds()) + 3600,
		Inventory: protocol.Inventory{
			OperatingSystem: "Simulated Linux 1.0",
			CPU:             protocol.CPU{LogicalCores: 24, Model: "Simulated Workstation CPU", UtilizationPercent: cpu},
			Memory:          protocol.Memory{TotalBytes: memoryTotal, UsedBytes: memoryTotal * 43 / 100, UtilizationPercent: 43},
			Storage:         protocol.Storage{Path: "/", TotalBytes: storageTotal, UsedBytes: uint64(float64(storageTotal) * disk / 100), UtilizationPercent: disk},
			Sessions:        sessions,
		},
	}, nil
}
