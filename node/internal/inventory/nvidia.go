package inventory

import (
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"strconv"
	"strings"

	"github.com/Joshimello/cluster-manager/node/internal/protocol"
)

const mebibyte = uint64(1024 * 1024)

type commandRunner func(context.Context, string, ...string) ([]byte, error)

func collectNVIDIA(ctx context.Context) (string, []protocol.GPU, []protocol.GPUProcess) {
	return collectNVIDIAWithRunner(ctx, func(ctx context.Context, name string, arguments ...string) ([]byte, error) {
		return exec.CommandContext(ctx, name, arguments...).Output()
	})
}

func CollectGPUProcesses(ctx context.Context) ([]protocol.GPUProcess, error) {
	status, _, processes := collectNVIDIA(ctx)
	if status != "available" {
		return nil, errors.New("NVIDIA process discovery is unavailable")
	}
	return processes, nil
}

func collectNVIDIAWithRunner(ctx context.Context, run commandRunner) (string, []protocol.GPU, []protocol.GPUProcess) {
	output, err := run(ctx, "nvidia-smi",
		"--query-gpu=uuid,index,name,utilization.gpu,memory.used,memory.total,temperature.gpu",
		"--format=csv,noheader,nounits")
	if err != nil {
		return "unavailable", []protocol.GPU{}, []protocol.GPUProcess{}
	}
	gpus, err := parseGPUCSV(output)
	if err != nil {
		return "unavailable", []protocol.GPU{}, []protocol.GPUProcess{}
	}
	known := make(map[string]struct{}, len(gpus))
	for _, gpu := range gpus {
		known[gpu.UUID] = struct{}{}
	}
	processOutput, err := run(ctx, "nvidia-smi",
		"--query-compute-apps=gpu_uuid,pid,used_gpu_memory",
		"--format=csv,noheader,nounits")
	if err != nil {
		return "available", gpus, []protocol.GPUProcess{}
	}
	processes, err := parseProcessCSV(processOutput, known, readProcessIdentity)
	if err != nil {
		return "available", gpus, []protocol.GPUProcess{}
	}
	return "available", gpus, processes
}

func csvRecords(output []byte) ([][]string, error) {
	if strings.TrimSpace(string(output)) == "" {
		return [][]string{}, nil
	}
	reader := csv.NewReader(strings.NewReader(string(output)))
	reader.TrimLeadingSpace = true
	records, err := reader.ReadAll()
	if err != nil {
		return nil, err
	}
	for index := range records {
		for field := range records[index] {
			records[index][field] = strings.TrimSpace(records[index][field])
		}
	}
	return records, nil
}

func parseGPUCSV(output []byte) ([]protocol.GPU, error) {
	records, err := csvRecords(output)
	if err != nil {
		return nil, fmt.Errorf("parse NVIDIA GPU output: %w", err)
	}
	result := make([]protocol.GPU, 0, len(records))
	seen := map[string]struct{}{}
	for _, record := range records {
		if len(record) != 7 {
			return nil, fmt.Errorf("unexpected NVIDIA GPU field count")
		}
		index, err := strconv.Atoi(record[1])
		if err != nil || index < 0 {
			return nil, fmt.Errorf("invalid NVIDIA GPU index")
		}
		utilization, err := strconv.ParseFloat(record[3], 64)
		if err != nil || utilization < 0 || utilization > 100 {
			return nil, fmt.Errorf("invalid NVIDIA GPU utilization")
		}
		usedMiB, err := strconv.ParseUint(record[4], 10, 64)
		if err != nil {
			return nil, fmt.Errorf("invalid NVIDIA used memory")
		}
		totalMiB, err := strconv.ParseUint(record[5], 10, 64)
		if err != nil || usedMiB > totalMiB {
			return nil, fmt.Errorf("invalid NVIDIA total memory")
		}
		if record[0] == "" || len(record[0]) > 128 || record[2] == "" || len(record[2]) > 255 {
			return nil, fmt.Errorf("invalid NVIDIA GPU identity")
		}
		if _, duplicate := seen[record[0]]; duplicate {
			return nil, fmt.Errorf("duplicate NVIDIA GPU UUID")
		}
		seen[record[0]] = struct{}{}
		var temperature *float64
		if record[6] != "" && record[6] != "N/A" && record[6] != "[Not Supported]" {
			parsed, err := strconv.ParseFloat(record[6], 64)
			if err != nil || parsed < -100 || parsed > 250 {
				return nil, fmt.Errorf("invalid NVIDIA GPU temperature")
			}
			temperature = &parsed
		}
		result = append(result, protocol.GPU{UUID: record[0], Index: index, Model: record[2], UtilizationPercent: utilization, MemoryUsedBytes: usedMiB * mebibyte, MemoryTotalBytes: totalMiB * mebibyte, TemperatureC: temperature})
	}
	return result, nil
}

