package e2e

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"unicode/utf8"
)

// TestRichOutputVersion tests version command rich output
func TestRichOutputVersion(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Test rich output (default)
	out := mustRunCLI(ctx, t, "version", "--output-format", "rich")

	// Should NOT be JSON
	if json.Valid([]byte(out)) {
		t.Error("rich output should not be JSON")
	}

	// Should contain version information
	if !strings.Contains(out, "Cline CLI") {
		t.Error("rich output missing 'Cline CLI'")
	}

	// Should be readable text
	lines := strings.Split(strings.TrimSpace(out), "\n")
	if len(lines) == 0 {
		t.Error("rich output should have content")
	}
}

// TestRichOutputVersionShort tests that --short flag works with rich
func TestRichOutputVersionShort(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	out := mustRunCLI(ctx, t, "version", "--short", "--output-format", "rich")

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

// TestRichOutputInstanceList tests instance list rich output
func TestRichOutputInstanceList(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Start an instance first
	_ = mustRunCLI(ctx, t, "instance", "new")

	// Test rich output
	out := mustRunCLI(ctx, t, "instance", "list", "--output-format", "rich")

	// Should NOT be JSON
	if json.Valid([]byte(out)) {
		t.Error("rich output should not be JSON")
	}

	// Rich format uses markdown tables, so check for table markers
	// Should contain table-like content
	if !strings.Contains(out, "ADDRESS") && !strings.Contains(out, "|") {
		t.Error("rich output should contain table markers or headers")
	}

	// Should contain instance data
	if !strings.Contains(out, "127.0.0.1:") {
		t.Error("rich output missing instance address")
	}
}

// TestRichOutputInstanceNew tests instance new rich output
func TestRichOutputInstanceNew(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	out := mustRunCLI(ctx, t, "instance", "new", "--output-format", "rich")

	// Should NOT be JSON
	if json.Valid([]byte(out)) {
		t.Error("rich output should not be JSON")
	}

	// Should contain success message
	if !strings.Contains(out, "Successfully started new instance") {
		t.Error("rich output missing success message")
	}

	// Should contain address information
	if !strings.Contains(out, "Address:") {
		t.Error("rich output missing address information")
	}
}

// TestRichOutputInstanceKill tests instance kill rich output
func TestRichOutputInstanceKill(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Create an instance to kill
	newOut := mustRunCLI(ctx, t, "instance", "new", "--output-format", "rich")
	
	// Extract address from rich text output
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
		t.Fatal("failed to extract address from rich output")
	}

	// Kill the instance
	out := mustRunCLI(ctx, t, "instance", "kill", address, "--output-format", "rich")

	// Should NOT be JSON
	if json.Valid([]byte(out)) {
		t.Error("rich output should not be JSON")
	}

	// Should contain success message
	if !strings.Contains(out, "Successfully killed") {
		t.Error("rich output missing success message")
	}
}

// TestRichOutputLogsPath tests logs path rich output
func TestRichOutputLogsPath(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	out := mustRunCLI(ctx, t, "logs", "path", "--output-format", "rich")

	// Should NOT be JSON
	if json.Valid([]byte(out)) {
		t.Error("rich output should not be JSON")
	}

	// Should contain a path
	if !strings.Contains(out, "/") {
		t.Error("rich output should contain a file path")
	}

	// Should be a simple path (one line)
	lines := strings.Split(strings.TrimSpace(out), "\n")
	if len(lines) != 1 {
		t.Error("logs path should output single line")
	}
}

// TestRichOutputLogsList tests logs list rich output
func TestRichOutputLogsList(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	out := mustRunCLI(ctx, t, "logs", "list", "--output-format", "rich")

	// Should NOT be JSON
	if json.Valid([]byte(out)) {
		t.Error("rich output should not be JSON")
	}

	// Should have content (either "No log files" or table)
	if strings.TrimSpace(out) == "" {
		t.Error("rich output should have content")
	}
}

// TestRichOutputConfigList tests config list rich output
func TestRichOutputConfigList(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Start instance
	_ = mustRunCLI(ctx, t, "instance", "new")

	out := mustRunCLI(ctx, t, "config", "list", "--output-format", "rich")

	// Should NOT be JSON
	if json.Valid([]byte(out)) {
		t.Error("rich output should not be JSON")
	}

	// Should contain config information
	if !strings.Contains(out, "Settings") && !strings.Contains(out, "mode") {
		t.Error("rich output should contain config information")
	}
}

// TestRichOutputWithVerbose tests that verbose flag works with rich
func TestRichOutputWithVerbose(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Start instance
	_ = mustRunCLI(ctx, t, "instance", "new")

	// Test with verbose flag
	out := mustRunCLI(ctx, t, "instance", "list", "--output-format", "rich", "--verbose")

	// Should NOT be JSON or JSONL
	lines := strings.Split(strings.TrimSpace(out), "\n")
	for _, line := range lines {
		if json.Valid([]byte(line)) {
			t.Error("rich verbose output should not contain JSON lines")
		}
	}

	// Should still have table or formatted content
	if strings.TrimSpace(out) == "" {
		t.Error("rich verbose output should have content")
	}
}

