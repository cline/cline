package handlers

import "testing"

func TestFormatHookPath_HomeDirToTilde(t *testing.T) {
	// NOTE: this test relies on HOME being set by the test environment.
	home, err := getHomeDir()
	if err != nil || home == "" {
		t.Skip("HOME not set; skipping")
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

