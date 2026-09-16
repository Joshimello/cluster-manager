package termination

import (
	"context"
	"errors"
	"fmt"
	"os"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/Joshimello/cluster-manager/node/internal/protocol"
)

type Executor interface {
	Execute(context.Context, protocol.TerminationInstruction) protocol.TerminationResult
}

type ProcessProvider func(context.Context) ([]protocol.GPUProcess, error)

type Linux struct {
	processes ProcessProvider
	grace     time.Duration
}

func NewLinux(processes ProcessProvider) *Linux {
	return &Linux{processes: processes, grace: 2 * time.Second}
}

func NewLinuxWithGrace(processes ProcessProvider, grace time.Duration) *Linux {
	return &Linux{processes: processes, grace: grace}
}

func (l *Linux) Execute(ctx context.Context, instruction protocol.TerminationInstruction) protocol.TerminationResult {
	result := protocol.TerminationResult{InstructionID: instruction.InstructionID}
	if runtime.GOOS != "linux" {
		return failed(result, "error", "Process termination is supported only on Linux nodes.")
	}
	if instruction.PID <= 1 || instruction.ProcessStartTicks == 0 || !time.Now().Before(instruction.ExpiresAt) {
		return failed(result, "refused_identity", "Instruction is expired or has an invalid process identity.")
	}
	processes, err := l.processes(ctx)
	if err != nil {
		return failed(result, "error", "Fresh GPU process discovery failed: "+err.Error())
	}
	var observed *protocol.GPUProcess
	for index := range processes {
		if processes[index].PID == instruction.PID {
			observed = &processes[index]
			break
		}
	}
	if observed == nil {
		if _, _, identityErr := ReadIdentity(instruction.PID); errors.Is(identityErr, os.ErrNotExist) {
			return failed(result, "already_exited", "The target process had already exited; no signal was sent.")
		}
		return failed(result, "refused_gpu", "The PID is not present in the fresh NVIDIA process sample.")
	}
	if observed.GPUUUID != instruction.GPUUUID {
		return failed(result, "refused_gpu", "The PID is no longer using the instructed GPU.")
	}
	if observed.UID != instruction.UID || observed.ProcessStartTicks != instruction.ProcessStartTicks {
		return failed(result, "refused_identity", "The GPU process UID or start identity changed.")
	}
	uid, startTicks, err := ReadIdentity(instruction.PID)
	if errors.Is(err, os.ErrNotExist) {
		return failed(result, "already_exited", "The target process exited before signaling; no signal was sent.")
	}
	if err != nil || uid != instruction.UID || startTicks != instruction.ProcessStartTicks {
		return failed(result, "refused_identity", "The host process UID or start identity did not match immediately before signaling.")
	}
	if err := syscall.Kill(instruction.PID, syscall.SIGTERM); err != nil {
		if errors.Is(err, syscall.ESRCH) {
			return failed(result, "already_exited", "The target process exited before SIGTERM; no signal was sent.")
		}
		return failed(result, "error", "SIGTERM failed: "+err.Error())
	}
	result.TermSent = true
	if waitForExit(ctx, instruction.PID, instruction.UID, instruction.ProcessStartTicks, l.grace) {
		return failed(result, "terminated", "The process exited after SIGTERM.")
	}
	if !instruction.AllowSIGKILL {
		return failed(result, "error", "The process remained alive after SIGTERM and SIGKILL was not authorized.")
	}
	uid, startTicks, err = ReadIdentity(instruction.PID)
	if errors.Is(err, os.ErrNotExist) {
		return failed(result, "terminated", "The process exited during the grace period.")
	}
	if err != nil || uid != instruction.UID || startTicks != instruction.ProcessStartTicks {
		return failed(result, "refused_identity", "Process identity changed before SIGKILL; escalation was refused.")
	}
	if err := syscall.Kill(instruction.PID, syscall.SIGKILL); err != nil {
		if errors.Is(err, syscall.ESRCH) {
			return failed(result, "terminated", "The process exited before SIGKILL.")
		}
		return failed(result, "error", "SIGKILL failed: "+err.Error())
	}
	result.KillSent = true
	if waitForExit(ctx, instruction.PID, instruction.UID, instruction.ProcessStartTicks, l.grace) {
		return failed(result, "killed", "The process exited after authorized SIGKILL escalation.")
	}
	return failed(result, "error", "The process still appeared alive after SIGKILL.")
}

func failed(result protocol.TerminationResult, outcome, detail string) protocol.TerminationResult {
	result.Outcome = outcome
	result.Detail = detail
	return result
}

func waitForExit(ctx context.Context, pid int, uid uint32, startTicks uint64, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for {
		currentUID, currentStart, err := ReadIdentity(pid)
		if errors.Is(err, os.ErrNotExist) || (err == nil && (currentUID != uid || currentStart != startTicks)) {
			return true
		}
		if time.Now().After(deadline) || err != nil {
			return false
		}
		timer := time.NewTimer(25 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return false
		case <-timer.C:
		}
	}
}

func ReadIdentity(pid int) (uint32, uint64, error) {
	directory := "/proc/" + strconv.Itoa(pid)
	status, err := os.ReadFile(directory + "/status")
	if err != nil {
		return 0, 0, err
	}
	var uidValue string
	for _, line := range strings.Split(string(status), "\n") {
		if strings.HasPrefix(line, "Uid:") {
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				uidValue = fields[1]
			}
			break
		}
	}
	uid, err := strconv.ParseUint(uidValue, 10, 32)
	if err != nil {
		return 0, 0, fmt.Errorf("process UID unavailable")
	}
	stat, err := os.ReadFile(directory + "/stat")
	if err != nil {
		return 0, 0, err
	}
	closing := strings.LastIndexByte(string(stat), ')')
	if closing < 0 {
		return 0, 0, fmt.Errorf("process start identity unavailable")
	}
	fields := strings.Fields(string(stat)[closing+1:])
	if len(fields) < 20 {
		return 0, 0, fmt.Errorf("process stat is incomplete")
	}
	if fields[0] == "Z" {
		return 0, 0, os.ErrNotExist
	}
	startTicks, err := strconv.ParseUint(fields[19], 10, 64)
	if err != nil {
		return 0, 0, fmt.Errorf("process start identity is invalid")
	}
	return uint32(uid), startTicks, nil
}
