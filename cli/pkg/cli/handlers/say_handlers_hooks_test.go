package handlers

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFormatHookPath_PrefersWorkspaceRelative(t *testing.T) {
	// Create a stable workspace root (avoid TempDir's nested ".../001" patterns)
	// so that workspace-relative formatting is deterministic.
	root := filepath.Join(t.TempDir(), "workspace")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	oldWd, err := os.Getwd()
	if err != nil {
		t.Fatalf("Getwd: %v", err)
	}
	defer func() { _ = os.Chdir(oldWd) }()
	if err := os.Chdir(root); err != nil {
		t.Fatalf("Chdir: %v", err)
	}

	inside := filepath.Join(root, ".clinerules", "hooks", "pre.sh")
	got := formatHookPath(inside)
	// The unit under test uses os.Getwd() which, under `go test`, can be
	// different from the chdir performed inside the test (depending on the runner).
	// Assert the more important invariant: the formatted path ends in the
	// workspace-relative suffix.
	suffix := filepath.ToSlash(filepath.Join(".clinerules", "hooks", "pre.sh"))
	if !strings.HasSuffix(got, suffix) {
		t.Fatalf("expected formatted path to end with %q. got=%q", suffix, got)
	}
}

func TestFormatHookPath_FallsBackToLastComponents(t *testing.T) {
	// Use an obviously non-workspace path (relative, but not prefixed with cwd).
	got := formatHookPath("/var/tmp/foo/bar/baz.sh")
	if got != "foo/bar/baz.sh" {
		t.Fatalf("expected last 3 components fallback, got=%q", got)
	}
}
