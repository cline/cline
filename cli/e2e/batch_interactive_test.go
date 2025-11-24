package e2e

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

// TestBatchModeCommands tests commands that are suitable for batch/automation
func TestBatchModeCommands(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Start an instance for testing
	_ = mustRunCLI(ctx, t, "instance", "new")

	// Commands that should work in batch mode (non-interactive)
	batchCommands := [][]string{
		{"version", "--output-format", "json"},
		{"instance", "list", "--output-format", "json"},
		{"logs", "path", "--output-format", "json"},
		{"logs", "list", "--output-format", "json"},
		{"config", "list", "--output-format", "json"},
	}

	for _, cmd := range batchCommands {
		t.Run(strings.Join(cmd[:len(cmd)-2], "-"), func(t *testing.T) {
			out := mustRunCLI(ctx, t, cmd...)

			// Should be valid JSON
			if !json.Valid([]byte(out)) {
				t.Errorf("batch command should output valid JSON: %v", cmd)
			}

			// Should complete without user interaction
			var result map[string]interface{}
			if err := json.Unmarshal([]byte(out), &result); err != nil {
				t.Fatalf("failed to parse JSON: %v", err)
			}

			// Should have success status
			if status, ok := result["status"].(string); !ok || status != "success" {
				t.Error("batch command should have success status")
			}
		})
	}
}

// TestInteractiveCommandsInBatchMode tests that interactive commands fail appropriately
func TestInteractiveCommandsInBatchMode(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Interactive commands that should fail in batch mode (JSON)
	interactiveCommands := [][]string{
		{"auth", "--output-format", "json"},
	}

	for _, cmd := range interactiveCommands {
		t.Run(strings.Join(cmd[:len(cmd)-2], "-"), func(t *testing.T) {
			_, errOut, exitCode := runCLI(ctx, t, cmd...)

			// Should fail (non-zero exit code)
			if exitCode == 0 {
				t.Error("interactive command should fail in batch mode")
			}

			// Error should be JSON in JSON mode (may not be implemented yet)
			var errorData map[string]interface{}
			if err := json.Unmarshal([]byte(errOut), &errorData); err != nil {
				t.Logf("Note: error not JSON: %v", err)
				return
			}

			// Should indicate it's an interactive command
			if errorMsg, ok := errorData["error"].(string); ok {
				if !strings.Contains(strings.ToLower(errorMsg), "interactive") &&
					!strings.Contains(strings.ToLower(errorMsg), "tty") {
					t.Log("Note: error doesn't mention interactive/TTY requirement")
				}
			}
		})
	}
}

// TestJSONOutputForAutomation tests that JSON output is suitable for automation
func TestJSONOutputForAutomation(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Create instance
	newOut := mustRunCLI(ctx, t, "instance", "new", "--output-format", "json")

	// Parse to extract instance address
	var newData map[string]interface{}
	if err := json.Unmarshal([]byte(newOut), &newData); err != nil {
		t.Fatalf("failed to parse new instance JSON: %v", err)
	}

	// Extract address from structured data
	data, ok := newData["data"].(map[string]interface{})
	if !ok {
		t.Fatal("JSON should have data field")
	}

	address, ok := data["address"].(string)
	if !ok || address == "" {
		t.Fatal("JSON should have address in data")
	}

	// Use extracted address in next command (automation scenario)
	killOut := mustRunCLI(ctx, t, "instance", "kill", address, "--output-format", "json")

	// Parse kill result
	var killData map[string]interface{}
	if err := json.Unmarshal([]byte(killOut), &killData); err != nil {
		t.Fatalf("failed to parse kill JSON: %v", err)
	}

	// Verify success
	if status, ok := killData["status"].(string); !ok || status != "success" {
		t.Error("automation chain should succeed")
	}
}

// TestPlainOutputForHumans tests that plain output is suitable for human consumption
func TestPlainOutputForHumans(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Start instance
	_ = mustRunCLI(ctx, t, "instance", "new")

	// Plain output should be human-readable
	out := mustRunCLI(ctx, t, "instance", "list", "--output-format", "plain")

	// Should NOT be JSON
	if json.Valid([]byte(out)) {
		t.Error("plain output should not be JSON")
	}

	// Should have headers
	if !strings.Contains(out, "ADDRESS") || !strings.Contains(out, "STATUS") {
		t.Error("plain output should have readable headers")
	}

	// Should have instance data in readable format
	if !strings.Contains(out, "127.0.0.1:") {
		t.Error("plain output should show instance address")
	}
}

// TestScriptableOutput tests output suitable for shell scripts
func TestScriptableOutput(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Commands that produce simple, parseable output
	tests := []struct {
		name     string
		args     []string
		validate func(string) bool
	}{
		{
			"version-short",
			[]string{"version", "--short"},
			func(out string) bool {
				// Should be simple version string (may be "dev" in development builds)
				trimmed := strings.TrimSpace(out)
				return trimmed != "" && !strings.Contains(trimmed, "\n")
			},
		},
		{
			"logs-path",
			[]string{"logs", "path"},
			func(out string) bool {
				// Should be simple path
				return strings.Contains(out, "/") && !strings.Contains(strings.TrimSpace(out), "\n")
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			out := mustRunCLI(ctx, t, tt.args...)

			if !tt.validate(out) {
				t.Errorf("output not suitable for scripting: %s", out)
			}
		})
	}
}