type processIdentity struct {
	UID        uint32
	Username   string
	Command    string
	StartTicks uint64
}

type processIdentityReader func(int) (processIdentity, error)

func parseProcessCSV(output []byte, knownGPUs map[string]struct{}, identity processIdentityReader) ([]protocol.GPUProcess, error) {
	records, err := csvRecords(output)
	if err != nil {
		return nil, fmt.Errorf("parse NVIDIA process output: %w", err)
	}
	result := make([]protocol.GPUProcess, 0, len(records))
	for _, record := range records {
		if len(record) != 3 {
			return nil, fmt.Errorf("unexpected NVIDIA process field count")
		}
		if _, exists := knownGPUs[record[0]]; !exists {
			continue
		}
		pid, err := strconv.Atoi(record[1])
		if err != nil || pid <= 0 {
			continue
		}
		usedMiB, err := strconv.ParseUint(record[2], 10, 64)
		if err != nil {
			continue
		}
		process, err := identity(pid)
		if err != nil {
			// Processes can exit between the NVIDIA and /proc samples.
			continue
		}
		result = append(result, protocol.GPUProcess{GPUUUID: record[0], PID: pid, UID: process.UID, Username: process.Username, Command: process.Command, MemoryUsedBytes: usedMiB * mebibyte, ProcessStartTicks: process.StartTicks})
	}
	return result, nil
}

func readProcessIdentity(pid int) (processIdentity, error) {
	directory := "/proc/" + strconv.Itoa(pid)
	status, err := os.ReadFile(directory + "/status")
	if err != nil {
		return processIdentity{}, err
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
	uid64, err := strconv.ParseUint(uidValue, 10, 32)
	if err != nil {
		return processIdentity{}, errors.New("process UID unavailable")
	}
	account, lookupErr := user.LookupId(uidValue)
	username := uidValue
	if lookupErr == nil && account.Username != "" {
		username = account.Username
	} else if subordinateIDs, readErr := os.ReadFile("/etc/subuid"); readErr == nil {
		if owner := subordinateIDOwner(subordinateIDs, uid64); owner != "" {
			username = owner
		}
	}
	command, err := os.ReadFile(directory + "/comm")
	if err != nil {
		return processIdentity{}, err
	}
	commandName := strings.TrimSpace(string(command))
	if commandName == "" {
		return processIdentity{}, errors.New("process command unavailable")
	}
	if len(commandName) > 128 {
		commandName = commandName[:128]
	}
	stat, err := os.ReadFile(directory + "/stat")
	if err != nil {
		return processIdentity{}, err
	}
	closing := strings.LastIndexByte(string(stat), ')')
	if closing < 0 {
		return processIdentity{}, errors.New("process start identity unavailable")
	}
	fields := strings.Fields(string(stat)[closing+1:])
	if len(fields) < 20 {
		return processIdentity{}, errors.New("process stat is incomplete")
	}
	startTicks, err := strconv.ParseUint(fields[19], 10, 64)
	if err != nil {
		return processIdentity{}, errors.New("process start identity is invalid")
	}
	return processIdentity{UID: uint32(uid64), Username: username, Command: commandName, StartTicks: startTicks}, nil
}

func subordinateIDOwner(contents []byte, id uint64) string {
	for _, line := range strings.Split(string(contents), "\n") {
		fields := strings.Split(strings.TrimSpace(line), ":")
		if len(fields) != 3 || fields[0] == "" {
			continue
		}
		start, startErr := strconv.ParseUint(fields[1], 10, 32)
		count, countErr := strconv.ParseUint(fields[2], 10, 32)
		if startErr == nil && countErr == nil && count > 0 && id >= start && id-start < count {
			return fields[0]
		}
	}
	return ""
}
