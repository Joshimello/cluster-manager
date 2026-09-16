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
type Inventory struct {
	OperatingSystem string    `json:"operatingSystem"`
	CPU             CPU       `json:"cpu"`
	Memory          Memory    `json:"memory"`
	Storage         Storage   `json:"storage"`
	Sessions        []Session `json:"sessions"`
}
type Heartbeat struct {
	ObservedAt    time.Time `json:"observedAt"`
	NodeVersion   string    `json:"nodeVersion"`
	Hostname      string    `json:"hostname"`
	BootID        string    `json:"bootId"`
	UptimeSeconds uint64    `json:"uptimeSeconds"`
	Inventory     Inventory `json:"inventory"`
}