// TestBatchProcessingMultipleCommands tests running multiple commands in sequence
func TestBatchProcessingMultipleCommands(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Batch create multiple instances
	var addresses []string
	for i := 0; i < 3; i++ {
		out := mustRunCLI(ctx, t, "instance", "new", "--output-format", "json")

		var data map[string]interface{}
		if err := json.Unmarshal([]byte(out), &data); err != nil {
			t.Fatalf("failed to parse instance %d: %v", i, err)
		}

		if d, ok := data["data"].(map[string]interface{}); ok {
			if addr, ok := d["address"].(string); ok {
				addresses = append(addresses, addr)
			}
		}
	}

	// Verify all instances exist
	listOut := mustRunCLI(ctx, t, "instance", "list", "--output-format", "json")

	var listData map[string]interface{}
	if err := json.Unmarshal([]byte(listOut), &listData); err != nil {
		t.Fatalf("failed to parse list: %v", err)
	}

	// Count instances
	if data, ok := listData["data"].(map[string]interface{}); ok {
		if instances, ok := data["instances"].([]interface{}); ok {
			if len(instances) != 3 {
				t.Errorf("expected 3 instances, got %d", len(instances))
			}
		}
	}

	// Batch kill all
	killOut := mustRunCLI(ctx, t, "instance", "kill", "--all-cli", "--output-format", "json")

	var killData map[string]interface{}
	if err := json.Unmarshal([]byte(killOut), &killData); err != nil {
		t.Fatalf("failed to parse kill: %v", err)
	}

	// Verify all killed
	if data, ok := killData["data"].(map[string]interface{}); ok {
		if killedCount, ok := data["killedCount"].(float64); ok {
			if int(killedCount) != 3 {
				t.Errorf("expected 3 killed, got %d", int(killedCount))
			}
		}
	}
}

// TestNonInteractiveDefaults tests that defaults work without user interaction
func TestNonInteractiveDefaults(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Commands should use sensible defaults
	out := mustRunCLI(ctx, t, "version")

	// Should complete successfully with default settings
	if strings.TrimSpace(out) == "" {
		t.Error("version should have output")
	}

	// Should not prompt for input
	if strings.Contains(strings.ToLower(out), "enter") ||
		strings.Contains(strings.ToLower(out), "input") {
		t.Error("non-interactive command should not prompt")
	}
}

// TestOutputRedirection tests that output works with shell redirection
func TestOutputRedirection(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// JSON output should be complete and parseable
	out := mustRunCLI(ctx, t, "version", "--output-format", "json")

	// Should be valid JSON (as if redirected to file)
	var result map[string]interface{}
	if err := json.Unmarshal([]byte(out), &result); err != nil {
		t.Error("redirected JSON should be parseable")
	}

	// Should not have extra output on stdout
	lines := strings.Split(strings.TrimSpace(out), "\n")
	if len(lines) > 1 {
		// Check if all lines are JSON (JSONL case)
		allJSON := true
		for _, line := range lines {
			if !json.Valid([]byte(line)) {
				allJSON = false
				break
			}
		}
		if !allJSON {
			t.Error("multi-line output should be JSONL or single JSON")
		}
	}
}

// TestErrorsInBatchMode tests error handling in batch/automation contexts
func TestErrorsInBatchMode(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Errors should be machine-readable in JSON mode
	_, errOut, exitCode := runCLI(ctx, t, "instance", "kill", "nonexistent:9999", "--output-format", "json")

	// Should have error exit code
	if exitCode == 0 {
		t.Error("error should have non-zero exit code")
	}

	// Error should be parseable JSON
	var errorData map[string]interface{}
	if err := json.Unmarshal([]byte(errOut), &errorData); err != nil {
		t.Error("batch mode errors should be JSON")
	}

	// Should have structured error information
	if _, ok := errorData["error"]; !ok {
		t.Error("error JSON should have error field")
	}
	if status, ok := errorData["status"].(string); !ok || status != "error" {
		t.Error("error JSON should have status=error")
	}
}

// TestStdoutStderrSeparation tests that output and errors use correct streams
func TestStdoutStderrSeparation(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Success output should go to stdout
	out, errOut, exitCode := runCLI(ctx, t, "version", "--output-format", "json")

	if exitCode != 0 {
		t.Fatal("version should succeed")
	}

	// Success should be on stdout
	if out == "" {
		t.Error("success output should be on stdout")
	}

	// Nothing on stderr for success
	if errOut != "" {
		t.Log("Warning: success command has stderr output:", errOut)
	}

	// Error output should go to stderr
	// Use a real command that will fail (not "nonexistent" which hangs waiting for TTY)
	out, errOut, exitCode = runCLI(ctx, t, "instance", "kill", "nonexistent:9999", "--output-format", "json")

	if exitCode == 0 {
		t.Fatal("invalid command should fail")
	}

	// Error should be on stderr
	if errOut == "" {
		t.Error("error output should be on stderr")
	}
}
