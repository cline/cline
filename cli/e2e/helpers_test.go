package e2e

import (
	"context"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/cline/cli/pkg/cli/global"
	"github.com/cline/cli/pkg/common"
	"github.com/cline/grpc-go/cline"
)

const (
	defaultTimeout  = 30 * time.Second
	longTimeout     = 60 * time.Second
	pollInterval    = 250 * time.Millisecond
	instancesBinRel = "../bin/cline"
)

func repoAwareBinPath(t *testing.T) string {
	// Tests live in repoRoot/cli/e2e. Binary is at repoRoot/cli/bin/cline
	t.Helper()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatalf("Getwd error: %v", err)
	}
	// cli/e2e -> cli/bin/cline
	p := filepath.Clean(filepath.Join(wd, instancesBinRel))
	if _, err := os.Stat(p); err != nil {
		t.Fatalf("CLI binary not found at %s; run `npm run compile-cli` first: %v", p, err)
	}
	return p
}

func setTempClineDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	clineDir := filepath.Join(dir, ".cline")
	if err := os.MkdirAll(clineDir, 0o755); err != nil {
		t.Fatalf("mkdir clineDir: %v", err)
	}
	t.Setenv("CLINE_DIR", clineDir)
	return clineDir
}

func runCLI(ctx context.Context, t *testing.T, args ...string) (string, string, int) {
	t.Helper()
	bin := repoAwareBinPath(t)

	// Ensure CLI uses the same CLINE_DIR as the tests by passing --config=<CLINE_DIR>
	// (InitializeGlobalConfig uses ConfigPath as the base directory for registry.)
	if clineDir := os.Getenv("CLINE_DIR"); clineDir != "" && !contains(args, "--config") {
		// Prepend persistent flag so Cobra sees it regardless of subcommand position
		args = append([]string{"--config", clineDir}, args...)
	}

	cmd := exec.CommandContext(ctx, bin, args...)
	// Run CLI from repo root so relative paths inside CLI (./cli/bin/...) resolve
	if wd, err := os.Getwd(); err == nil {
		repoRoot := filepath.Clean(filepath.Join(wd, "..", ".."))
		cmd.Dir = repoRoot
	}
	// propagate env including CLINE_DIR
	cmd.Env = os.Environ()
	outB, errB := &strings.Builder{}, &strings.Builder{}
	cmd.Stdout = outB
	cmd.Stderr = errB
	err := cmd.Run()
	exit := 0
	if err != nil {
		// Extract exit code if possible
		if ee, ok := err.(*exec.ExitError); ok {
			exit = ee.ExitCode()
		} else {
			exit = -1
		}
	}
	return outB.String(), errB.String(), exit
}

func mustRunCLI(ctx context.Context, t *testing.T, args ...string) string {
	t.Helper()
	out, errOut, exit := runCLI(ctx, t, args...)
	if exit != 0 {
		t.Fatalf("cline %v failed (exit=%d)\nstdout:\n%s\nstderr:\n%s", args, exit, out, errOut)
	}
	return out
}

func listInstancesJSON(ctx context.Context, t *testing.T) common.InstancesOutput {
	t.Helper()
	// Trigger CLI to perform cleanup/health by invoking list (table output is ignored)
	_ = mustRunCLI(ctx, t, "instance", "list")

	// Read from SQLite locks database to build structured output
	clineDir := getClineDir(t)

	// Load default instance from settings file
	defaultInstance := readDefaultInstanceFromSettings(t, clineDir)

	// Load instances from SQLite
	instances := readInstancesFromSQLite(t, clineDir)

	return common.InstancesOutput{
		DefaultInstance: defaultInstance,
		CoreInstances:   instances,
	}
}

func hasAddress(in common.InstancesOutput, addr string) bool {
	for _, it := range in.CoreInstances {
		if it.Address == addr {
			return true
		}
	}
	return false
}

func getByAddress(in common.InstancesOutput, addr string) (common.CoreInstanceInfo, bool) {
	for _, it := range in.CoreInstances {
		if it.Address == addr {
			return it, true
		}
	}
	return common.CoreInstanceInfo{}, false
}

func waitFor(t *testing.T, timeout time.Duration, cond func() (bool, string)) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for {
		ok, msg := cond()
		if ok {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("waitFor timeout: %s", msg)
		}
		time.Sleep(pollInterval)
	}
}

func waitForAddressHealthy(t *testing.T, addr string, timeout time.Duration) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	t.Logf("Waiting for gRPC health check on %s...", addr)

	waitFor(t, timeout, func() (bool, string) {
		if common.IsInstanceHealthy(ctx, addr) {
			return true, ""
		}
		return false, fmt.Sprintf("gRPC health check failed for %s", addr)
	})

	t.Logf("gRPC health check passed for %s", addr)
}

func waitForAddressRemoved(t *testing.T, addr string, timeout time.Duration) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	waitFor(t, timeout, func() (bool, string) {
		out := listInstancesJSON(ctx, t)
		if hasAddress(out, addr) {
			return false, fmt.Sprintf("address %s still present", addr)
		}
		return true, ""
	})
}

func findFreePort(t *testing.T) int {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen 127.0.0.1:0: %v", err)
	}
	defer l.Close()
	_, portStr, _ := net.SplitHostPort(l.Addr().String())
	var port int
	fmt.Sscanf(portStr, "%d", &port)
	return port
}

