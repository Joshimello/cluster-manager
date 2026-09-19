package agent

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"strings"
	"time"

	"github.com/Joshimello/cluster-manager/node/internal/config"
	"github.com/Joshimello/cluster-manager/node/internal/controlplane"
	"github.com/Joshimello/cluster-manager/node/internal/credential"
	"github.com/Joshimello/cluster-manager/node/internal/inventory"
	"github.com/Joshimello/cluster-manager/node/internal/lifecycle"
	"github.com/Joshimello/cluster-manager/node/internal/protocol"
	"github.com/Joshimello/cluster-manager/node/internal/reconcile"
	"github.com/Joshimello/cluster-manager/node/internal/termination"
)

type Agent struct {
	config     config.Config
	version    string
	logger     *log.Logger
	client     *controlplane.Client
	collector  inventory.Collector
	reconciler reconcile.Reconciler
	terminator termination.Executor
	updater    *lifecycle.Manager
}

func New(cfg config.Config, version string, logger *log.Logger) (*Agent, error) {
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	var collector inventory.Collector = inventory.NewSystem()
	var reconciler reconcile.Reconciler = reconcile.NewLinux(cfg.WorkstationName)
	var terminator termination.Executor = termination.NewLinux(inventory.CollectGPUProcesses)
	if cfg.Simulate {
		simulated := inventory.NewSimulated(cfg.WorkstationName, cfg.SimulationScenario)
		collector = simulated
		reconciler = reconcile.NewSimulated(cfg.WorkstationName)
		terminator = simulated
	}
	return &Agent{config: cfg, version: version, logger: logger, client: controlplane.New(cfg.PlatformURL), collector: collector, reconciler: reconciler, terminator: terminator, updater: lifecycle.New(version, os.Stdin, io.Discard, io.Discard)}, nil
}

func (a *Agent) Run(ctx context.Context) error {
	nodeCredential, created, err := loadOrCreateCredential(a.config.CredentialFile, a.config.EnrollmentToken != "")
	if err != nil {
		return err
	}
	if created {
		a.logger.Printf("created node credential at %s", a.config.CredentialFile)
	}
	if a.config.EnrollmentToken != "" {
		if err := a.retry(ctx, "enrollment", func() error {
			_, err := a.client.Enroll(ctx, a.config.WorkstationName, a.config.EnrollmentToken, nodeCredential)
			return err
		}); err != nil {
			return err
		}
		a.logger.Printf("workstation %s enrolled", a.config.WorkstationName)
		path := strings.TrimSpace(os.Getenv("NODE_CONFIG_FILE"))
		if path == "" {
			path = config.DefaultPath
		}
		if _, statErr := os.Stat(path); statErr == nil {
			sanitized := a.config
			sanitized.EnrollmentToken = ""
			if writeErr := config.Write(path, sanitized); writeErr != nil {
				return fmt.Errorf("remove enrollment token from configuration: %w", writeErr)
			}
		}
	} else if created {
		return errors.New("NODE_ENROLLMENT_TOKEN is required for first enrollment")
	}

	backoff := time.Second
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		report, err := a.collector.Collect(ctx, a.version)
		if errors.Is(err, inventory.ErrReportingPaused) {
			a.logger.Printf("reporting paused by simulation scenario")
			if !wait(ctx, a.config.HeartbeatInterval) {
				return ctx.Err()
			}
			continue
		}
		if err == nil {
			report.Capabilities = []string{"managed-update-v1"}
			err = a.client.Heartbeat(ctx, nodeCredential, report)
		}
		if err != nil {
			a.logger.Printf("heartbeat failed: %v; retrying in %s", err, backoff)
			if !wait(ctx, backoff) {
				return ctx.Err()
			}
			backoff = min(backoff*2, 30*time.Second)
			continue
		}
		restarting, updateErr := a.handleManagedUpdate(ctx, nodeCredential)
		if updateErr != nil {
			a.logger.Printf("managed update unavailable: %v", updateErr)
		}
		if restarting {
			a.logger.Printf("managed update installed; handing control to systemd restart")
			return nil
		}
		instruction, terminationErr := a.client.NextTermination(ctx, nodeCredential)
		if terminationErr != nil {
			a.logger.Printf("termination instruction unavailable: %v", terminationErr)
		} else if instruction != nil {
			result := protocol.TerminationResult{InstructionID: instruction.InstructionID}
			if instruction.Workstation.Name != a.config.WorkstationName || !time.Now().Before(instruction.ExpiresAt) {
				result.Outcome = "refused_identity"
				result.Detail = "Instruction is expired or belongs to another workstation."
			} else {
				result = a.terminator.Execute(ctx, *instruction)
			}
			if reportErr := a.client.ReportTermination(ctx, nodeCredential, result); reportErr != nil {
				a.logger.Printf("termination result report failed: %v", reportErr)
			} else {
				a.logger.Printf("termination instruction %s completed with outcome %s", instruction.InstructionID, result.Outcome)
			}
		}
		state, desiredErr := a.client.DesiredState(ctx, nodeCredential)
		if desiredErr != nil {
			a.logger.Printf("desired state unavailable; leaving local accounts unchanged: %v", desiredErr)
		} else {
			results, reconcileErr := a.reconciler.Apply(ctx, state)
			if reconcileErr != nil {
				a.logger.Printf("desired state rejected; leaving local accounts unchanged: %v", reconcileErr)
			} else if len(results) > 0 {
				if err := a.client.ReportReconciliation(ctx, nodeCredential, results); err != nil {
					a.logger.Printf("reconciliation status report failed: %v", err)
				}
			}
		}
		backoff = time.Second
		if !wait(ctx, a.config.HeartbeatInterval) {
			return ctx.Err()
		}
	}
}

