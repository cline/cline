package e2e

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"syscall"
	"testing"

	"github.com/cline/cli/pkg/common"
)

// 2. Multi-instance start: default_instance remains the first started.
func TestMultiInstanceDefaultUnchanged(t *testing.T) {
	_ = setTempClineDir(t)
	ctx, cancel := context.WithTimeout(context.Background(), longTimeout)
	defer cancel()

	// Start first instance and wait healthy
	_ = mustRunCLI(ctx, t, "instance", "new")
	out1 := listInstancesJSON(ctx, t)
	if len(out1.CoreInstances) != 1 {
		t.Fatalf("expected 1 instance, got %d", len(out1.CoreInstances))
	}
	firstAddr := out1.CoreInstances[0].Address
	waitForAddressHealthy(t, firstAddr, defaultTimeout)

	// Start second instance
	_ = mustRunCLI(ctx, t, "instance", "new")
	out2 := listInstancesJSON(ctx, t)
	if len(out2.CoreInstances) < 2 {
		t.Fatalf("expected at least 2 instances, got %d", len(out2.CoreInstances))
	}

	// Default should remain the first started address
	if out2.DefaultInstance != firstAddr {
		t.Fatalf("default changed; expected %s, got %s", firstAddr, out2.DefaultInstance)
	}
}

// 6. Default.json update after removal of current default
func TestDefaultJsonUpdateAfterRemoval(t *testing.T) {
	_ = setTempClineDir(t)
	ctx, cancel := context.WithTimeout(context.Background(), longTimeout)
	defer cancel()

	// Start two instances
	_ = mustRunCLI(ctx, t, "instance", "new")
	_ = mustRunCLI(ctx, t, "instance", "new")

	out := listInstancesJSON(ctx, t)
	if len(out.CoreInstances) < 2 {
		t.Fatalf("expected at least 2 instances, got %d", len(out.CoreInstances))
	}

	// Choose second as new default
	target := out.CoreInstances[1]
	waitForAddressHealthy(t, target.Address, defaultTimeout)

	// Set as default
	_ = mustRunCLI(ctx, t, "instance", "use", target.Address)

	// Verify default switched
	out = listInstancesJSON(ctx, t)
	if out.DefaultInstance != target.Address {
		t.Fatalf("default_instance not updated to %s (got %s)", target.Address, out.DefaultInstance)
	}

	// Kill the default instance using runtime PID discovery
	corePID := getCorePID(t, target.Address)
	if corePID <= 0 {
		t.Fatalf("could not find PID for core process at %s", target.Address)
	}
	t.Logf("Killing cline-core process PID %d for instance %s", corePID, target.Address)
	if err := syscall.Kill(corePID, syscall.SIGKILL); err != nil {
		t.Fatalf("kill pid %d: %v", corePID, err)
	}

	// Wait for removal
	waitForAddressRemoved(t, target.Address, longTimeout)

	// Clean up dangling host process (SIGKILL leaves these behind by design)
	t.Logf("Cleaning up dangling host process on port %d", target.HostPort())
	findAndKillHostProcess(t, target.HostPort())

	// Ensure default_instance updated to another available instance (or removed if none remain)
	out = listInstancesJSON(ctx, t)

	// If there are instances left, default_instance must be one of them
	if len(out.CoreInstances) > 0 {
		found := false
		for _, it := range out.CoreInstances {
			if out.DefaultInstance == it.Address {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("default_instance %s not set to an existing instance after removal", out.DefaultInstance)
		}
	} else {
		// No instances remain; cli-default-instance.json should be removed
		clineDir := getClineDir(t)
		defPath := filepath.Join(clineDir, common.SETTINGS_SUBFOLDER, "settings", "cli-default-instance.json")
		if _, err := os.Stat(defPath); err == nil {
			t.Fatalf("expected cli-default-instance.json removed when no instances remain")
		}
	}

	// Also verify cli-default-instance.json on disk reflects the in-memory default (if any)
	clineDir := getClineDir(t)
	defPath := filepath.Join(clineDir, common.SETTINGS_SUBFOLDER, "settings", "cli-default-instance.json")
	if len(out.CoreInstances) > 0 {
		raw, err := os.ReadFile(defPath)
		if err != nil {
			t.Fatalf("read cli-default-instance.json: %v", err)
		}
		var tmp struct {
			DefaultInstance string `json:"default_instance"`
		}
		if err := json.Unmarshal(raw, &tmp); err != nil {
			t.Fatalf("unmarshal cli-default-instance.json: %v", err)
		}
		if tmp.DefaultInstance != out.DefaultInstance {
			t.Fatalf("cli-default-instance.json mismatch: file=%s list=%s", tmp.DefaultInstance, out.DefaultInstance)
		}
	}
}

// 11. SQLite database missing (edge): list succeeds and returns empty set
func TestRegistryDirMissingEdge(t *testing.T) {
	clineDir := setTempClineDir(t)

	// Remove the settings directory entirely (which contains locks.db)
	settingsDir := filepath.Join(clineDir, common.SETTINGS_SUBFOLDER)
	if err := os.RemoveAll(settingsDir); err != nil {
		t.Fatalf("RemoveAll(%s): %v", common.SETTINGS_SUBFOLDER, err)
	}

	// Listing should succeed and return empty results
	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()
	out := listInstancesJSON(ctx, t)
	if len(out.CoreInstances) != 0 {
		t.Fatalf("expected 0 instances after removing %s dir, got %d", common.SETTINGS_SUBFOLDER, len(out.CoreInstances))
	}

	// Ensure cli-default-instance.json not present
	defPath := filepath.Join(clineDir, common.SETTINGS_SUBFOLDER, "settings", "cli-default-instance.json")
	if _, err := os.Stat(defPath); err == nil {
		t.Fatalf("expected no cli-default-instance.json after removing %s dir", common.SETTINGS_SUBFOLDER)
	}
}
