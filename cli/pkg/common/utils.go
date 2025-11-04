package common

import (
	"context"
	"fmt"
	"net"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/health/grpc_health_v1"
)

// ParseHostPort parses a host:port address and returns the host and port separately
func ParseHostPort(address string) (string, int, error) {
	host, portStr, err := net.SplitHostPort(address)
	if err != nil {
		return "", 0, err
	}
	port, err := strconv.Atoi(portStr)
	if err != nil {
		return "", 0, err
	}
	return host, port, nil
}

// IsLocalAddress checks if the given host is a local/loopback address
// Supports both IPv4 (localhost, 127.0.0.1) and IPv6 (::1) addresses
func IsLocalAddress(host string) bool {
	// Handle common localhost names
	if host == "localhost" {
		return true
	}

	// Parse as IP and check if it's a loopback
	if ip := net.ParseIP(host); ip != nil {
		return ip.IsLoopback()
	}

	return false
}

// PerformHealthCheck performs a gRPC health check on the given address
// Will return UNKNOWN if the service is unreachable (error)
func PerformHealthCheck(ctx context.Context, address string) (grpc_health_v1.HealthCheckResponse_ServingStatus, error) {
	conn, err := grpc.DialContext(ctx, address, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return grpc_health_v1.HealthCheckResponse_UNKNOWN, err
	}
	defer conn.Close()

	healthClient := grpc_health_v1.NewHealthClient(conn)
	resp, err := healthClient.Check(ctx, &grpc_health_v1.HealthCheckRequest{})
	if err != nil {
		return grpc_health_v1.HealthCheckResponse_UNKNOWN, err
	}

	return resp.Status, nil
}

// It's healthy if we can reach it and it responds with SERVING
func IsInstanceHealthy(ctx context.Context, address string) bool {
	status, err := PerformHealthCheck(ctx, address)
	return err == nil && status == grpc_health_v1.HealthCheckResponse_SERVING
}

// It's (likely) our instance if we can reach it and it responds to health checks
func IsInstanceOurs(ctx context.Context, address string) bool {
	_, err := PerformHealthCheck(ctx, address)
	return err != nil
}

// (unreachable or not serving)
func IsInstanceStale(ctx context.Context, address string) (grpc_health_v1.HealthCheckResponse_ServingStatus, bool, error) {
	status, err := PerformHealthCheck(ctx, address)
	isStale := err != nil || status != grpc_health_v1.HealthCheckResponse_SERVING
	return status, isStale, err
}

// IsPortAvailable checks if a port is available for binding
func IsPortAvailable(port int) bool {
	address := fmt.Sprintf("localhost:%d", port)
	listener, err := net.Listen("tcp", address)
	if err != nil {
		return false
	}
	listener.Close()
	return true
}

// FindAvailablePortPair finds two available ports by letting the OS allocate them
func FindAvailablePortPair() (corePort, hostPort int, err error) {
	coreListener, err := net.Listen("tcp", ":0")
	if err != nil {
		return 0, 0, err
	}
	defer coreListener.Close()

	hostListener, err := net.Listen("tcp", ":0")
	if err != nil {
		return 0, 0, err
	}
	defer hostListener.Close()

	corePort = coreListener.Addr().(*net.TCPAddr).Port
	hostPort = hostListener.Addr().(*net.TCPAddr).Port

	return corePort, hostPort, nil
}

// NormalizeAddressForGRPC converts address to host:port for grpc client with proper normalization
func NormalizeAddressForGRPC(address string) (string, error) {
	host, port, err := ParseHostPort(address)
	if err != nil {
		return "", err
	}

	// Normalize local addresses to localhost for gRPC compatibility
	if IsLocalAddress(host) {
		return fmt.Sprintf("localhost:%d", port), nil
	}

	return address, nil
}

// GetNodeVersion returns the current Node.js version, or "unknown" if unable to detect
func GetNodeVersion() string {
	cmd := exec.Command("node", "--version")
	output, err := cmd.Output()
	if err != nil {
		return "unknown"
	}
	return strings.TrimSpace(string(output))
}

// RetryOperation performs an operation with retry logic
func RetryOperation(maxRetries int, timeoutPerAttempt time.Duration, operation func() error) error {
	var lastErr error

	for attempt := 1; attempt <= maxRetries; attempt++ {
		ctx, cancel := context.WithTimeout(context.Background(), timeoutPerAttempt)

		// Create a channel to capture the operation result
		done := make(chan error, 1)
		go func() {
			done <- operation()
		}()

		select {
		case err := <-done:
			cancel()
			if err == nil {
				return nil // Success
			}
			lastErr = err
		case <-ctx.Done():
			cancel()
			lastErr = ctx.Err()
		}

		// Add delay between attempts (except for the last one)
		if attempt < maxRetries {
			time.Sleep(1 * time.Second)
		}
	}

	return fmt.Errorf(`operation failed to after %d attempts: %w

This is usually caused by an incompatible Node.js version

REQUIREMENTS:
• Node.js version 20+ is required
• Current Node.js version: %s

DEBUGGING STEPS:
1. View recent logs: cline log list
2. Logs are available in: ~/.cline/logs/
3. The most recent cline-core log file is usually valuable

For additional help, visit: https://github.com/cline/cline/issues
`, maxRetries, lastErr, GetNodeVersion())
}
