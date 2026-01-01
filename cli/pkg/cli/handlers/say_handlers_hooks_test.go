package handlers

import (
	"os"
	"path/filepath"
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
	// Repo-scoped hook scripts should always include the repo name (the directory
	// immediately containing .clinerules) even when running inside that repo.
	expected := "workspace/" + filepath.ToSlash(filepath.Join(".clinerules", "hooks", "pre.sh"))
	if got != expected {
		t.Fatalf("expected formatted path to be %q. got=%q", expected, got)
	}
}

func TestFormatHookPath_FallsBackToLastComponents(t *testing.T) {
	// Use an obviously non-workspace path (relative, but not prefixed with cwd).
	got := formatHookPath("/var/tmp/foo/bar/baz.sh")
	if got != "foo/bar/baz.sh" {
		t.Fatalf("expected last 3 components fallback, got=%q", got)
	}
}
