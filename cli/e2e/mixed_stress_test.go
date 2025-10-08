package e2e

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"testing"

	"github.com/cline/cli/pkg/common"
)

// 9. Mixed localhost vs 127.0.0.1 addresses coexist and are both healthy
func TestMixedLocalhostVs127Coexist(t *testing.T) {
	clineDir := setTempClineDir(t)
	ctx, cancel := context.WithTimeout(context.Background(), longTimeout)
	defer cancel()

	// Start one instance
	_ = mustRunCLI(ctx, t, "instance", "new")

	// Get the running instance and its port/PID
	out := listInstancesJSON(ctx, t)
	if len(out.CoreInstances) == 0 {
		t.Fatalf("expected at least 1 instance")
	}
	inst := out.CoreInstances[0]
	waitForAddressHealthy(t, inst.Address, defaultTimeout)

	// Manually add a SQLite entry for the same port but 127.0.0.1 host
	addr127 := fmt.Sprintf("127.0.0.1:%d", inst.CorePort())
	dbPath := filepath.Join(clineDir, common.SETTINGS_SUBFOLDER, "locks.db")

	if err := insertRemoteInstanceIntoSQLite(t, dbPath, addr127, inst.CorePort(), inst.HostPort()); err != nil {
		t.Fatalf("insert 127 alias entry: %v", err)
	}

	// Verify both addresses appear and are healthy
	waitForAddressHealthy(t, inst.Address, defaultTimeout)
	waitForAddressHealthy(t, addr127, defaultTimeout)

	out = listInstancesJSON(ctx, t)
	if !hasAddress(out, inst.Address) || !hasAddress(out, addr127) {
		t.Fatalf("expected both %s and %s present", inst.Address, addr127)
	}
}

// 10. Start-stop stress: loop starting then killing instances; ensure no leftovers
func TestStartStopStress(t *testing.T) {
	_ = setTempClineDir(t)

	for i := 0; i < 3; i++ { // keep small for CI time
		ctx, cancel := context.WithTimeout(context.Background(), longTimeout)
		defer cancel()

		// Snapshot current addresses
		before := listInstancesJSON(ctx, t)
		beforeSet := map[string]struct{}{}
		for _, it := range before.CoreInstances {
			beforeSet[it.Address] = struct{}{}
		}

		// Start a new instance
		_ = mustRunCLI(ctx, t, "instance", "new")

		// Find the new instance address
		var newAddr string
		waitFor(t, defaultTimeout, func() (bool, string) {
			after := listInstancesJSON(ctx, t)
			for _, it := range after.CoreInstances {
				if _, ok := beforeSet[it.Address]; !ok {
					newAddr = it.Address
					return true, ""
				}
			}
			return false, "new instance address not detected yet"
		})

		// Wait healthy
		waitForAddressHealthy(t, newAddr, defaultTimeout)

		// Get PID using runtime discovery and kill it
		after := listInstancesJSON(ctx, t)
		info, ok := getByAddress(after, newAddr)
		if !ok {
			t.Fatalf("new instance %s missing", newAddr)
		}

		// Get PID using runtime discovery
		corePID := getCorePID(t, info.Address)
		if corePID <= 0 {
			t.Fatalf("could not find PID for new instance at %s", info.Address)
		}

		t.Logf("Killing new instance %s (PID %d) for iteration %d", info.Address, corePID, i)
		if err := syscall.Kill(corePID, syscall.SIGKILL); err != nil {
			t.Fatalf("kill pid %d: %v", corePID, err)
		}

		// Wait removed from SQLite database
		waitForAddressRemoved(t, newAddr, longTimeout)

		// Verify instance is removed from SQLite database
		clineDir := os.Getenv("CLINE_DIR")
		if clineDir != "" {
			dbPath := filepath.Join(clineDir, common.SETTINGS_SUBFOLDER, "locks.db")
			if verifyInstanceExistsInSQLite(t, dbPath, newAddr) {
				t.Fatalf("expected instance removed from SQLite database: %s", newAddr)
			}
		}

		// Clean up dangling host process (SIGKILL leaves these behind by design)
		t.Logf("Cleaning up dangling host process on port %d for iteration %d", info.HostPort(), i)
		findAndKillHostProcess(t, info.HostPort())

		// Verify both ports are now free
		waitForPortsClosed(t, info.CorePort(), info.HostPort(), defaultTimeout)
	}
}
