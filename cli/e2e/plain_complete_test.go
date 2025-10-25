package e2e

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

// TestPlainOutputVersion tests version command plain output
func TestPlainOutputVersion(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Test plain output
	out := mustRunCLI(ctx, t, "version", "--output-format", "plain")

	// Should NOT be JSON
	if json.Valid([]byte(out)) {
		t.Error("plain output should not be JSON")
	}

	// Should contain version information
	if !strings.Contains(out, "Cline CLI") {
		t.Error("plain output missing 'Cline CLI'")
	}

	// Should be readable text
	lines := strings.Split(strings.TrimSpace(out), "\n")
	if len(lines) == 0 {
		t.Error("plain output should have content")
	}
}

// TestPlainOutputVersionShort tests that --short flag works with plain
func TestPlainOutputVersionShort(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	out := mustRunCLI(ctx, t, "version", "--short", "--output-format", "plain")

	// Should be single line version number
	trimmed := strings.TrimSpace(out)
	if strings.Contains(trimmed, "\n") {
		t.Error("--short output should be single line")
	}

	// Should NOT be JSON
	if json.Valid([]byte(out)) {
		t.Error("--short output should not be JSON")
	}
}

// TestPlainOutputInstanceList tests instance list plain output
func TestPlainOutputInstanceList(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Start an instance first
	_ = mustRunCLI(ctx, t, "instance", "new")

	// Test plain output
	out := mustRunCLI(ctx, t, "instance", "list", "--output-format", "plain")

	// Should NOT be JSON
	if json.Valid([]byte(out)) {
		t.Error("plain output should not be JSON")
	}

	// Should contain table headers
	if !strings.Contains(out, "ADDRESS") {
		t.Error("plain output missing ADDRESS header")
	}
	if !strings.Contains(out, "STATUS") {
		t.Error("plain output missing STATUS header")
	}

	// Should contain instance data
	if !strings.Contains(out, "127.0.0.1:") {
		t.Error("plain output missing instance address")
	}
}

// TestPlainOutputInstanceNew tests instance new plain output
func TestPlainOutputInstanceNew(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	out := mustRunCLI(ctx, t, "instance", "new", "--output-format", "plain")

	// Should NOT be JSON
	if json.Valid([]byte(out)) {
		t.Error("plain output should not be JSON")
	}

	// Should contain success message
	if !strings.Contains(out, "Successfully started new instance") {
		t.Error("plain output missing success message")
	}

	// Should contain address information
	if !strings.Contains(out, "Address:") {
		t.Error("plain output missing address information")
	}
}

// TestPlainOutputInstanceKill tests instance kill plain output
func TestPlainOutputInstanceKill(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Create an instance to kill
	newOut := mustRunCLI(ctx, t, "instance", "new", "--output-format", "plain")
	
	// Extract address from plain text output
	lines := strings.Split(newOut, "\n")
	var address string
	for _, line := range lines {
		if strings.Contains(line, "Address:") {
			parts := strings.Fields(line)
			if len(parts) >= 2 {
				address = parts[1]
				break
			}
		}
	}

	if address == "" {
		t.Fatal("failed to extract address from plain output")
	}

	// Kill the instance
	out := mustRunCLI(ctx, t, "instance", "kill", address, "--output-format", "plain")

	// Should NOT be JSON
	if json.Valid([]byte(out)) {
		t.Error("plain output should not be JSON")
	}

	// Should contain success message
	if !strings.Contains(out, "Successfully killed") {
		t.Error("plain output missing success message")
	}
}

// TestPlainOutputLogsPath tests logs path plain output
func TestPlainOutputLogsPath(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	out := mustRunCLI(ctx, t, "logs", "path", "--output-format", "plain")

	// Should NOT be JSON
	if json.Valid([]byte(out)) {
		t.Error("plain output should not be JSON")
	}

	// Should contain a path
	if !strings.Contains(out, "/") {
		t.Error("plain output should contain a file path")
	}

	// Should be a simple path (one line)
	lines := strings.Split(strings.TrimSpace(out), "\n")
	if len(lines) != 1 {
		t.Error("logs path should output single line")
	}
}

