package diagnostics

import (
	"bufio"
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Joshimello/cluster-manager/node/internal/protocol"
)

const (
	Capability           = "gpu-diagnostics-v1"
	DefaultManifestPath  = "/var/lib/cluster-manager/diagnostics-manifest.json"
	DefaultStatePath     = "/var/lib/cluster-manager/diagnostics-state.json"
	maximumOutputBytes   = 64 * 1024
	SimulatedImageDigest = "sha256:0000000000000000000000000000000000000000000000000000000000000000"
)

var (
	digestPattern       = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)
	uuidPattern         = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`)
	resultPattern       = regexp.MustCompile(`(?m)^[\t ]*GPU ([0-9]+): (OK|FAULTY)\s*$`)
	gflopsPattern       = regexp.MustCompile(`\(([0-9]+(?:\.[0-9]+)?) (?:Gflop/s|GFLOP/s)\)`)
	errorSectionPattern = regexp.MustCompile(`errors:\s*(.*?)\s+temps:`)
	integerPattern      = regexp.MustCompile(`[0-9]+`)
)

type Manifest struct {
	SchemaVersion  int    `json:"schemaVersion"`
	Image          string `json:"image"`
	Digest         string `json:"digest"`
	UpstreamCommit string `json:"upstreamCommit"`
}

func LoadManifest(path string) (Manifest, error) {
	contents, err := os.ReadFile(path)
	if err != nil {
		return Manifest{}, err
	}
	return LoadManifestBytes(contents)
}

func LoadManifestBytes(contents []byte) (Manifest, error) {
	var manifest Manifest
	decoder := json.NewDecoder(bytes.NewReader(contents))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&manifest); err != nil {
		return manifest, fmt.Errorf("decode diagnostics manifest: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return manifest, errors.New("diagnostics manifest contains trailing data")
	}
	if manifest.SchemaVersion != 1 || !strings.HasPrefix(manifest.Image, "ghcr.io/joshimello/cluster-manager/") || !digestPattern.MatchString(manifest.Digest) || len(manifest.UpstreamCommit) < 7 || len(manifest.UpstreamCommit) > 64 {
		return manifest, errors.New("diagnostics manifest is invalid")
	}
	return manifest, nil
}

type commandRunner interface {
	Run(context.Context, string, ...string) ([]byte, error)
}

type osRunner struct{}

func (osRunner) Run(ctx context.Context, name string, args ...string) ([]byte, error) {
	return exec.CommandContext(ctx, name, args...).CombinedOutput()
}

type state struct {
	SchemaVersion int                            `json:"schemaVersion"`
	Instruction   protocol.DiagnosticInstruction `json:"instruction"`
	Unit          string                         `json:"unit"`
	Container     string                         `json:"container"`
	StartedAt     time.Time                      `json:"startedAt"`
	Result        *protocol.DiagnosticResult     `json:"result,omitempty"`
}

type Reporter func(context.Context, protocol.DiagnosticResult) error

type Manager struct {
	manifestPath string
	statePath    string
	logger       *log.Logger
	runner       commandRunner
	mu           sync.Mutex
	running      string
	cancel       context.CancelFunc
	simulate     bool
}

func New(logger *log.Logger) *Manager {
	return &Manager{manifestPath: DefaultManifestPath, statePath: DefaultStatePath, logger: logger, runner: osRunner{}}
}

func NewSimulated(logger *log.Logger) *Manager {
	manager := New(logger)
	manager.simulate = true
	return manager
}

func (m *Manager) Shutdown() {
	m.mu.Lock()
	if m.cancel != nil {
		m.cancel()
	}
	m.mu.Unlock()
	if m.simulate {
		return
	}
	current, err := m.loadState()
	if err != nil || current.Result != nil {
		return
	}
	shutdownContext, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_, _ = m.runner.Run(shutdownContext, "systemctl", "stop", current.Unit+".service")
}

func (m *Manager) Available(ctx context.Context) (string, bool) {
	if m.simulate {
		return SimulatedImageDigest, true
	}
	manifest, err := LoadManifest(m.manifestPath)
	if err != nil {
		return "", false
	}
	for _, binary := range []string{"podman", "nvidia-ctk", "systemd-run", "systemctl", "journalctl"} {
		if _, err := exec.LookPath(binary); err != nil {
			return "", false
		}
	}
	output, err := m.runner.Run(ctx, "nvidia-ctk", "cdi", "list")
	if err != nil || !bytes.Contains(output, []byte("nvidia.com/gpu=")) {
		return "", false
	}
	if _, err := m.runner.Run(ctx, "podman", "image", "exists", manifest.Image+"@"+manifest.Digest); err != nil {
		return "", false
	}
	return manifest.Digest, true
}

func (m *Manager) Handle(ctx context.Context, instruction *protocol.DiagnosticInstruction, workstationName string, reporter Reporter) {
	if instruction == nil {
		return
	}
	if m.simulate {
		m.handleSimulated(ctx, *instruction, reporter)
		return
	}
	m.mu.Lock()
	if instruction.CancelRequested {
		if m.running == instruction.RunID && m.cancel != nil {
			m.cancel()
			m.mu.Unlock()
			return
		}
		stored, stateErr := m.loadState()
		if stateErr == nil && stored.Instruction.RunID == instruction.RunID && stored.Result != nil {
			m.mu.Unlock()
			if reporter(ctx, *stored.Result) == nil {
				_ = os.Remove(m.statePath)
			}
			return
		}
		if stateErr == nil && stored.Instruction.RunID == instruction.RunID && stored.Result == nil {
			runCtx, cancel := context.WithCancel(ctx)
			m.running, m.cancel = instruction.RunID, cancel
			m.mu.Unlock()
			cancel()
			go m.finishExisting(runCtx, stored, reporter)
			return
		}
		m.mu.Unlock()
		if errors.Is(stateErr, os.ErrNotExist) {
			_ = reporter(ctx, protocol.DiagnosticResult{
				RunID:     instruction.RunID,
				Status:    "cancelled",
				Detail:    "The diagnostic was cancelled before a local container was started.",
				OutputLog: "",
				Results:   []protocol.DiagnosticGPUResult{},
			})
		} else if stateErr != nil || stored.Instruction.RunID != instruction.RunID {
			_ = reporter(ctx, protocol.DiagnosticResult{
				RunID:     instruction.RunID,
				Status:    "failed",
				Detail:    "Local diagnostic recovery state does not match this cancellation; no unrecognized unit or container was changed.",
				OutputLog: "",
				Results:   []protocol.DiagnosticGPUResult{},
			})
		}
		return
	}
	if m.running != "" {
		m.mu.Unlock()
		return
	}
	stored, err := m.loadState()
	if err == nil && stored.Result != nil && stored.Instruction.RunID == instruction.RunID {
		m.mu.Unlock()
		if reporter(ctx, *stored.Result) == nil {
			_ = os.Remove(m.statePath)
		}
		return
	}
	if err == nil && stored.Result == nil && stored.Instruction.RunID == instruction.RunID {
		runCtx, cancel := context.WithCancel(ctx)
		m.running, m.cancel = instruction.RunID, cancel
		m.mu.Unlock()
		go m.finishExisting(runCtx, stored, reporter)
		return
	}
	if err == nil && stored.Instruction.RunID != instruction.RunID {
		if stored.Result == nil {
			m.mu.Unlock()
			_ = reporter(ctx, refused(instruction.RunID, "A different unfinished diagnostic is recorded locally; no container was started."))
			return
		}
		if removeErr := os.Remove(m.statePath); removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) {
			m.mu.Unlock()
			_ = reporter(ctx, refused(instruction.RunID, "A completed diagnostic result could not be cleared locally; no container was started."))
			return
		}
	}
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		m.mu.Unlock()
		_ = reporter(ctx, refused(instruction.RunID, "Local diagnostic recovery state is unreadable; no container was started."))
		return
	}
	runCtx, cancel := context.WithCancel(ctx)
	m.running, m.cancel = instruction.RunID, cancel
	m.mu.Unlock()
	go m.execute(runCtx, *instruction, workstationName, reporter)
}

func (m *Manager) handleSimulated(ctx context.Context, instruction protocol.DiagnosticInstruction, reporter Reporter) {
	m.mu.Lock()
	if instruction.CancelRequested {
		if m.running == instruction.RunID && m.cancel != nil {
			m.cancel()
			m.mu.Unlock()
			return
		}
		m.mu.Unlock()
		_ = reporter(ctx, protocol.DiagnosticResult{RunID: instruction.RunID, Status: "cancelled", Detail: "The simulated diagnostic was cancelled before it started.", OutputLog: "", Results: []protocol.DiagnosticGPUResult{}})
		return
	}
	if m.running != "" {
		m.mu.Unlock()
		return
	}
	runCtx, cancel := context.WithCancel(ctx)
	m.running, m.cancel = instruction.RunID, cancel
	m.mu.Unlock()
	go func() {
		defer func() { m.mu.Lock(); m.running, m.cancel = "", nil; m.mu.Unlock() }()
		if err := reporter(runCtx, protocol.DiagnosticResult{RunID: instruction.RunID, Status: "running", Detail: "The simulated gpu-burn diagnostic is running.", OutputLog: "", Results: []protocol.DiagnosticGPUResult{}}); err != nil {
			return
		}
		timer := time.NewTimer(time.Duration(instruction.DurationSeconds) * time.Second)
		defer timer.Stop()
		status, detail := "passed", "The simulated gpu-burn diagnostic completed successfully."
		select {
		case <-runCtx.Done():
			status, detail = "cancelled", "The simulated diagnostic was cancelled."
		case <-timer.C:
		}
		results := make([]protocol.DiagnosticGPUResult, 0, len(instruction.TargetGPUUUIDs))
		for index, uuid := range instruction.TargetGPUUUIDs {
			temperature, utilization, memory, gflops := 72.0+float64(index), 99.0, uint64(instruction.MemoryPercent)*256*1024*1024, 12500.0
			outcome := "passed"
			if status == "cancelled" {
				outcome = "cancelled"
			}
			results = append(results, protocol.DiagnosticGPUResult{GPUUUID: uuid, LocalIndex: index, Model: "Simulated NVIDIA GPU", Outcome: outcome, MaxTemperatureC: &temperature, PeakUtilizationPercent: &utilization, PeakMemoryBytes: &memory, AverageGFLOPS: &gflops, MaximumGFLOPS: &gflops})
		}
		_ = reporter(context.Background(), protocol.DiagnosticResult{RunID: instruction.RunID, Status: status, Detail: detail, OutputLog: "simulated gpu-burn output", Results: results})
	}()
}

func (m *Manager) execute(ctx context.Context, instruction protocol.DiagnosticInstruction, workstationName string, reporter Reporter) {
	defer func() {
		m.mu.Lock()
		m.running, m.cancel = "", nil
		m.mu.Unlock()
	}()

	result, runState, err := m.preflight(ctx, instruction, workstationName)
	if err != nil {
		_ = reporter(context.Background(), result)
		return
	}
	if err := m.writeState(runState); err != nil {
		_ = reporter(context.Background(), refused(instruction.RunID, "Could not persist diagnostic recovery state; no container was started."))
		return
	}
	if err := reporter(ctx, protocol.DiagnosticResult{RunID: instruction.RunID, Status: "running", Detail: "The guarded gpu-burn container is running.", OutputLog: "", Results: []protocol.DiagnosticGPUResult{}}); err != nil {
		_ = os.Remove(m.statePath)
		return
	}

	final := m.run(ctx, runState, true)
	runState.Result = &final
	if err := m.writeState(runState); err != nil {
		m.logger.Printf("persist diagnostic result: %v", err)
	}
	if err := reporter(context.Background(), final); err != nil {
		m.logger.Printf("diagnostic result report failed; it will retry: %v", err)
		return
	}
	_ = os.Remove(m.statePath)
}

func (m *Manager) finishExisting(ctx context.Context, current state, reporter Reporter) {
	defer func() {
		m.mu.Lock()
		m.running, m.cancel = "", nil
		m.mu.Unlock()
	}()
	final := m.run(ctx, current, false)
	current.Result = &final
	if err := m.writeState(current); err != nil {
		m.logger.Printf("persist recovered diagnostic result: %v", err)
	}
	if err := reporter(context.Background(), final); err != nil {
		m.logger.Printf("recovered diagnostic result report failed; it will retry: %v", err)
		return
	}
	_ = os.Remove(m.statePath)
}

func refused(runID, detail string) protocol.DiagnosticResult {
	return protocol.DiagnosticResult{RunID: runID, Status: "refused", Detail: detail, OutputLog: "", Results: []protocol.DiagnosticGPUResult{}}
}

func (m *Manager) preflight(ctx context.Context, instruction protocol.DiagnosticInstruction, workstationName string) (protocol.DiagnosticResult, state, error) {
	empty := state{}
	if instruction.Workstation.Name != workstationName || !time.Now().Before(instruction.ExpiresAt) || !uuidPattern.MatchString(instruction.RunID) {
		result := refused(instruction.RunID, "The instruction is expired or belongs to another workstation; no container was started.")
		return result, empty, errors.New(result.Detail)
	}
	manifest, err := LoadManifest(m.manifestPath)
	if err != nil || manifest.Digest != instruction.ImageDigest {
		result := refused(instruction.RunID, "The requested image digest does not match the root-only release manifest; no container was started.")
		return result, empty, errors.New(result.Detail)
	}
	if instruction.DurationSeconds < 10 || instruction.DurationSeconds > 1800 || instruction.MemoryPercent < 50 || instruction.MemoryPercent > 90 || instruction.TemperatureCutoffC < 70 || instruction.TemperatureCutoffC > 90 || !contains([]string{"fp32", "fp64", "tensor"}, instruction.Workload) {
		result := refused(instruction.RunID, "Diagnostic parameters are outside local safety limits; no container was started.")
		return result, empty, errors.New(result.Detail)
	}
	gpus, err := sampleGPUs(ctx, m.runner)
	if err != nil {
		result := refused(instruction.RunID, "NVIDIA telemetry is unavailable; no container was started.")
		return result, empty, err
	}
	byUUID := map[string]gpuSample{}
	for _, gpu := range gpus {
		byUUID[gpu.UUID] = gpu
	}
	seen := map[string]bool{}
	for _, uuid := range instruction.TargetGPUUUIDs {
		gpu, ok := byUUID[uuid]
		if !ok || seen[uuid] {
			result := refused(instruction.RunID, "The target GPU identity changed; no container was started.")
			return result, empty, errors.New(result.Detail)
		}
		seen[uuid] = true
		if gpu.TemperatureC >= float64(instruction.TemperatureCutoffC) || gpu.TemperatureC >= 90 {
			result := refused(instruction.RunID, "A target GPU is already at or above the thermal cutoff; no container was started.")
			return result, empty, errors.New(result.Detail)
		}
	}
	processes, err := sampleGPUProcessUUIDs(ctx, m.runner)
	if err != nil {
		result := refused(instruction.RunID, "GPU process discovery is unavailable; no container was started.")
		return result, empty, err
	}
	for _, gpuUUID := range processes {
		if seen[gpuUUID] {
			result := refused(instruction.RunID, "A target GPU has an active compute process; no container was started and no process was changed.")
			return result, empty, errors.New(result.Detail)
		}
	}
	digest, available := m.Available(ctx)
	if !available || digest != instruction.ImageDigest {
		result := refused(instruction.RunID, "Podman, NVIDIA CDI, or the pinned diagnostic image is unavailable; no container was started.")
		return result, empty, errors.New(result.Detail)
	}
	unit := "cluster-node-gpu-diagnostic-" + instruction.RunID
	container := "cluster-node-gpu-diagnostic-" + strings.ReplaceAll(instruction.RunID, "-", "")
	return protocol.DiagnosticResult{}, state{SchemaVersion: 1, Instruction: instruction, Unit: unit, Container: container, StartedAt: time.Now().UTC()}, nil
}

func (m *Manager) run(ctx context.Context, current state, start bool) protocol.DiagnosticResult {
	manifest, _ := LoadManifest(m.manifestPath)
	device := "nvidia.com/gpu=all"
	if len(current.Instruction.TargetGPUUUIDs) == 1 {
		device = "nvidia.com/gpu=" + current.Instruction.TargetGPUUUIDs[0]
	}
	arguments := []string{
		"--unit=" + current.Unit, "--collect", "--property=Type=exec", "--property=NoNewPrivileges=yes",
		"--property=PrivateTmp=yes", "--property=ProtectHome=read-only", "--property=TimeoutStopSec=5s", "--",
		"podman", "run", "--rm", "--name", current.Container, "--network=none", "--device", device,
		"--pull=never", "--read-only", "--tmpfs", "/tmp:rw,nosuid,size=1g", "--cap-drop=all", "--security-opt=no-new-privileges", "--pids-limit=128",
		manifest.Image + "@" + manifest.Digest,
		"-m", strconv.Itoa(current.Instruction.MemoryPercent) + "%", "-stts", "5",
	}
	switch current.Instruction.Workload {
	case "fp64":
		arguments = append(arguments, "-d")
	case "tensor":
		arguments = append(arguments, "-tc")
	}
	arguments = append(arguments, strconv.Itoa(current.Instruction.DurationSeconds))
	if start {
		if output, err := m.runner.Run(ctx, "systemd-run", arguments...); err != nil {
			return protocol.DiagnosticResult{RunID: current.Instruction.RunID, Status: "failed", Detail: "The transient diagnostic service could not start.", OutputLog: bounded(string(output)), Results: []protocol.DiagnosticGPUResult{}}
		}
	}

	maximums := map[string]*gpuMaximum{}
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	remaining := time.Until(current.StartedAt.Add(time.Duration(current.Instruction.DurationSeconds+20) * time.Second))
	if remaining < time.Second {
		remaining = time.Second
	}
	deadline := time.NewTimer(remaining)
	defer deadline.Stop()
	status := "failed"
	detail := "The diagnostic service stopped without a valid result."
	for {
		select {
		case <-ctx.Done():
			m.stopUnit(current.Unit)
			status, detail = "cancelled", "The diagnostic was stopped by an administrator or node shutdown."
			goto finished
		case <-deadline.C:
			m.stopUnit(current.Unit)
			status, detail = "failed", "The diagnostic exceeded its local deadline and was stopped."
			goto finished
		case <-ticker.C:
			samples, sampleErr := sampleGPUs(context.Background(), m.runner)
			if sampleErr != nil {
				m.stopUnit(current.Unit)
				status, detail = "failed", "NVIDIA thermal telemetry became unavailable; the diagnostic was stopped."
				goto finished
			}
			for _, sample := range samples {
				if !contains(current.Instruction.TargetGPUUUIDs, sample.UUID) {
					continue
				}
				maximum := maximums[sample.UUID]
				if maximum == nil {
					maximum = &gpuMaximum{}
					maximums[sample.UUID] = maximum
				}
				maximum.add(sample)
				if sample.TemperatureC >= float64(current.Instruction.TemperatureCutoffC) || sample.TemperatureC >= 90 {
					m.stopUnit(current.Unit)
					status, detail = "failed", fmt.Sprintf("Thermal cutoff reached on GPU %d at %.1f °C; the diagnostic was stopped.", sample.Index, sample.TemperatureC)
					goto finished
				}
			}
			active, _ := m.runner.Run(context.Background(), "systemctl", "is-active", current.Unit+".service")
			if strings.TrimSpace(string(active)) != "active" && strings.TrimSpace(string(active)) != "activating" {
				goto finished
			}
		}
	}

finished:
	logs, _ := m.runner.Run(context.Background(), "journalctl", "-u", current.Unit+".service", "--no-pager", "--output=cat", "--lines=2000")
	parsed, faulty, complete := parseResults(string(logs), current.Instruction.TargetGPUUUIDs, maximums)
	if status != "cancelled" && !strings.HasPrefix(detail, "Thermal cutoff") {
		if !complete {
			status, detail = "failed", "gpu-burn did not produce a complete per-GPU result."
		} else if faulty {
			status, detail = "faulty", "gpu-burn reported at least one faulty GPU."
		} else {
			status, detail = "passed", "gpu-burn completed successfully on every target GPU."
		}
	}
	if status == "cancelled" {
		for index := range parsed {
			parsed[index].Outcome = "cancelled"
		}
	} else if status == "failed" {
		for index := range parsed {
			parsed[index].Outcome = "failed"
		}
	}
	return protocol.DiagnosticResult{RunID: current.Instruction.RunID, Status: status, Detail: detail, OutputLog: bounded(string(logs)), Results: parsed}
}

func (m *Manager) stopUnit(unit string) {
	_, _ = m.runner.Run(context.Background(), "systemctl", "stop", unit+".service")
}

type gpuSample struct {
	UUID         string
	Index        int
	Model        string
	Utilization  float64
	MemoryBytes  uint64
	TemperatureC float64
}
type gpuMaximum struct {
	Index                    int
	Model                    string
	Temperature, Utilization float64
	Memory                   uint64
}

func (m *gpuMaximum) add(sample gpuSample) {
	m.Index, m.Model = sample.Index, sample.Model
	if sample.TemperatureC > m.Temperature {
		m.Temperature = sample.TemperatureC
	}
	if sample.Utilization > m.Utilization {
		m.Utilization = sample.Utilization
	}
	if sample.MemoryBytes > m.Memory {
		m.Memory = sample.MemoryBytes
	}
}

func sampleGPUs(ctx context.Context, runner commandRunner) ([]gpuSample, error) {
	output, err := runner.Run(ctx, "nvidia-smi", "--query-gpu=uuid,index,name,utilization.gpu,memory.used,temperature.gpu", "--format=csv,noheader,nounits")
	if err != nil {
		return nil, err
	}
	reader := csv.NewReader(strings.NewReader(string(output)))
	reader.TrimLeadingSpace = true
	records, err := reader.ReadAll()
	if err != nil {
		return nil, err
	}
	result := make([]gpuSample, 0, len(records))
	for _, record := range records {
		if len(record) != 6 {
			return nil, errors.New("invalid NVIDIA telemetry")
		}
		index, e1 := strconv.Atoi(strings.TrimSpace(record[1]))
		utilization, e2 := strconv.ParseFloat(strings.TrimSpace(record[3]), 64)
		memory, e3 := strconv.ParseUint(strings.TrimSpace(record[4]), 10, 64)
		temperature, e4 := strconv.ParseFloat(strings.TrimSpace(record[5]), 64)
		if e1 != nil || e2 != nil || e3 != nil || e4 != nil {
			return nil, errors.New("invalid NVIDIA telemetry")
		}
		result = append(result, gpuSample{UUID: strings.TrimSpace(record[0]), Index: index, Model: strings.TrimSpace(record[2]), Utilization: utilization, MemoryBytes: memory * 1024 * 1024, TemperatureC: temperature})
	}
	return result, nil
}

func sampleGPUProcessUUIDs(ctx context.Context, runner commandRunner) ([]string, error) {
	output, err := runner.Run(ctx, "nvidia-smi", "--query-compute-apps=gpu_uuid", "--format=csv,noheader,nounits")
	if err != nil {
		return nil, err
	}
	records, err := csv.NewReader(strings.NewReader(string(output))).ReadAll()
	if err != nil {
		return nil, err
	}
	result := make([]string, 0, len(records))
	for _, record := range records {
		if len(record) != 1 {
			return nil, errors.New("invalid NVIDIA process telemetry")
		}
		uuid := strings.TrimSpace(record[0])
		if uuid == "" || len(uuid) > 128 {
			return nil, errors.New("invalid NVIDIA process identity")
		}
		result = append(result, uuid)
	}
	return result, nil
}

func parseResults(output string, uuids []string, maximums map[string]*gpuMaximum) ([]protocol.DiagnosticGPUResult, bool, bool) {
	statusByIndex := map[int]string{}
	for _, match := range resultPattern.FindAllStringSubmatch(output, -1) {
		index, _ := strconv.Atoi(match[1])
		statusByIndex[index] = match[2]
	}
	gflops := map[int][]float64{}
	errorCounts := map[int]int{}
	for _, line := range strings.FieldsFunc(output, func(character rune) bool { return character == '\n' || character == '\r' }) {
		for index, match := range gflopsPattern.FindAllStringSubmatch(line, -1) {
			value, _ := strconv.ParseFloat(match[1], 64)
			gflops[index] = append(gflops[index], value)
		}
		if section := errorSectionPattern.FindStringSubmatch(line); len(section) == 2 {
			for index, value := range integerPattern.FindAllString(section[1], -1) {
				parsed, _ := strconv.Atoi(value)
				if parsed > errorCounts[index] {
					errorCounts[index] = parsed
				}
			}
		}
	}
	results := make([]protocol.DiagnosticGPUResult, 0, len(uuids))
	faulty, complete := false, true
	for index, uuid := range uuids {
		status, ok := statusByIndex[index]
		if !ok {
			complete = false
			status = "FAULTY"
		}
		outcome := "passed"
		errorsFound := errorCounts[index]
		if status == "FAULTY" {
			outcome, faulty = "faulty", true
			if errorsFound == 0 {
				errorsFound = 1
			}
		}
		maximum := maximums[uuid]
		var maxTemp, maxUtil *float64
		var maxMemory *uint64
		localIndex := index
		model := "NVIDIA GPU"
		if maximum != nil {
			maxTemp, maxUtil, maxMemory = &maximum.Temperature, &maximum.Utilization, &maximum.Memory
			localIndex, model = maximum.Index, maximum.Model
		}
		values := gflops[index]
		var average, highest *float64
		if len(values) > 0 {
			total, max := 0.0, values[0]
			for _, value := range values {
				total += value
				if value > max {
					max = value
				}
			}
			avg := total / float64(len(values))
			average, highest = &avg, &max
		}
		results = append(results, protocol.DiagnosticGPUResult{GPUUUID: uuid, LocalIndex: localIndex, Model: model, Outcome: outcome, MaxTemperatureC: maxTemp, PeakUtilizationPercent: maxUtil, PeakMemoryBytes: maxMemory, AverageGFLOPS: average, MaximumGFLOPS: highest, ErrorCount: errorsFound})
	}
	return results, faulty, complete
}

func bounded(value string) string {
	value = strings.Map(func(r rune) rune {
		if r == '\x00' {
			return -1
		}
		return r
	}, value)
	if len(value) <= maximumOutputBytes {
		return value
	}
	return value[len(value)-maximumOutputBytes:]
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func (m *Manager) loadState() (state, error) {
	var current state
	contents, err := os.ReadFile(m.statePath)
	if err != nil {
		return current, err
	}
	decoder := json.NewDecoder(bytes.NewReader(contents))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&current); err != nil {
		return current, err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return current, errors.New("diagnostic state contains trailing data")
	}
	if current.SchemaVersion != 1 || !uuidPattern.MatchString(current.Instruction.RunID) || current.Unit != "cluster-node-gpu-diagnostic-"+current.Instruction.RunID || current.Container != "cluster-node-gpu-diagnostic-"+strings.ReplaceAll(current.Instruction.RunID, "-", "") || current.StartedAt.IsZero() {
		return current, errors.New("diagnostic state is invalid")
	}
	return current, nil
}

func (m *Manager) writeState(current state) error {
	contents, err := json.MarshalIndent(current, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(m.statePath), 0o700); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(m.statePath), ".diagnostics-state-")
	if err != nil {
		return err
	}
	name := temporary.Name()
	defer os.Remove(name)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return err
	}
	writer := bufio.NewWriter(temporary)
	if _, err := writer.Write(append(contents, '\n')); err != nil {
		temporary.Close()
		return err
	}
	if err := writer.Flush(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(name, m.statePath)
}
