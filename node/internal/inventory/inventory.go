package inventory

import (
	"context"
	"errors"

	"github.com/Joshimello/cluster-manager/node/internal/protocol"
)

var ErrReportingPaused = errors.New("reporting paused by simulation scenario")

type Collector interface {
	Collect(context.Context, string) (protocol.Heartbeat, error)
}
