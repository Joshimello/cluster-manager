package agent

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/Joshimello/cluster-manager/node/internal/config"
	"github.com/Joshimello/cluster-manager/node/internal/controlplane"
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
	credential, created, err := loadOrCreateCredential(a.config.CredentialFile, a.config.EnrollmentToken != "")
	if err != nil {
		return err
	}
	if created {
		a.logger.Printf("created node credential at %s", a.config.CredentialFile)
	}
	if a.config.EnrollmentToken != "" {
		if err := a.retry(ctx, "enrollment", func() error {
			return a.client.Enroll(ctx, a.config.WorkstationName, a.config.EnrollmentToken, credential)
		}); err != nil {
			return err
		}
		a.logger.Printf("workstation %s enrolled", a.config.WorkstationName)
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
			err = a.client.Heartbeat(ctx, credential, report)
		}
		if err != nil {
			a.logger.Printf("heartbeat failed: %v; retrying in %s", err, backoff)
			if !wait(ctx, backoff) {
				return ctx.Err()
			}
			backoff = min(backoff*2, 30*time.Second)
			continue
		}
		instruction, terminationErr := a.client.NextTermination(ctx, credential)
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
			if reportErr := a.client.ReportTermination(ctx, credential, result); reportErr != nil {
				a.logger.Printf("termination result report failed: %v", reportErr)
			} else {
				a.logger.Printf("termination instruction %s completed with outcome %s", instruction.InstructionID, result.Outcome)
			}
		}
		state, desiredErr := a.client.DesiredState(ctx, credential)
		if desiredErr != nil {
			a.logger.Printf("desired state unavailable; leaving local accounts unchanged: %v", desiredErr)
		} else {
			results, reconcileErr := a.reconciler.Apply(ctx, state)
			if reconcileErr != nil {
				a.logger.Printf("desired state rejected; leaving local accounts unchanged: %v", reconcileErr)
			} else if len(results) > 0 {
				if err := a.client.ReportReconciliation(ctx, credential, results); err != nil {
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
	contents, err := os.ReadFile(path)
	if err == nil {
		credential := strings.TrimSpace(string(contents))
		if !validCredential(credential) {
			return "", false, fmt.Errorf("credential file %s is invalid", path)
		}
		return credential, false, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return "", false, fmt.Errorf("read credential: %w", err)
	}
	if !allowCreate {
		return "", false, errors.New("node is not enrolled and no enrollment token was provided")
	}
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return "", false, fmt.Errorf("generate credential: %w", err)
	}
	credential := "cmnode_" + base64.RawURLEncoding.EncodeToString(secret)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return "", false, fmt.Errorf("create credential directory: %w", err)
	}
	temporary := path + ".new"
	if err := os.WriteFile(temporary, []byte(credential+"\n"), 0o600); err != nil {
		return "", false, fmt.Errorf("write credential: %w", err)
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
		return "", false, fmt.Errorf("install credential: %w", err)
	}
	if err := os.Chmod(path, 0o600); err != nil {
		return "", false, fmt.Errorf("secure credential: %w", err)
	}
	return credential, true, nil
}

func validCredential(value string) bool {
	if !strings.HasPrefix(value, "cmnode_") || len(value) != len("cmnode_")+43 {
		return false
	}
	_, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(value, "cmnode_"))
	return err == nil
}
