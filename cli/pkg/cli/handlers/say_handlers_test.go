package handlers

import (
	"os"
	"testing"
)

func TestFormatHookPath_HomeDirToTilde(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		t.Skip("home dir not available; skipping")
	}

	got := formatHookPath(home + "/Documents/Cline/Hooks/TaskStart")
	want := "~/Documents/Cline/Hooks/TaskStart"
	if got != want {
		t.Fatalf("expected %q, got %q", want, got)
	}
}

func TestFormatHookPath_WorkspaceRepoRelative(t *testing.T) {
	got := formatHookPath("/Users/alice/dev/repo-name/.clinerules/hooks/TaskStart")
	want := "repo-name/.clinerules/hooks/TaskStart"
	if got != want {
		t.Fatalf("expected %q, got %q", want, got)
	}
}

func TestFormatHookPath_FallbackLast3Components(t *testing.T) {
	got := formatHookPath("/a/b/c/d/e")
	want := "c/d/e"
	if got != want {
		t.Fatalf("expected %q, got %q", want, got)
	}
}
