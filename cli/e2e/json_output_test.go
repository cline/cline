package e2e

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

// TestJSONOutputVersion tests version command JSON output
func TestJSONOutputVersion(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Test JSON output
	out := mustRunCLI(ctx, t, "version", "--output-format", "json")

	// Parse JSON
	var response map[string]interface{}
	if err := json.Unmarshal([]byte(out), &response); err != nil {
		t.Fatalf("failed to parse JSON: %v\nOutput: %s", err, out)
	}

	// Validate structure
	if response["status"] != "success" {
		t.Errorf("expected status=success, got %v", response["status"])
	}
	if response["command"] != "version" {
		t.Errorf("expected command=version, got %v", response["command"])
	}

	// Validate data fields
	data, ok := response["data"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected data to be object, got %T", response["data"])
	}

	requiredFields := []string{"cliVersion", "coreVersion", "commit", "date", "builtBy", "goVersion", "os", "arch"}
	for _, field := range requiredFields {
		if _, ok := data[field]; !ok {
			t.Errorf("missing required field: %s", field)
		}
	}

	// Test plain output still works
	plainOut := mustRunCLI(ctx, t, "version", "--output-format", "plain")
	if json.Valid([]byte(plainOut)) {
		t.Error("plain output should not be JSON")
	}
	if !strings.Contains(plainOut, "Cline CLI") {
		t.Error("plain output missing expected content")
	}

	// Test rich output still works
	richOut := mustRunCLI(ctx, t, "version", "--output-format", "rich")
	if json.Valid([]byte(richOut)) {
		t.Error("rich output should not be JSON")
	}
	if !strings.Contains(richOut, "Cline CLI") {
		t.Error("rich output missing expected content")
	}
}

// TestJSONOutputVersionShort tests that --short flag overrides JSON mode
func TestJSONOutputVersionShort(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// --short should output plain version number, even with --output-format json
	out := mustRunCLI(ctx, t, "version", "--short", "--output-format", "json")

	// Should be plain version string, not JSON
	if json.Valid([]byte(out)) {
		t.Error("--short output should not be JSON")
	}

	trimmed := strings.TrimSpace(out)
	if strings.Contains(trimmed, "\n") {
		t.Error("--short output should be single line")
	}
}

// TestJSONOutputInstanceList tests instance list JSON output
func TestJSONOutputInstanceList(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Start an instance first
	_ = mustRunCLI(ctx, t, "instance", "new")

	// Test JSON output
	out := mustRunCLI(ctx, t, "instance", "list", "--output-format", "json")

	// Parse JSON
	var response map[string]interface{}
	if err := json.Unmarshal([]byte(out), &response); err != nil {
		t.Fatalf("failed to parse JSON: %v\nOutput: %s", err, out)
	}

	// Validate structure
	if response["status"] != "success" {
		t.Errorf("expected status=success, got %v", response["status"])
	}

	data, ok := response["data"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected data to be object")
	}

	// Should have defaultInstance and instances array
	if _, ok := data["defaultInstance"]; !ok {
		t.Error("missing defaultInstance field")
	}

	instances, ok := data["instances"].([]interface{})
	if !ok {
		t.Fatalf("expected instances to be array")
	}
	if len(instances) == 0 {
		t.Error("expected at least one instance")
	}

	// Validate instance structure
	inst := instances[0].(map[string]interface{})
	requiredFields := []string{"address", "status", "version", "lastSeen", "pid", "platform", "isDefault"}
	for _, field := range requiredFields {
		if _, ok := inst[field]; !ok {
			t.Errorf("missing required field in instance: %s", field)
		}
	}

	// Test plain/rich outputs still work
	plainOut := mustRunCLI(ctx, t, "instance", "list", "--output-format", "plain")
	if json.Valid([]byte(plainOut)) {
		t.Error("plain output should not be JSON")
	}
}

// TestJSONOutputInstanceNew tests instance new JSON output
func TestJSONOutputInstanceNew(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Create new instance with JSON output
	out := mustRunCLI(ctx, t, "instance", "new", "--output-format", "json")

	// Parse JSON
	var response map[string]interface{}
	if err := json.Unmarshal([]byte(out), &response); err != nil {
		t.Fatalf("failed to parse JSON: %v\nOutput: %s", err, out)
	}

	// Validate structure
	if response["status"] != "success" {
		t.Errorf("expected status=success, got %v", response["status"])
	}

	data, ok := response["data"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected data to be object")
	}

	requiredFields := []string{"address", "corePort", "hostPort", "isDefault"}
	for _, field := range requiredFields {
		if _, ok := data[field]; !ok {
			t.Errorf("missing required field: %s", field)
		}
	}
}

