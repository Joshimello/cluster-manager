package inventory

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/Joshimello/cluster-manager/node/internal/protocol"
)

type System struct{ startedAt time.Time }

func NewSystem() *System { return &System{startedAt: time.Now()} }

func (s *System) Collect(ctx context.Context, version string) (protocol.Heartbeat, error) {
	hostname, err := os.Hostname()
	if err != nil {
		return protocol.Heartbeat{}, fmt.Errorf("hostname: %w", err)
	}
	uptime := uint64(time.Since(s.startedAt).Seconds())
	if value, err := firstField("/proc/uptime"); err == nil {
		if parsed, err := strconv.ParseFloat(value, 64); err == nil && parsed >= 0 {
			uptime = uint64(parsed)
		}
	}
	bootID := hostname + "-current-boot"
	if value, err := os.ReadFile("/proc/sys/kernel/random/boot_id"); err == nil && strings.TrimSpace(string(value)) != "" {
		bootID = strings.TrimSpace(string(value))
	}
	cpuPercent, err := cpuUtilization(ctx)
	if err != nil {
		return protocol.Heartbeat{}, err
	}
	memory, err := memoryInventory()
	if err != nil {
		return protocol.Heartbeat{}, err
	}
	storage, err := storageInventory("/")
	if err != nil {
		return protocol.Heartbeat{}, err
	}
	gpuStatus, gpus, gpuProcesses := collectNVIDIA(ctx)
	return protocol.Heartbeat{ObservedAt: time.Now().UTC(), NodeVersion: version, Hostname: hostname, BootID: bootID, UptimeSeconds: uptime, Inventory: protocol.Inventory{OperatingSystem: operatingSystem(), CPU: protocol.CPU{LogicalCores: runtime.NumCPU(), Model: cpuModel(), UtilizationPercent: cpuPercent}, Memory: memory, Storage: storage, Sessions: sessions(ctx), GPUStatus: gpuStatus, GPUs: gpus, GPUProcesses: gpuProcesses}}, nil
}

func firstField(path string) (string, error) {
	contents, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	fields := strings.Fields(string(contents))
	if len(fields) == 0 {
		return "", fmt.Errorf("%s is empty", path)
	}
	return fields[0], nil
}

type cpuTimes struct{ idle, total uint64 }

func readCPUTimes() (cpuTimes, error) {
	contents, err := os.ReadFile("/proc/stat")
	if err != nil {
		return cpuTimes{}, fmt.Errorf("read CPU stats: %w", err)
	}
	fields := strings.Fields(strings.SplitN(string(contents), "\n", 2)[0])
	if len(fields) < 5 || fields[0] != "cpu" {
		return cpuTimes{}, fmt.Errorf("unexpected /proc/stat format")
	}
	var values []uint64
	for _, field := range fields[1:] {
		value, err := strconv.ParseUint(field, 10, 64)
		if err != nil {
			return cpuTimes{}, fmt.Errorf("parse CPU stats: %w", err)
		}
		values = append(values, value)
	}
	var total uint64
	for _, value := range values {
		total += value
	}
	idle := values[3]
	if len(values) > 4 {
		idle += values[4]
	}
	return cpuTimes{idle: idle, total: total}, nil
}

func cpuUtilization(ctx context.Context) (float64, error) {
	start, err := readCPUTimes()
	if err != nil {
		if runtime.GOOS != "linux" {
			return 0, nil
		}
		return 0, err
	}
	timer := time.NewTimer(100 * time.Millisecond)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return 0, ctx.Err()
	case <-timer.C:
	}
	end, err := readCPUTimes()
	if err != nil {
		return 0, err
	}
	total := end.total - start.total
	if total == 0 {
		return 0, nil
	}
	busy := total - (end.idle - start.idle)
	return float64(busy) * 100 / float64(total), nil
}

func memoryInventory() (protocol.Memory, error) {
	file, err := os.Open("/proc/meminfo")
	if err != nil {
		if runtime.GOOS != "linux" {
			return protocol.Memory{}, nil
		}
		return protocol.Memory{}, fmt.Errorf("read memory stats: %w", err)
	}
	defer file.Close()
	values := map[string]uint64{}
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) >= 2 {
			value, parseErr := strconv.ParseUint(fields[1], 10, 64)
			if parseErr == nil {
				values[strings.TrimSuffix(fields[0], ":")] = value * 1024
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return protocol.Memory{}, err
	}
	total, available := values["MemTotal"], values["MemAvailable"]
	if total == 0 {
		return protocol.Memory{}, fmt.Errorf("MemTotal missing from /proc/meminfo")
	}
	used := total - available
	return protocol.Memory{TotalBytes: total, UsedBytes: used, UtilizationPercent: float64(used) * 100 / float64(total)}, nil
}

func storageInventory(path string) (protocol.Storage, error) {
	var stats syscall.Statfs_t
	if err := syscall.Statfs(path, &stats); err != nil {
		return protocol.Storage{}, fmt.Errorf("filesystem stats: %w", err)
	}
	total := uint64(stats.Blocks) * uint64(stats.Bsize)
	available := uint64(stats.Bavail) * uint64(stats.Bsize)
	used := total - available
	percent := float64(0)
	if total > 0 {
		percent = float64(used) * 100 / float64(total)
	}
	return protocol.Storage{Path: path, TotalBytes: total, UsedBytes: used, UtilizationPercent: percent}, nil
}

func cpuModel() string {
	file, err := os.Open("/proc/cpuinfo")
	if err != nil {
		return runtime.GOARCH + " CPU"
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		if key, value, found := strings.Cut(scanner.Text(), ":"); found && strings.TrimSpace(key) == "model name" {
			return strings.TrimSpace(value)
		}
	}
	return runtime.GOARCH + " CPU"
}

func operatingSystem() string {
	contents, err := os.ReadFile("/etc/os-release")
	if err != nil {
		return runtime.GOOS
	}
	for _, line := range strings.Split(string(contents), "\n") {
		if strings.HasPrefix(line, "PRETTY_NAME=") {
			return strings.Trim(strings.TrimPrefix(line, "PRETTY_NAME="), `"`)
		}
	}
	return runtime.GOOS
}

func sessions(ctx context.Context) []protocol.Session {
	output, err := exec.CommandContext(ctx, "who").Output()
	if err != nil {
		return []protocol.Session{}
	}
	result := []protocol.Session{}
	for _, line := range strings.Split(strings.TrimSpace(string(output)), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		session := protocol.Session{Username: fields[0], Terminal: fields[1]}
		if len(fields) > 4 {
			session.RemoteHost = strings.Trim(fields[len(fields)-1], "()")
		}
		result = append(result, session)
	}
	return result
}
