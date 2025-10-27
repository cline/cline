package e2e

import (
	"context"
	"fmt"
	"syscall"
	"testing"

	"github.com/cline/cli/pkg/common"
)

// TestStartAndList verifies self-registration and default.json semantics in a fresh CLINE_DIR.
func TestStartAndList(t *testing.T) {
	clineDir := setTempClineDir(t)
	t.Logf("Using temp CLINE_DIR: %s", clineDir)

	ctx, cancel := context.WithTimeout(context.Background(), longTimeout)
	defer cancel()

	t.Logf("Starting new instance...")
	// Start a new instance
	startOutput := mustRunCLI(ctx, t, "instance", "new")
	t.Logf("Instance start output: %s", startOutput)

	// Wait for instance to register in SQLite
	t.Logf("Waiting for instance registration in SQLite...")
	var out common.InstancesOutput
	waitFor(t, defaultTimeout, func() (bool, string) {
		out = listInstancesJSON(ctx, t)
		if len(out.CoreInstances) > 0 {
			return true, ""
		}
		return false, "waiting for instance to appear in registry"
	})
	t.Logf("Found %d instances after start", len(out.CoreInstances))

	if len(out.CoreInstances) != 1 {
		t.Fatalf("expected 1 instance, got %d", len(out.CoreInstances))
	}

	addr := out.CoreInstances[0].Address
	t.Logf("Instance address: %s, status: %s", addr, out.CoreInstances[0].Status)

	t.Logf("Waiting for address %s to become healthy...", addr)
	waitForAddressHealthy(t, addr, defaultTimeout)
	t.Logf("Address %s is now healthy", addr)

	t.Logf("Checking default instance configuration...")
	// Default should be set to the new instance.
	out = listInstancesJSON(ctx, t)
	t.Logf("Default instance: %s", out.DefaultInstance)

	if out.DefaultInstance == "" {
		t.Fatalf("default_instance not set")
	}
	if out.DefaultInstance != out.CoreInstances[0].Address {
		t.Fatalf("expected default_instance=%s, got %s", out.CoreInstances[0].Address, out.DefaultInstance)
	}

	t.Logf("TestStartAndList completed successfully")
}

// TestTaskNewDefault ensures tasks route to default instance.
func TestTaskNewDefault(t *testing.T) {
	_ = setTempClineDir(t)

	ctx, cancel := context.WithTimeout(context.Background(), longTimeout)
	defer cancel()

	// Start one instance
	_ = mustRunCLI(ctx, t, "instance", "new")

	// Wait for instance to register in SQLite
	var out common.InstancesOutput
	waitFor(t, defaultTimeout, func() (bool, string) {
		out = listInstancesJSON(ctx, t)
		if len(out.CoreInstances) > 0 {
			return true, ""
		}
		return false, "waiting for instance to appear in registry"
	})

	if len(out.CoreInstances) != 1 {
		t.Fatalf("expected 1 instance, got %d", len(out.CoreInstances))
	}
	addr := out.CoreInstances[0].Address
	waitForAddressHealthy(t, addr, defaultTimeout)

	// Create a new task at default (success is sufficient)
	_ = mustRunCLI(ctx, t, "task", "new", "hello world")
}

// TestCrashCleanup verifies that after SIGKILL of a local core, the cleanup removes the registry entry.
// Also tests graceful shutdown (SIGTERM) vs crash cleanup and ensures no dangling host processes.
func TestCrashCleanup(t *testing.T) {
	_ = setTempClineDir(t)

	ctx, cancel := context.WithTimeout(context.Background(), longTimeout)
	defer cancel()

	// Start two instances for testing both graceful and crash scenarios
	_ = mustRunCLI(ctx, t, "instance", "new")
	_ = mustRunCLI(ctx, t, "instance", "new")

	// Wait for both instances to register in SQLite
	var out common.InstancesOutput
	waitFor(t, defaultTimeout, func() (bool, string) {
		out = listInstancesJSON(ctx, t)
		if len(out.CoreInstances) >= 2 {
			return true, ""
		}
		return false, fmt.Sprintf("waiting for 2 instances to appear in registry (have %d)", len(out.CoreInstances))
	})

	if len(out.CoreInstances) < 2 {
		t.Fatalf("expected at least 2 instances, got %d", len(out.CoreInstances))
	}

	// Test 1: Graceful shutdown (SIGTERM) - should clean up both processes
	gracefulTarget := out.CoreInstances[0]
	waitForAddressHealthy(t, gracefulTarget.Address, defaultTimeout)

	// Get PID using runtime discovery
	gracefulPID := getCorePID(t, gracefulTarget.Address)
	if gracefulPID <= 0 {
		t.Fatalf("could not find PID for graceful target at %s", gracefulTarget.Address)
	}

	t.Logf("Testing graceful shutdown (SIGTERM) for instance %s (PID %d)", gracefulTarget.Address, gracefulPID)
	if err := syscall.Kill(gracefulPID, syscall.SIGTERM); err != nil {
		t.Fatalf("kill SIGTERM pid %d: %v", gracefulPID, err)
	}

	// Wait for registry cleanup
	waitForAddressRemoved(t, gracefulTarget.Address, longTimeout)

	// Verify both core and host ports are freed (no dangling processes)
	waitForPortsClosed(t, gracefulTarget.CorePort(), gracefulTarget.HostPort(), defaultTimeout)

	// Verify the instance is removed from SQLite (no file to check anymore)
	// The waitForAddressRemoved already confirms the instance is gone from the registry

	// Test 2: Crash cleanup (SIGKILL) - creates dangling host process that we must clean up
	crashTarget := out.CoreInstances[1]
	waitForAddressHealthy(t, crashTarget.Address, defaultTimeout)

	// Get PID using runtime discovery
	crashPID := getCorePID(t, crashTarget.Address)
	if crashPID <= 0 {
		t.Fatalf("could not find PID for crash target at %s", crashTarget.Address)
	}

	t.Logf("Testing crash cleanup (SIGKILL) for instance %s (PID %d)", crashTarget.Address, crashPID)
	if err := syscall.Kill(crashPID, syscall.SIGKILL); err != nil {
		t.Fatalf("kill SIGKILL pid %d: %v", crashPID, err)
	}

	// Wait for registry cleanup
	waitForAddressRemoved(t, crashTarget.Address, longTimeout)

	// Verify the instance is removed from SQLite (no file to check anymore)
	// The waitForAddressRemoved already confirms the instance is gone from the registry

	// Clean up dangling host process (SIGKILL leaves these behind by design)
	t.Logf("Cleaning up dangling host process %s", crashTarget.HostServiceAddress)
	findAndKillHostProcess(t, crashTarget.HostPort())

	// Verify both ports are now free
	waitForPortsClosed(t, crashTarget.CorePort(), crashTarget.HostPort(), defaultTimeout)
}

// itoa is a small helper for readability
func itoa(i int) string {
	return strconvItoa(i)
}

// minimal inline int->string to avoid extra imports in helpers
func strconvItoa(i int) string {
	// simple fast path
	return fmtInt(i)
}

func fmtInt(i int) string {
	// allocate small buffer; ints here are short
	return (func(n int) string {
		return fmt.Sprintf("%d", n)
	})(i)
}