// TestJSONOutputLogsPath tests logs path JSON output
func TestJSONOutputLogsPath(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Test JSON output
	out := mustRunCLI(ctx, t, "logs", "path", "--output-format", "json")

	// Parse JSON
	var response map[string]interface{}
	if err := json.Unmarshal([]byte(out), &response); err != nil {
		t.Fatalf("failed to parse JSON: %v\nOutput: %s", err, out)
	}

	// Validate structure
	if response["status"] != "success" {
		t.Errorf("expected status=success, got %v", response["status"])
	}

	data, ok := response["data"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected data to be object")
	}

	if _, ok := data["path"]; !ok {
		t.Error("missing path field")
	}
}

// TestJSONOutputLogsList tests logs list JSON output
func TestJSONOutputLogsList(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Test JSON output (may have no logs)
	out := mustRunCLI(ctx, t, "logs", "list", "--output-format", "json")

	// Parse JSON
	var response map[string]interface{}
	if err := json.Unmarshal([]byte(out), &response); err != nil {
		t.Fatalf("failed to parse JSON: %v\nOutput: %s", err, out)
	}

	// Validate structure
	if response["status"] != "success" {
		t.Errorf("expected status=success, got %v", response["status"])
	}

	data, ok := response["data"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected data to be object")
	}

	// Should have logsDir and logs array
	if _, ok := data["logsDir"]; !ok {
		t.Error("missing logsDir field")
	}

	if _, ok := data["logs"]; !ok {
		t.Error("missing logs field")
	}
}

// TestJSONOutputConfigList tests config list JSON output
func TestJSONOutputConfigList(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Start instance
	_ = mustRunCLI(ctx, t, "instance", "new")

	// Test JSON output
	out := mustRunCLI(ctx, t, "config", "list", "--output-format", "json")

	// Parse JSON
	var response map[string]interface{}
	if err := json.Unmarshal([]byte(out), &response); err != nil {
		t.Fatalf("failed to parse JSON: %v\nOutput: %s", err, out)
	}

	// Validate structure
	if response["status"] != "success" {
		t.Errorf("expected status=success, got %v", response["status"])
	}

	data, ok := response["data"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected data to be object")
	}

	if _, ok := data["settings"]; !ok {
		t.Error("missing settings field")
	}
}

// TestJSONOutputNoLeakage tests that JSON mode produces ONLY JSON
func TestJSONOutputNoLeakage(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	commands := [][]string{
		{"version", "--output-format", "json"},
		{"logs", "path", "--output-format", "json"},
	}

	for _, cmd := range commands {
		out := mustRunCLI(ctx, t, cmd...)

		trimmed := strings.TrimSpace(out)

		// Should start with {
		if !strings.HasPrefix(trimmed, "{") {
			t.Errorf("command %v: JSON output has leading text: %s", cmd, out[:min(50, len(out))])
		}

		// Should end with }
		if !strings.HasSuffix(trimmed, "}") {
			t.Errorf("command %v: JSON output has trailing text", cmd)
		}

		// Should be valid JSON
		if !json.Valid([]byte(trimmed)) {
			t.Errorf("command %v: output is not valid JSON", cmd)
		}
	}
}

// TestJSONOutputWithVerboseFlag tests that verbose output works with JSON
func TestJSONOutputWithVerboseFlag(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Test with verbose flag
	out := mustRunCLI(ctx, t, "version", "--output-format", "json", "--verbose")

	// Should still be valid JSON
	var response map[string]interface{}
	if err := json.Unmarshal([]byte(out), &response); err != nil {
		t.Fatalf("verbose JSON output should be valid JSON: %v", err)
	}

	if response["status"] != "success" {
		t.Errorf("expected status=success even with verbose, got %v", response["status"])
	}
}

// TestAllCommandsJSONValidity tests that all non-interactive commands produce valid JSON
func TestAllCommandsJSONValidity(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Start instance for commands that need it
	_ = mustRunCLI(ctx, t, "instance", "new")

	tests := []struct {
		name string
		args []string
	}{
		{"version", []string{"version", "--output-format", "json"}},
		{"logs-path", []string{"logs", "path", "--output-format", "json"}},
		{"logs-list", []string{"logs", "list", "--output-format", "json"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			out := mustRunCLI(ctx, t, tt.args...)

			if !json.Valid([]byte(out)) {
				t.Errorf("command produced invalid JSON:\n%s", out)
			}

			// Parse and validate structure
			var response map[string]interface{}
			if err := json.Unmarshal([]byte(out), &response); err != nil {
				t.Fatalf("failed to parse JSON: %v", err)
			}

			// All responses should have status and command
			if _, ok := response["status"]; !ok {
				t.Error("missing status field")
			}
			if _, ok := response["command"]; !ok {
				t.Error("missing command field")
			}

			// Success responses should have data
			if response["status"] == "success" {
				if _, ok := response["data"]; !ok {
					t.Error("success response missing data field")
				}
			}

			// Error responses should have error
			if response["status"] == "error" {
				if _, ok := response["error"]; !ok {
					t.Error("error response missing error field")
				}
			}
		})
	}
}

// min returns the minimum of two integers
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