// TestRichOutputInteractiveCommands removed - interactive commands like `auth` 
// cannot be tested in batch mode because they require a TTY. The `auth` command
// starts an instance (3s) then tries to display an interactive menu with huh, 
// which hangs waiting for TTY access that will never be available in tests.

// TestRichOutputNoJSON tests that rich output never contains JSON
func TestRichOutputNoJSON(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	commands := [][]string{
		{"version", "--output-format", "rich"},
		{"logs", "path", "--output-format", "rich"},
		{"logs", "list", "--output-format", "rich"},
	}

	for _, cmd := range commands {
		out := mustRunCLI(ctx, t, cmd...)

		// Should NOT be valid JSON
		if json.Valid([]byte(out)) {
			t.Errorf("command %v produced JSON in rich mode", cmd)
		}

		// Should have some content
		if strings.TrimSpace(out) == "" {
			t.Errorf("command %v produced empty output", cmd)
		}
	}
}

// TestRichOutputFormatted tests that rich output may contain formatting
func TestRichOutputFormatted(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Start instance for list command
	_ = mustRunCLI(ctx, t, "instance", "new")

	out := mustRunCLI(ctx, t, "instance", "list", "--output-format", "rich")

	// Should NOT be JSON
	if json.Valid([]byte(out)) {
		t.Error("rich output should not be JSON")
	}

	// Rich format may contain ANSI codes for colors (optional)
	// Or markdown table formatting
	// Just verify it's not plain JSON and has content
	if strings.TrimSpace(out) == "" {
		t.Error("rich output should not be empty")
	}

	// Should contain actual data
	if !strings.Contains(out, "127.0.0.1:") {
		t.Error("rich output should contain instance data")
	}
}

// TestRichOutputDefaultFormat tests that rich is the default format
func TestRichOutputDefaultFormat(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Test without --output-format flag (should default to rich)
	outDefault := mustRunCLI(ctx, t, "version")
	outRich := mustRunCLI(ctx, t, "version", "--output-format", "rich")

	// Both should NOT be JSON
	if json.Valid([]byte(outDefault)) {
		t.Error("default output should not be JSON")
	}
	if json.Valid([]byte(outRich)) {
		t.Error("rich output should not be JSON")
	}

	// Default and rich should be similar (both are rich format)
	// They may differ slightly in formatting but should have same content
	if !strings.Contains(outDefault, "Cline CLI") {
		t.Error("default output missing version info")
	}
	if !strings.Contains(outRich, "Cline CLI") {
		t.Error("rich output missing version info")
	}
}

// TestRichOutputReadable tests that rich output is human-readable
func TestRichOutputReadable(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Start instance for list command
	_ = mustRunCLI(ctx, t, "instance", "new")

	tests := []struct {
		name string
		args []string
	}{
		{"version", []string{"version", "--output-format", "rich"}},
		{"instance-list", []string{"instance", "list", "--output-format", "rich"}},
		{"logs-path", []string{"logs", "path", "--output-format", "rich"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			out := mustRunCLI(ctx, t, tt.args...)

			// Should NOT be JSON
			if json.Valid([]byte(out)) {
				t.Error("rich output should not be JSON")
			}

			// Should be mostly ASCII text (may have ANSI codes for colors)
			// Just verify it's not binary garbage
			if strings.TrimSpace(out) == "" {
				t.Error("rich output should not be empty")
			}

			// Should be valid UTF-8
			if !utf8.ValidString(out) {
				t.Error("rich output should be valid UTF-8")
			}
		})
	}
}

// TestRichOutputTableFormat tests that rich output uses tables where appropriate
func TestRichOutputTableFormat(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Start instance
	_ = mustRunCLI(ctx, t, "instance", "new")

	out := mustRunCLI(ctx, t, "instance", "list", "--output-format", "rich")

	// Should NOT be JSON
	if json.Valid([]byte(out)) {
		t.Error("rich output should not be JSON")
	}

	// Rich format may use markdown tables or formatted tables
	// Check for table-like structure (pipe characters or structured layout)
	hasTableStructure := strings.Contains(out, "|") || 
		strings.Contains(out, "ADDRESS") ||
		strings.Contains(out, "STATUS")

	if !hasTableStructure {
		t.Error("rich output should have table-like structure")
	}

	// Should contain actual data
	if !strings.Contains(out, "127.0.0.1:") {
		t.Error("rich output missing instance data")
	}
}

// TestRichOutputColorCodes tests that rich output may contain ANSI color codes
func TestRichOutputColorCodes(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Start instance
	_ = mustRunCLI(ctx, t, "instance", "new")

	out := mustRunCLI(ctx, t, "instance", "list", "--output-format", "rich")

	// Should NOT be JSON
	if json.Valid([]byte(out)) {
		t.Error("rich output should not be JSON")
	}

	// Rich format may contain ANSI escape codes for colors
	// This is optional but common for rich output
	// Just verify the output is valid and has content
	if strings.TrimSpace(out) == "" {
		t.Error("rich output should have content")
	}

	// If it has ANSI codes, they should be valid escape sequences
	// (starting with \033[ or \x1b[)
	// But this is optional, so we just check it's not breaking the output
	lines := strings.Split(out, "\n")
	for _, line := range lines {
		// Each line should be valid UTF-8
		if !utf8.ValidString(line) {
			t.Error("rich output lines should be valid UTF-8")
		}
	}
}
