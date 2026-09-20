package protocol

import "time"

type Session struct {
	Username   string `json:"username"`
	Terminal   string `json:"terminal"`
	RemoteHost string `json:"remoteHost,omitempty"`
}
type CPU struct {
	LogicalCores       int     `json:"logicalCores"`
	Model              string  `json:"model"`
	UtilizationPercent float64 `json:"utilizationPercent"`
}
type Memory struct {
	TotalBytes         uint64  `json:"totalBytes"`
	UsedBytes          uint64  `json:"usedBytes"`
	UtilizationPercent float64 `json:"utilizationPercent"`
}
type Storage struct {
	Path               string  `json:"path"`
	TotalBytes         uint64  `json:"totalBytes"`
	UsedBytes          uint64  `json:"usedBytes"`
	UtilizationPercent float64 `json:"utilizationPercent"`
}
type GPU struct {
	UUID               string   `json:"uuid"`
	Index              int      `json:"index"`
	Model              string   `json:"model"`
	UtilizationPercent float64  `json:"utilizationPercent"`
	MemoryUsedBytes    uint64   `json:"memoryUsedBytes"`
	MemoryTotalBytes   uint64   `json:"memoryTotalBytes"`
	TemperatureC       *float64 `json:"temperatureC,omitempty"`
	PowerWatts         *float64 `json:"powerWatts,omitempty"`
}
type GPUProcess struct {
	GPUUUID           string `json:"gpuUuid"`
	PID               int    `json:"pid"`
	UID               uint32 `json:"uid"`
	Username          string `json:"username"`
	Command           string `json:"command"`
	MemoryUsedBytes   uint64 `json:"memoryUsedBytes"`
	ProcessStartTicks uint64 `json:"processStartTicks,omitempty"`
}
type Inventory struct {
	OperatingSystem string       `json:"operatingSystem"`
	CPU             CPU          `json:"cpu"`
	Memory          Memory       `json:"memory"`
	Storage         Storage      `json:"storage"`
	Sessions        []Session    `json:"sessions"`
	GPUStatus       string       `json:"gpuStatus"`
	GPUs            []GPU        `json:"gpus"`
	GPUProcesses    []GPUProcess `json:"gpuProcesses"`
}
type Heartbeat struct {
	ObservedAt             time.Time `json:"observedAt"`
	NodeVersion            string    `json:"nodeVersion"`
	Capabilities           []string  `json:"capabilities,omitempty"`
	DiagnosticsImageDigest string    `json:"diagnosticsImageDigest,omitempty"`
	Hostname               string    `json:"hostname"`
	BootID                 string    `json:"bootId"`
	UptimeSeconds          uint64    `json:"uptimeSeconds"`
	Inventory              Inventory `json:"inventory"`
}

type DesiredUser struct {
	AssignmentID string `json:"assignmentId"`
	Username     string `json:"username"`
	UID          int    `json:"uid"`
	GID          int    `json:"gid"`
	Enabled      bool   `json:"enabled"`
	PasswordHash string `json:"passwordHash,omitempty"`
	Generation   int    `json:"generation"`
}

type DesiredState struct {
	APIVersion  string    `json:"apiVersion"`
	GeneratedAt time.Time `json:"generatedAt"`
	Workstation struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"workstation"`
	Users []DesiredUser `json:"users"`
}

type ReconciliationResult struct {
	AssignmentID string `json:"assignmentId"`
	Generation   int    `json:"generation"`
	Status       string `json:"status"`
	Message      string `json:"message,omitempty"`
	ErrorCode    string `json:"errorCode,omitempty"`
}

type ReconciliationReport struct {
	Results []ReconciliationResult `json:"results"`
}

type TerminationInstruction struct {
	APIVersion    string `json:"apiVersion"`
	InstructionID string `json:"instructionId"`
	Workstation   struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"workstation"`
	ExpiresAt         time.Time `json:"expiresAt"`
	GPUUUID           string    `json:"gpuUuid"`
	PID               int       `json:"pid"`
	UID               uint32    `json:"uid"`
	ProcessStartTicks uint64    `json:"processStartTicks"`
	AllowSIGKILL      bool      `json:"allowSigkill"`
}

type TerminationResult struct {
	InstructionID string `json:"instructionId"`
	Outcome       string `json:"outcome"`
	Detail        string `json:"detail"`
	TermSent      bool   `json:"termSent"`
	KillSent      bool   `json:"killSent"`
}

type NodeUpdateInstruction struct {
	APIVersion    string `json:"apiVersion"`
	InstructionID string `json:"instructionId"`
	Workstation   struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"workstation"`
	TargetVersion string    `json:"targetVersion"`
	ExpiresAt     time.Time `json:"expiresAt"`
}

type NodeUpdateResult struct {
	InstructionID string `json:"instructionId"`
	Status        string `json:"status"`
	Detail        string `json:"detail"`
}

type DiagnosticInstruction struct {
	APIVersion  string `json:"apiVersion"`
	RunID       string `json:"runId"`
	Workstation struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"workstation"`
	TargetGPUUUIDs     []string  `json:"targetGpuUuids"`
	DurationSeconds    int       `json:"durationSeconds"`
	MemoryPercent      int       `json:"memoryPercent"`
	Workload           string    `json:"workload"`
	TemperatureCutoffC int       `json:"temperatureCutoffC"`
	ImageDigest        string    `json:"imageDigest"`
	ExpiresAt          time.Time `json:"expiresAt"`
	CancelRequested    bool      `json:"cancelRequested"`
}

type DiagnosticGPUResult struct {
	GPUUUID                string   `json:"gpuUuid"`
	LocalIndex             int      `json:"localIndex"`
	Model                  string   `json:"model"`
	Outcome                string   `json:"outcome"`
	MaxTemperatureC        *float64 `json:"maxTemperatureC"`
	PeakUtilizationPercent *float64 `json:"peakUtilizationPercent"`
	PeakMemoryBytes        *uint64  `json:"peakMemoryBytes"`
	AverageGFLOPS          *float64 `json:"averageGflops"`
	MaximumGFLOPS          *float64 `json:"maximumGflops"`
	ErrorCount             int      `json:"errorCount"`
	Detail                 string   `json:"detail,omitempty"`
}

type DiagnosticResult struct {
	RunID     string                `json:"runId"`
	Status    string                `json:"status"`
	Detail    string                `json:"detail"`
	OutputLog string                `json:"outputLog"`
	Results   []DiagnosticGPUResult `json:"results"`
}
