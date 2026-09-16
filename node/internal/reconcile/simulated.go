package reconcile

import (
	"context"
	"sync"

	"github.com/Joshimello/cluster-manager/node/internal/protocol"
)

type Simulated struct {
	workstationName string
	mu              sync.Mutex
	users           map[string]bool
}

func NewSimulated(workstationName string) *Simulated {
	return &Simulated{workstationName: workstationName, users: make(map[string]bool)}
}

func (s *Simulated) Apply(_ context.Context, state protocol.DesiredState) ([]protocol.ReconciliationResult, error) {
	if err := Validate(state, s.workstationName); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	results := make([]protocol.ReconciliationResult, 0, len(state.Users))
	for _, desired := range state.Users {
		s.users[desired.Username] = desired.Enabled
		message := "Simulated login disabled; home data preserved."
		if desired.Enabled {
			message = "Simulated Linux account and synchronized SSH password applied."
		}
		results = append(results, result(desired, "applied", message))
	}
	return results, nil
}
