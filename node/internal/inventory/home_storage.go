package inventory

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"os/user"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/Joshimello/cluster-manager/node/internal/protocol"
	"github.com/Joshimello/cluster-manager/node/internal/reconcile"
)

type homeStorageCollector struct {
	workstationName, statePath string
	mu                         sync.Mutex
	running                    bool
	nextIndex                  int
	lastAttempt                time.Time
	values                     []protocol.UserStorage
}

func newHomeStorageCollector(name, path string) *homeStorageCollector {
	return &homeStorageCollector{workstationName: name, statePath: path}
}

// Disk scans run away from the heartbeat, at most once every five minutes.
func (c *homeStorageCollector) snapshot(ctx context.Context) []protocol.UserStorage {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.running && time.Since(c.lastAttempt) >= 5*time.Minute {
		c.running, c.lastAttempt = true, time.Now()
		go func() {
			budget, cancel := context.WithTimeout(ctx, 30*time.Second)
			defer cancel()
			values := c.collect(budget)
			c.mu.Lock()
			c.values, c.running = values, false
			c.mu.Unlock()
		}()
	}
	return append([]protocol.UserStorage(nil), c.values...)
}

func (c *homeStorageCollector) collect(ctx context.Context) []protocol.UserStorage {
	state, err := reconcile.LoadManagedState(c.statePath)
	if err != nil || (c.workstationName != "" && state.WorkstationName != c.workstationName) {
		return nil
	}
	names := make([]string, 0, len(state.Users))
	for name := range state.Users {
		names = append(names, name)
	}
	sort.Strings(names)
	values := []protocol.UserStorage{}
	startIndex := c.nextIndex
	for offset := 0; offset < len(names); offset++ {
		index := (startIndex + offset) % len(names)
		if ctx.Err() != nil {
			c.nextIndex = index
			break
		}
		name := names[index]
		managed := state.Users[name]
		if managed.CreationPhase != "active" || managed.WorkstationID != state.WorkstationID || managed.WorkstationName != state.WorkstationName || managed.UID < 20000 || managed.UID > 59999 {
			continue
		}
		value := protocol.UserStorage{Username: name, UID: uint32(managed.UID), ObservedAt: time.Now().UTC(), Status: "identity_mismatch"}
		account, err := user.Lookup(name)
		if err == nil && account.Uid == strconv.Itoa(managed.UID) && account.Gid == strconv.Itoa(managed.GID) && account.HomeDir == managed.HomeDirectory {
			info, statErr := os.Lstat(managed.HomeDirectory)
			if statErr == nil && info.IsDir() && info.Mode()&os.ModeSymlink == 0 {
				if stat, ok := info.Sys().(*syscall.Stat_t); ok && stat.Uid == uint32(managed.UID) {
					value.Status = "scan_failed"
					if ctx.Err() != nil {
						value.Status = "scan_deferred"
					} else {
						scanContext, cancel := context.WithTimeout(ctx, 5*time.Second)
						bytes, scanErr := homeDiskBytes(scanContext, managed.HomeDirectory)
						cancel()
						if scanErr == nil {
							value.Bytes, value.Status = &bytes, "measured"
						}
					}
				}
			}
		}
		value.ObservedAt = time.Now().UTC()
		values = append(values, value)
		if len(values) == 4096 {
			c.nextIndex = (index + 1) % len(names)
			break
		}
	}
	return values
}

func homeDiskBytes(ctx context.Context, home string) (uint64, error) {
	// Allocated blocks, no following symlinks or crossing filesystem boundaries.
	output, err := exec.CommandContext(ctx, "du", "--summarize", "--block-size=1", "--one-file-system", "--", home).Output()
	if err != nil {
		return 0, err
	}
	fields := strings.Fields(string(output))
	if len(fields) == 0 {
		return 0, errors.New("empty disk usage result")
	}
	return strconv.ParseUint(fields[0], 10, 64)
}
