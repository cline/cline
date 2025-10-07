package e2e

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestMain validates required artifacts exist before running E2E tests.
// It does NOT build artifacts. Build manually via:
//
//	npm run compile-standalone
//	npm run compile-cli
func TestMain(m *testing.M) {
	// Determine repo root from cli/e2e
	wd, err := os.Getwd()
	if err != nil {
		fmt.Fprintf(os.Stderr, "getwd: %v\n", err)
		os.Exit(2)
	}
	repoRoot := filepath.Clean(filepath.Join(wd, "..", ".."))

	cliBin := filepath.Join(repoRoot, "cli", "bin", "cline")
	coreJS := filepath.Join(repoRoot, "dist-standalone", "cline-core.js")

	missing := []string{}
	if _, err := os.Stat(cliBin); err != nil {
		missing = append(missing, cliBin)
	}
	if _, err := os.Stat(coreJS); err != nil {
		missing = append(missing, coreJS)
	}

	if len(missing) > 0 {
		if testing.Short() {
			// Optional quality-of-life: allow skipping with -short when artifacts are absent
			fmt.Fprintf(os.Stderr, "[e2e] skipping (-short) due to missing artifacts:\n  %s\n", strings.Join(missing, "\n  "))
			os.Exit(0)
		}
		fmt.Fprintf(os.Stderr, "Missing required build artifacts for E2E tests:\n  %s\n\nPlease build them first:\n  npm run compile-standalone\n  npm run compile-cli\n", strings.Join(missing, "\n  "))
		os.Exit(2)
	}

	os.Exit(m.Run())
}
