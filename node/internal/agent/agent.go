package agent

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/Joshimello/cluster-manager/node/internal/config"
	"github.com/Joshimello/cluster-manager/node/internal/controlplane"
	"github.com/Joshimello/cluster-manager/node/internal/credential"
	"github.com/Joshimello/cluster-manager/node/internal/inventory"
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
	return &Agent{config: cfg, version: version, logger: logger, client: controlplane.New(cfg.PlatformURL), collector: collector, reconciler: reconciler, terminator: terminator}, nil
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