// TestPlainOutputLogsList tests logs list plain output
func TestPlainOutputLogsList(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	out := mustRunCLI(ctx, t, "logs", "list", "--output-format", "plain")

	// Should NOT be JSON
	if json.Valid([]byte(out)) {
		t.Error("plain output should not be JSON")
	}

	// Should have content (either "No log files" or table)
	if strings.TrimSpace(out) == "" {
		t.Error("plain output should have content")
	}
}

// TestPlainOutputConfigList tests config list plain output
func TestPlainOutputConfigList(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Start instance
	_ = mustRunCLI(ctx, t, "instance", "new")

	out := mustRunCLI(ctx, t, "config", "list", "--output-format", "plain")

	// Should NOT be JSON
	if json.Valid([]byte(out)) {
		t.Error("plain output should not be JSON")
	}

	// Should contain config information
	if !strings.Contains(out, "Settings") && !strings.Contains(out, "mode") {
		t.Error("plain output should contain config information")
	}
}

// TestPlainOutputWithVerbose tests that verbose flag works with plain
func TestPlainOutputWithVerbose(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Start instance
	_ = mustRunCLI(ctx, t, "instance", "new")

	// Test with verbose flag
	out := mustRunCLI(ctx, t, "instance", "list", "--output-format", "plain", "--verbose")

	// Should NOT be JSON or JSONL
	lines := strings.Split(strings.TrimSpace(out), "\n")
	for _, line := range lines {
		if json.Valid([]byte(line)) {
			t.Error("plain verbose output should not contain JSON lines")
		}
	}

	// Should still be readable plain text
	if !strings.Contains(out, "ADDRESS") {
		t.Error("plain verbose output missing expected content")
	}
}

// TestPlainOutputInteractiveCommands removed - interactive commands like `auth` 
// cannot be tested in batch mode because they require a TTY. The `auth` command
// starts an instance (3s) then tries to display an interactive menu with huh, 
// which hangs waiting for TTY access that will never be available in tests.

// TestPlainOutputNoJSON tests that plain output never contains JSON
func TestPlainOutputNoJSON(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	commands := [][]string{
		{"version", "--output-format", "plain"},
		{"logs", "path", "--output-format", "plain"},
		{"logs", "list", "--output-format", "plain"},
	}

	for _, cmd := range commands {
		out := mustRunCLI(ctx, t, cmd...)

		// Should NOT be valid JSON
		if json.Valid([]byte(out)) {
			t.Errorf("command %v produced JSON in plain mode", cmd)
		}

		// Should have some content
		if strings.TrimSpace(out) == "" {
			t.Errorf("command %v produced empty output", cmd)
		}
	}
}

// TestPlainOutputReadable tests that plain output is human-readable
func TestPlainOutputReadable(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Start instance for list command
	_ = mustRunCLI(ctx, t, "instance", "new")

	tests := []struct {
		name string
		args []string
	}{
		{"version", []string{"version", "--output-format", "plain"}},
		{"instance-list", []string{"instance", "list", "--output-format", "plain"}},
		{"logs-path", []string{"logs", "path", "--output-format", "plain"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			out := mustRunCLI(ctx, t, tt.args...)

			// Should NOT be JSON
			if json.Valid([]byte(out)) {
				t.Error("plain output should not be JSON")
			}

			// Should be ASCII text (no control characters except newlines/tabs)
			for _, char := range out {
				if char < 32 && char != '\n' && char != '\t' && char != '\r' {
					t.Errorf("plain output contains control character: %d", char)
				}
			}

			// Should have content
			if strings.TrimSpace(out) == "" {
				t.Error("plain output should not be empty")
			}
		})
	}
}
