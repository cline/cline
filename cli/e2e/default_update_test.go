package e2e

import (
	"context"
	"os"
	"path/filepath"
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
