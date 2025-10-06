package common

import (
	"time"

	"google.golang.org/grpc/health/grpc_health_v1"
)

// CoreInstanceInfo represents a discovered Cline instance
// This is the canonical definition used across all CLI packages
type CoreInstanceInfo struct {
	// Full core address including port
	Address string `json:"address"`
	// Host bridge service address that core holds (host is ALWAYS running on localhost FYI)
	HostServiceAddress string                                           `json:"host_port"`
	Status             grpc_health_v1.HealthCheckResponse_ServingStatus `json:"status"`
	LastSeen           time.Time                                        `json:"last_seen"`
	ProcessPID         int                                              `json:"process_pid,omitempty"`
	Version            string                                           `json:"version,omitempty"`
}

func (c *CoreInstanceInfo) CorePort() int {
	_, port, _ := ParseHostPort(c.Address)
	return port
}

func (c *CoreInstanceInfo) HostPort() int {
	_, port, _ := ParseHostPort(c.HostServiceAddress)
	return port
}

func (c *CoreInstanceInfo) StatusString() string {
	return c.Status.String()
}

// LockRow represents a row in the locks table
type LockRow struct {
	ID         int64  `json:"id"`
	HeldBy     string `json:"held_by"`
	LockType   string `json:"lock_type"`
	LockTarget string `json:"lock_target"`
	LockedAt   int64  `json:"locked_at"`
}

// InstancesOutput represents the JSON output format for instance listing
type InstancesOutput struct {
	DefaultInstance string             `json:"default_instance"`
	CoreInstances   []CoreInstanceInfo `json:"instances"`
}

type DefaultCoreInstance struct {
	Address     string `json:"default_instance"`
	LastUpdated string `json:"last_updated"`
}