func getClineDir(t *testing.T) string {
	t.Helper()
	clineDir := os.Getenv("CLINE_DIR")
	if clineDir == "" {
		t.Fatalf("CLINE_DIR not set")
	}
	return clineDir
}

// isPortInUse checks if a port is currently in use by any process
func isPortInUse(port int) bool {
	conn, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
	if err != nil {
		return true // Port is in use
	}
	conn.Close()
	return false // Port is free
}

// waitForPortClosed waits for a port to become free (no process listening)
func waitForPortClosed(t *testing.T, port int, timeout time.Duration) {
	t.Helper()
	waitFor(t, timeout, func() (bool, string) {
		if isPortInUse(port) {
			return false, fmt.Sprintf("port %d still in use", port)
		}
		return true, ""
	})
}

// waitForPortsClosed waits for both core and host ports to become free
func waitForPortsClosed(t *testing.T, corePort, hostPort int, timeout time.Duration) {
	t.Helper()
	waitFor(t, timeout, func() (bool, string) {
		if isPortInUse(corePort) {
			return false, fmt.Sprintf("core port %d still in use", corePort)
		}
		if isPortInUse(hostPort) {
			return false, fmt.Sprintf("host port %d still in use", hostPort)
		}
		return true, ""
	})
}

// findAndKillHostProcess finds and kills any process listening on the host port
// This is used to clean up dangling host processes after SIGKILL tests
func findAndKillHostProcess(t *testing.T, hostPort int) {
	t.Helper()
	// Use lsof to find process listening on the host port
	cmd := exec.Command("lsof", "-ti", fmt.Sprintf(":%d", hostPort))
	output, err := cmd.Output()
	if err != nil {
		// No process found on port - that's fine
		return
	}

	pidStr := strings.TrimSpace(string(output))
	if pidStr == "" {
		return
	}

	var pid int
	if _, err := fmt.Sscanf(pidStr, "%d", &pid); err != nil {
		t.Logf("Warning: could not parse PID from lsof output: %s", pidStr)
		return
	}

	if pid > 0 {
		t.Logf("Cleaning up dangling host process PID %d on port %d", pid, hostPort)
		if err := syscall.Kill(pid, syscall.SIGKILL); err != nil {
			t.Logf("Warning: failed to kill dangling host process %d: %v", pid, err)
		}
	}
}

// getPIDByPort returns the PID of the process listening on the specified port (fallback method)
func getPIDByPort(t *testing.T, port int) int {
	t.Helper()
	cmd := exec.Command("lsof", "-ti", fmt.Sprintf(":%d", port))
	output, err := cmd.Output()
	if err != nil {
		return 0 // Process not found
	}

	pidStr := strings.TrimSpace(string(output))
	if pidStr == "" {
		return 0
	}

	pid, err := strconv.Atoi(pidStr)
	if err != nil {
		t.Logf("Warning: could not parse PID from lsof output: %s", pidStr)
		return 0
	}

	return pid
}

// getCorePIDViaRPC returns the PID of the cline-core process using RPC (preferred method)
func getCorePIDViaRPC(t *testing.T, address string) int {
	t.Helper()

	// Initialize global config to access registry
	clineDir := os.Getenv("CLINE_DIR")
	if clineDir == "" {
		t.Logf("Warning: CLINE_DIR not set, falling back to lsof")
		return getCorePIDViaLsof(t, address)
	}

	cfg := &global.GlobalConfig{
		ConfigPath: clineDir,
	}

	if err := global.InitializeGlobalConfig(cfg); err != nil {
		t.Logf("Warning: failed to initialize global config, falling back to lsof: %v", err)
		return getCorePIDViaLsof(t, address)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Get client for the address
	client, err := global.Clients.GetRegistry().GetClient(ctx, address)
	if err != nil {
		t.Logf("Warning: failed to get client for %s, falling back to lsof: %v", address, err)
		return getCorePIDViaLsof(t, address)
	}

	// Call GetProcessInfo RPC
	processInfo, err := client.State.GetProcessInfo(ctx, &cline.EmptyRequest{})
	if err != nil {
		t.Logf("Warning: GetProcessInfo RPC failed for %s, falling back to lsof: %v", address, err)
		return getCorePIDViaLsof(t, address)
	}

	return int(processInfo.ProcessId)
}

// getCorePIDViaLsof returns the PID using lsof (fallback method)
func getCorePIDViaLsof(t *testing.T, address string) int {
	t.Helper()
	_, portStr, err := net.SplitHostPort(address)
	if err != nil {
		t.Logf("Warning: invalid address format %s", address)
		return 0
	}

	port, err := strconv.Atoi(portStr)
	if err != nil {
		t.Logf("Warning: invalid port in address %s", address)
		return 0
	}

	return getPIDByPort(t, port)
}

// getCorePID returns the PID of the cline-core process for the given address
// Uses RPC first, falls back to lsof if RPC fails
func getCorePID(t *testing.T, address string) int {
	t.Helper()

	// Try RPC first (preferred method)
	if pid := getCorePIDViaRPC(t, address); pid > 0 {
		return pid
	}

	// Fall back to lsof if RPC fails
	return getCorePIDViaLsof(t, address)
}

// getHostPID returns the PID of the cline-host process for the given host port
func getHostPID(t *testing.T, hostPort int) int {
	t.Helper()
	return getPIDByPort(t, hostPort)
}

// contains reports whether slice has the target string.
func contains(slice []string, target string) bool {
	for _, s := range slice {
		if s == target {
			return true
		}
	}
	return false
}