func (a *Agent) handleManagedUpdate(ctx context.Context, nodeCredential string) (bool, error) {
	state, stateErr := a.updater.LoadManagedUpdateState()
	if stateErr == nil {
		switch {
		case state.Phase == "prepared" && a.version == state.TargetVersion:
			if !time.Now().Before(state.CreatedAt.Add(lifecycle.ManagedUpdateConfirmationWindow)) {
				return false, errors.New("managed update confirmation window elapsed; waiting for local rollback")
			}
			state, err := a.updater.RecordManagedUpdateHeartbeat(state.InstructionID, time.Now(), a.config.HeartbeatInterval*3)
			if err != nil {
				return false, fmt.Errorf("record updated-node health: %w", err)
			}
			if state.HealthyHeartbeats < 3 {
				a.logger.Printf("managed update %s passed health heartbeat %d of 3", state.InstructionID, state.HealthyHeartbeats)
				return false, nil
			}
			result := protocol.NodeUpdateResult{InstructionID: state.InstructionID, Status: "succeeded", Detail: "The updated node authenticated and completed three consecutive healthy heartbeats."}
			if err := a.client.ReportUpdate(ctx, nodeCredential, result); err != nil {
				return false, fmt.Errorf("report successful update before watchdog deadline: %w", err)
			}
			if err := a.updater.ConfirmManagedUpdate(ctx, state.InstructionID); err != nil {
				return false, fmt.Errorf("confirm successful update: %w", err)
			}
			a.logger.Printf("managed update %s confirmed at %s", state.InstructionID, state.TargetVersion)
			return false, nil
		case state.Phase == "rolled_back" && a.version == state.PreviousVersion:
			result := protocol.NodeUpdateResult{InstructionID: state.InstructionID, Status: "rolled_back", Detail: "The replacement did not confirm healthy before the local deadline; the previous binary and service unit were restored."}
			if err := a.client.ReportUpdate(ctx, nodeCredential, result); err != nil {
				return false, fmt.Errorf("report rolled-back update: %w", err)
			}
			if err := a.updater.ConfirmManagedUpdate(ctx, state.InstructionID); err != nil {
				return false, fmt.Errorf("clean up rolled-back update: %w", err)
			}
			a.logger.Printf("managed update %s rollback reported", state.InstructionID)
			return false, nil
		default:
			return false, nil
		}
	}
	if !errors.Is(stateErr, os.ErrNotExist) {
		return false, fmt.Errorf("local rollback state is unreadable; refusing another update: %w", stateErr)
	}

	instruction, err := a.client.NextUpdate(ctx, nodeCredential)
	if err != nil || instruction == nil {
		return false, err
	}
	result := protocol.NodeUpdateResult{InstructionID: instruction.InstructionID}
	if instruction.Workstation.Name != a.config.WorkstationName || !time.Now().Before(instruction.ExpiresAt) {
		result.Status = "failed"
		result.Detail = "The instruction is expired or belongs to another workstation; no local files were changed."
		return false, a.client.ReportUpdate(ctx, nodeCredential, result)
	}
	if !lifecycle.IsNewerStableVersion(a.version, instruction.TargetVersion) {
		result.Status = "failed"
		result.Detail = "The requested target is not a newer stable release; no local files were changed."
		return false, a.client.ReportUpdate(ctx, nodeCredential, result)
	}
	result.Status = "restarting"
	result.Detail = "The release is being verified and installed with an automatic local rollback deadline."
	if err := a.client.ReportUpdate(ctx, nodeCredential, result); err != nil {
		return false, fmt.Errorf("acknowledge update before local changes: %w", err)
	}
	if err := a.updater.PrepareManagedUpdate(ctx, instruction.InstructionID, instruction.TargetVersion); err != nil {
		if _, stateErr := a.updater.LoadManagedUpdateState(); stateErr == nil {
			return false, fmt.Errorf("prepare update; rollback watchdog remains armed: %w", err)
		}
		failure := protocol.NodeUpdateResult{InstructionID: instruction.InstructionID, Status: "failed", Detail: "The release could not be safely staged; the existing installation was retained."}
		if reportErr := a.client.ReportUpdate(ctx, nodeCredential, failure); reportErr != nil {
			return false, fmt.Errorf("prepare update: %v; report failure: %w", err, reportErr)
		}
		return false, fmt.Errorf("prepare update: %w", err)
	}
	return true, nil
}

func (a *Agent) retry(ctx context.Context, operation string, attempt func() error) error {
	backoff := time.Second
	for {
		if err := attempt(); err != nil {
			a.logger.Printf("%s failed: %v; retrying in %s", operation, err, backoff)
			if !wait(ctx, backoff) {
				return ctx.Err()
			}
			backoff = min(backoff*2, 30*time.Second)
			continue
		}
		return nil
	}
}

func wait(ctx context.Context, duration time.Duration) bool {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func loadOrCreateCredential(path string, allowCreate bool) (string, bool, error) {
	value, err := credential.Load(path)
	if err == nil {
		return value, false, nil
	}
	if !errors.Is(err, os.ErrNotExist) && !errors.Is(errors.Unwrap(err), os.ErrNotExist) {
		return "", false, err
	}
	if !allowCreate {
		return "", false, errors.New("node is not enrolled and no enrollment token was provided")
	}
	value, err = credential.Generate()
	if err != nil {
		return "", false, err
	}
	if err := credential.Write(path, value); err != nil {
		return "", false, err
	}
	return value, true, nil
}

func validCredential(value string) bool { return credential.Valid(value) }
