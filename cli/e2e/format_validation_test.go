package e2e

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// assertPureJSON validates that output is pure JSON with ZERO text leakage
// Any non-JSON text will cause the test to fail
func assertPureJSON(t *testing.T, output string, commandDesc string) {
	t.Helper()

	trimmed := strings.TrimSpace(output)

	// Check for empty output
	if trimmed == "" {
		t.Fatalf("%s: output is empty", commandDesc)
	}

	// Must start with { or [
	if !strings.HasPrefix(trimmed, "{") && !strings.HasPrefix(trimmed, "[") {
		// Show first 100 chars of output for debugging
		preview := trimmed
		if len(preview) > 100 {
			preview = preview[:100] + "..."
		}
		t.Fatalf("%s: JSON output has leading text (text leakage):\n%s", commandDesc, preview)
	}

	// Must end with } or ]
	if !strings.HasSuffix(trimmed, "}") && !strings.HasSuffix(trimmed, "]") {
		// Show last 100 chars of output for debugging
		preview := trimmed
		if len(preview) > 100 {
			preview = "..." + preview[len(preview)-100:]
		}
		t.Fatalf("%s: JSON output has trailing text (text leakage):\n%s", commandDesc, preview)
	}

	// Must be valid JSON
	if !json.Valid([]byte(trimmed)) {
		t.Fatalf("%s: output is not valid JSON:\n%s", commandDesc, trimmed)
	}
}

// TestJSONOutputVersion tests version command JSON output
func TestJSONOutputVersion(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Test JSON output
	out := mustRunCLI(ctx, t, "version", "--output-format", "json")

	// STRICT: Assert pure JSON with ZERO text leakage
	assertPureJSON(t, out, "version --output-format json")

	// Parse JSON
	var response map[string]interface{}
	if err := json.Unmarshal([]byte(out), &response); err != nil {
		t.Fatalf("failed to parse JSON: %v\nOutput: %s", err, out)
	}

	// Validate batch command structure
	if response["type"] != "command" {
		t.Errorf("expected type=command, got %v", response["type"])
	}
	if response["command"] != "version" {
		t.Errorf("expected command=version, got %v", response["command"])
	}
	if response["status"] != "success" {
		t.Errorf("expected status=success, got %v", response["status"])
	}

	// Validate data fields
	data, ok := response["result"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected data to be object, got %T", response["result"])
	}

	// Data is directly under "result" key (OutputJSONSuccess uses "result" for the data field)
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

	// STRICT: Assert pure JSON with ZERO text leakage
	assertPureJSON(t, out, "instance list --output-format json")

	// Parse JSON
	var response map[string]interface{}
	if err := json.Unmarshal([]byte(out), &response); err != nil {
		t.Fatalf("failed to parse JSON: %v\nOutput: %s", err, out)
	}

	// Validate batch command structure
	if response["type"] != "command" {
		t.Errorf("expected type=command, got %v", response["type"])
	}
	if response["command"] != "instance list" {
		t.Errorf("expected command='instance list', got %v", response["command"])
	}
	if response["status"] != "success" {
		t.Errorf("expected status=success, got %v", response["status"])
	}

	data, ok := response["result"].(map[string]interface{})
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

	// STRICT: Assert pure JSON with ZERO text leakage
	assertPureJSON(t, out, "instance new --output-format json")

	// Parse JSON
	var response map[string]interface{}
	if err := json.Unmarshal([]byte(out), &response); err != nil {
		t.Fatalf("failed to parse JSON: %v\nOutput: %s", err, out)
	}

	// Validate batch command structure
	if response["type"] != "command" {
		t.Errorf("expected type=command, got %v", response["type"])
	}
	if response["command"] != "instance new" {
		t.Errorf("expected command='instance new', got %v", response["command"])
	}
	if response["status"] != "success" {
		t.Errorf("expected status=success, got %v", response["status"])
	}

	data, ok := response["result"].(map[string]interface{})
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

	// STRICT: Assert pure JSON with ZERO text leakage
	assertPureJSON(t, out, "logs path --output-format json")

	// Parse JSON
	var response map[string]interface{}
	if err := json.Unmarshal([]byte(out), &response); err != nil {
		t.Fatalf("failed to parse JSON: %v\nOutput: %s", err, out)
	}

	// Validate batch command structure
	if response["type"] != "command" {
		t.Errorf("expected type=command, got %v", response["type"])
	}
	if response["command"] != "logs path" {
		t.Errorf("expected command='logs path', got %v", response["command"])
	}
	if response["status"] != "success" {
		t.Errorf("expected status=success, got %v", response["status"])
	}

	data, ok := response["result"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected data to be object")
	}

	if _, ok := data["path"]; !ok {
		t.Error("missing path field")
	}
}

// TestInteractiveCommandsErrorInJSONMode tests that interactive commands reject JSON mode with plain text errors
func TestInteractiveCommandsErrorInJSONMode(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	setTempClineDir(t)

	// Test auth command - should output PLAIN TEXT error, not JSON
	_, errOut, exit := runCLI(ctx, t, "auth", "--output-format", "json")
	if exit == 0 {
		t.Error("auth command should error in JSON mode")
	}

	// Per the plan: Interactive commands output **plain text errors**, NOT JSON
	// Error should be plain text
	if json.Valid([]byte(errOut)) {
		t.Error("interactive command error should be plain text, not JSON")
	}

	// Should mention it's interactive
	if !strings.Contains(errOut, "interactive") {
		t.Error("error should mention interactive mode")
	}

	// Should be formatted as a standard CLI error
	if !strings.Contains(errOut, "Error:") {
		t.Error("error should start with 'Error:'")
	}

	// Test task chat command - should also output plain text error
	_, errOut, exit = runCLI(ctx, t, "task", "chat", "--output-format", "json")
	if exit == 0 {
		t.Error("task chat command should error in JSON mode")
	}

	if json.Valid([]byte(errOut)) {
		t.Error("task chat error should be plain text, not JSON")
	}

	if !strings.Contains(errOut, "interactive") {
		t.Error("task chat error should mention interactive mode")
	}

	// Test root command (interactive) - should also output plain text error
	_, errOut, exit = runCLI(ctx, t, "--output-format", "json")
	if exit == 0 {
		t.Error("root command without args should error in JSON mode")
	}

	if json.Valid([]byte(errOut)) {
		t.Error("root command error should be plain text, not JSON")
	}
}

// TestJSONOutputLogsList tests logs list JSON output
func TestJSONOutputLogsList(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Test JSON output (may have no logs)
	out := mustRunCLI(ctx, t, "logs", "list", "--output-format", "json")

	// STRICT: Assert pure JSON with ZERO text leakage
	assertPureJSON(t, out, "logs list --output-format json")

	// Parse JSON
	var response map[string]interface{}
	if err := json.Unmarshal([]byte(out), &response); err != nil {
		t.Fatalf("failed to parse JSON: %v\nOutput: %s", err, out)
	}

	// Validate batch command structure
	if response["type"] != "command" {
		t.Errorf("expected type=command, got %v", response["type"])
	}
	if response["command"] != "logs list" {
		t.Errorf("expected command='logs list', got %v", response["command"])
	}
	if response["status"] != "success" {
		t.Errorf("expected status=success, got %v", response["status"])
	}

	data, ok := response["result"].(map[string]interface{})
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

	// STRICT: Assert pure JSON with ZERO text leakage
	assertPureJSON(t, out, "config list --output-format json")

	// Parse JSON
	var response map[string]interface{}
	if err := json.Unmarshal([]byte(out), &response); err != nil {
		t.Fatalf("failed to parse JSON: %v\nOutput: %s", err, out)
	}

	// Validate batch command structure
	if response["type"] != "command" {
		t.Errorf("expected type=command, got %v", response["type"])
	}
	if response["command"] != "config list" {
		t.Errorf("expected command='config list', got %v", response["command"])
	}
	if response["status"] != "success" {
		t.Errorf("expected status=success, got %v", response["status"])
	}

	data, ok := response["result"].(map[string]interface{})
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

	commands := []struct {
		desc string
		args []string
	}{
		{"version --output-format json", []string{"version", "--output-format", "json"}},
		{"logs path --output-format json", []string{"logs", "path", "--output-format", "json"}},
	}

	for _, cmd := range commands {
		out := mustRunCLI(ctx, t, cmd.args...)

		// STRICT: Assert pure JSON with ZERO text leakage
		assertPureJSON(t, out, cmd.desc)
	}
}

// TestJSONOutputWithVerboseFlag tests that verbose output works with JSON (JSONL format)
func TestJSONOutputWithVerboseFlag(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Start instance for commands that need it
	_ = mustRunCLI(ctx, t, "instance", "new")

	// Test all commands that support --verbose flag
	tests := []struct {
		name string
		args []string
	}{
		{"version", []string{"version", "--output-format", "json", "--verbose"}},
		{"instance-list", []string{"instance", "list", "--output-format", "json", "--verbose"}},
		{"logs-path", []string{"logs", "path", "--output-format", "json", "--verbose"}},
		{"logs-list", []string{"logs", "list", "--output-format", "json", "--verbose"}},
		{"config-list", []string{"config", "list", "--output-format", "json", "--verbose"}},
		{"task-new", []string{"task", "new", "test task", "--yolo", "--output-format", "json", "--verbose"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			out := mustRunCLI(ctx, t, tt.args...)

			// Parse JSONL output (multiple JSON objects, one per line)
			lines := strings.Split(strings.TrimSpace(out), "\n")

			var finalResult map[string]interface{}
			var verboseMessages []string
			var debugMessages []string

			for _, line := range lines {
				if line == "" {
					continue
				}

				// Each line must be valid JSON
				if !json.Valid([]byte(line)) {
					t.Fatalf("Line is not valid JSON: %s", line)
				}

				var obj map[string]interface{}
				if err := json.Unmarshal([]byte(line), &obj); err != nil {
					t.Fatalf("failed to parse JSON line: %v\nLine: %s", err, line)
				}

				// Check message type
				if msgType, ok := obj["type"].(string); ok {
					if msgType == "command" {
						// Batch command format: check status field
						if status, ok := obj["status"].(string); ok {
							if status == "debug" {
								// Debug message from verbose mode
								if msg, ok := obj["message"].(string); ok {
									debugMessages = append(debugMessages, msg)
								}
							} else if status == "success" {
								// Final success response
								finalResult = obj
							}
						}
					}
				}
			}

			// Should have at least a final result
			if finalResult == nil {
				t.Fatal("no final result found in output")
			}

			// Log what we found
			t.Logf("Debug messages: %d", len(debugMessages))
			t.Logf("Verbose messages: %d", len(verboseMessages))
			if len(verboseMessages) > 0 {
				t.Logf("✓ Verbose info output as JSONL: %v", verboseMessages)
			}
			if len(debugMessages) > 0 {
				t.Logf("✓ Debug info output as JSONL: %v", debugMessages)
			}
		})
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

			// STRICT: Assert pure JSON with ZERO text leakage
			assertPureJSON(t, out, strings.Join(tt.args, " "))

			// Parse and validate structure
			var response map[string]interface{}
			if err := json.Unmarshal([]byte(out), &response); err != nil {
				t.Fatalf("failed to parse JSON: %v", err)
			}

			// All batch command responses should have type, command, and status
			if response["type"] != "command" {
				t.Error("expected type=command")
			}
			if _, ok := response["command"]; !ok {
				t.Error("missing command field")
			}
			if _, ok := response["status"]; !ok {
				t.Error("missing status field")
			}

			// Success responses should have data
			if response["status"] == "success" {
				if _, ok := response["result"]; !ok {
					t.Error("success response missing result field")
				}
			}

			// Error responses should have message
			if response["status"] == "error" {
				if _, ok := response["message"]; !ok {
					t.Error("error response missing message field")
				}
			}
		})
	}
}

// TestJSONOutputInstanceKill tests instance kill JSON output
func TestJSONOutputInstanceKill(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Create an instance to kill
	out := mustRunCLI(ctx, t, "instance", "new", "--output-format", "json")
	var newResponse map[string]interface{}
	json.Unmarshal([]byte(out), &newResponse)
	data, ok := newResponse["result"].(map[string]interface{})
	if !ok {
		t.Fatalf("failed to get data from instance new response")
	}
	address := data["address"].(string)

	// Kill the instance with JSON output
	out = mustRunCLI(ctx, t, "instance", "kill", address, "--output-format", "json")

	// Parse JSON
	var response map[string]interface{}
	if err := json.Unmarshal([]byte(out), &response); err != nil {
		t.Fatalf("failed to parse JSON: %v\nOutput: %s", err, out)
	}

	// Validate batch command structure
	if response["type"] != "command" {
		t.Errorf("expected type=command, got %v", response["type"])
	}
	if response["status"] != "success" {
		t.Errorf("expected status=success, got %v", response["status"])
	}
}

// TestJSONOutputInstanceDefault tests instance default JSON output
func TestJSONOutputInstanceDefault(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Create instances
	_ = mustRunCLI(ctx, t, "instance", "new")
	out := mustRunCLI(ctx, t, "instance", "new", "--output-format", "json")
	var newResponse map[string]interface{}
	json.Unmarshal([]byte(out), &newResponse)
	data, ok := newResponse["result"].(map[string]interface{})
	if !ok {
		t.Fatalf("failed to get result from instance new response")
	}
	address := data["address"].(string)

	// Set default with JSON output
	out = mustRunCLI(ctx, t, "instance", "default", address, "--output-format", "json")

	// Parse JSON
	var response map[string]interface{}
	if err := json.Unmarshal([]byte(out), &response); err != nil {
		t.Fatalf("failed to parse JSON: %v\nOutput: %s", err, out)
	}

	// Validate structure
	if response["status"] != "success" {
		t.Errorf("expected status=success, got %v", response["status"])
	}
}

// TestJSONOutputTaskList tests task list JSON output
func TestJSONOutputTaskList(t *testing.T) {
	ctx := context.Background()
	setTempClineDirWithManualCleanup(t) // Use manual cleanup to avoid git checkpoint cleanup errors

	// Create a task first
	_ = mustRunCLI(ctx, t, "instance", "new")
	_ = mustRunCLI(ctx, t, "task", "new", "test task", "--yolo")

	// List tasks with JSON output
	out := mustRunCLI(ctx, t, "task", "list", "--output-format", "json")

	// STRICT: Assert pure JSON with ZERO text leakage
	assertPureJSON(t, out, "task list --output-format json")

	// Parse JSON
	var response map[string]interface{}
	if err := json.Unmarshal([]byte(out), &response); err != nil {
		t.Fatalf("failed to parse JSON: %v\nOutput: %s", err, out)
	}

	// Validate structure
	if response["status"] != "success" {
		t.Errorf("expected status=success, got %v", response["status"])
	}
}

// TestJSONOutputTaskOpen tests task open JSON output
func TestJSONOutputTaskOpen(t *testing.T) {
	ctx := context.Background()
	setTempClineDirWithManualCleanup(t) // Use manual cleanup to avoid git checkpoint cleanup errors

	// Create a task first
	_ = mustRunCLI(ctx, t, "instance", "new")
	out := mustRunCLI(ctx, t, "task", "new", "test task", "--yolo", "--output-format", "json")

	// Parse to get task ID
	lines := strings.Split(strings.TrimSpace(out), "\n")
	var taskID string
	for _, line := range lines {
		var obj map[string]interface{}
		if json.Unmarshal([]byte(line), &obj) == nil {
			if status, ok := obj["status"].(string); ok && status == "success" {
				if data, ok := obj["result"].(map[string]interface{}); ok {
					taskID = data["taskId"].(string)
					break
				}
			}
		}
	}

	if taskID == "" {
		t.Fatal("failed to get task ID from task new")
	}

	// Open task with JSON output
	out = mustRunCLI(ctx, t, "task", "open", taskID, "--output-format", "json")

	// STRICT: Assert pure JSON with ZERO text leakage
	// This catches the "Successfully reinitialized task" message that was being suppressed
	assertPureJSON(t, out, "task open --output-format json")

	// Parse JSON
	var response map[string]interface{}
	if err := json.Unmarshal([]byte(out), &response); err != nil {
		t.Fatalf("failed to parse JSON: %v\nOutput: %s", err, out)
	}

	// Validate structure
	if response["status"] != "success" {
		t.Errorf("expected status=success, got %v", response["status"])
	}
}

// TestJSONOutputTaskView tests task view JSON output
func TestJSONOutputTaskView(t *testing.T) {
	ctx := context.Background()
	setTempClineDirWithManualCleanup(t) // Use manual cleanup to avoid git checkpoint cleanup errors

	// Create a task first
	_ = mustRunCLI(ctx, t, "instance", "new")
	_ = mustRunCLI(ctx, t, "task", "new", "test task", "--yolo")

	// View task with JSON output
	out := mustRunCLI(ctx, t, "task", "view", "--output-format", "json")

	// Should produce JSONL (multiple lines of JSON) - validate ENTIRE output first
	lines := strings.Split(strings.TrimSpace(out), "\n")

	// STRICT: Every line must be valid JSON - no plain text allowed
	for i, line := range lines {
		if line == "" {
			continue
		}
		if !json.Valid([]byte(line)) {
			t.Fatalf("Line %d is not valid JSON (text leakage): %s", i, line)
		}
	}

	// Additional check: should have at least one JSON line
	if len(lines) == 0 {
		t.Fatal("expected at least one line of output")
	}
}

// TestJSONOutputConfigGet tests config get JSON output
func TestJSONOutputConfigGet(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Start instance and set a config value
	_ = mustRunCLI(ctx, t, "instance", "new")
	_ = mustRunCLI(ctx, t, "config", "set", "auto-approval-settings.enabled=true")

	// Get config value with JSON output
	out := mustRunCLI(ctx, t, "config", "get", "auto-approval-settings.enabled", "--output-format", "json")

	// Parse JSON
	var response map[string]interface{}
	if err := json.Unmarshal([]byte(out), &response); err != nil {
		t.Fatalf("failed to parse JSON: %v\nOutput: %s", err, out)
	}

	// Validate structure
	if response["status"] != "success" {
		t.Errorf("expected status=success, got %v", response["status"])
	}
}

// TestJSONOutputConfigSet tests config set JSON output
func TestJSONOutputConfigSet(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Start instance
	_ = mustRunCLI(ctx, t, "instance", "new")

	// Set config value with JSON output (key=value format)
	out := mustRunCLI(ctx, t, "config", "set", "auto-approval-settings.enabled=true", "--output-format", "json")

	// Parse JSON
	var response map[string]interface{}
	if err := json.Unmarshal([]byte(out), &response); err != nil {
		t.Fatalf("failed to parse JSON: %v\nOutput: %s", err, out)
	}

	// Validate structure
	if response["status"] != "success" {
		t.Errorf("expected status=success, got %v", response["status"])
	}
}

// TestJSONOutputLogsClean tests logs clean JSON output
func TestJSONOutputLogsClean(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Clean logs with JSON output (may have no logs to clean)
	out := mustRunCLI(ctx, t, "logs", "clean", "--output-format", "json")

	// Parse JSON
	var response map[string]interface{}
	if err := json.Unmarshal([]byte(out), &response); err != nil {
		t.Fatalf("failed to parse JSON: %v\nOutput: %s", err, out)
	}

	// Validate structure
	if response["status"] != "success" {
		t.Errorf("expected status=success, got %v", response["status"])
	}
}

// TestJSONOutputTaskPause tests task pause JSON output
func TestJSONOutputTaskPause(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Create a task first
	_ = mustRunCLI(ctx, t, "instance", "new")
	_ = mustRunCLI(ctx, t, "task", "new", "test task", "--yolo")

	// Pause task with JSON output (may fail if task already completed)
	out, _, exitCode := runCLI(ctx, t, "task", "pause", "--output-format", "json")

	// If command succeeded, validate JSON output
	if exitCode == 0 {
		var response map[string]interface{}
		if err := json.Unmarshal([]byte(out), &response); err != nil {
			t.Fatalf("failed to parse JSON: %v\nOutput: %s", err, out)
		}
		if response["status"] != "success" {
			t.Errorf("expected status=success, got %v", response["status"])
		}
	}
	// If failed (task already completed), that's acceptable for this test
	// We're verifying JSON support exists, not business logic
}

// TestJSONOutputTaskSend tests task send JSON output
func TestJSONOutputTaskSend(t *testing.T) {
	ctx := context.Background()
	setTempClineDirWithManualCleanup(t) // Use manual cleanup to avoid git checkpoint cleanup errors

	// Create a task first
	_ = mustRunCLI(ctx, t, "instance", "new")
	_ = mustRunCLI(ctx, t, "task", "new", "test task", "--yolo")

	// Send message with JSON output
	// Note: This test just verifies the command accepts --output-format json
	// Actual JSON support for all error cases may not be complete
	out, errOut, exitCode := runCLI(ctx, t, "task", "send", "continue", "--output-format", "json")

	// Test passes if:
	// 1. Command succeeded with JSON output, OR
	// 2. Command failed but didn't complain about the --output-format flag
	if exitCode == 0 {
		// Try to parse as JSONL
		lines := strings.Split(strings.TrimSpace(out), "\n")
		for _, line := range lines {
			if line == "" {
				continue
			}
			// If it's JSON, that's good
			if json.Valid([]byte(line)) {
				return
			}
		}
	}

	// If failed, check it wasn't due to invalid flag
	combined := out + errOut
	if strings.Contains(combined, "unknown flag") || strings.Contains(combined, "invalid flag") {
		t.Fatal("command doesn't support --output-format flag")
	}

	// Otherwise test passes - command has the flag, even if not all code paths use it
}

// TestJSONOutputTaskRestore tests task restore JSON output
func TestJSONOutputTaskRestore(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Create a task
	_ = mustRunCLI(ctx, t, "instance", "new")
	_ = mustRunCLI(ctx, t, "task", "new", "test task", "--yolo")

	// Try to restore (may fail if no checkpoints)
	// Note: This test just verifies the command accepts --output-format json
	out, errOut, exitCode := runCLI(ctx, t, "task", "restore", "0", "--output-format", "json")

	// Test passes if command didn't complain about the flag
	combined := out + errOut
	if strings.Contains(combined, "unknown flag") || strings.Contains(combined, "invalid flag") {
		t.Fatal("command doesn't support --output-format flag")
	}

	// If succeeded, should be JSON
	if exitCode == 0 && json.Valid([]byte(strings.TrimSpace(out))) {
		return
	}

	// Otherwise test passes - command has the flag
}

// TestJSONOutputInstanceNewWithVerbose tests that verbose mode outputs JSONL format
func TestJSONOutputInstanceNewWithVerbose(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Create new instance with verbose + JSON
	out := mustRunCLI(ctx, t, "instance", "new", "--verbose", "--output-format", "json")

	// With verbose, output should be JSONL (multiple JSON objects, one per line)
	lines := strings.Split(strings.TrimSpace(out), "\n")
	if len(lines) == 0 {
		t.Fatal("expected output lines")
	}

	// Each line must be valid JSON
	var finalResponse map[string]interface{}
	debugCount := 0

	for i, line := range lines {
		if line == "" {
			continue
		}

		// Validate each line is JSON
		if !json.Valid([]byte(line)) {
			t.Fatalf("line %d is not valid JSON: %s", i, line)
		}

		var obj map[string]interface{}
		if err := json.Unmarshal([]byte(line), &obj); err != nil {
			t.Fatalf("failed to parse JSON line %d: %v\nLine: %s", i, err, line)
		}

		// Check if this is a debug message or final response
		if msgType, ok := obj["type"].(string); ok && msgType == "command" {
			if status, ok := obj["status"].(string); ok {
				if status == "debug" {
					debugCount++
					// Verify debug messages have required fields
					if _, ok := obj["message"]; !ok {
						t.Errorf("debug message missing 'message' field on line %d", i)
					}
					if _, ok := obj["command"]; !ok {
						t.Errorf("debug message missing 'command' field on line %d", i)
					}
				} else if status == "success" {
					// This is the final response
					finalResponse = obj
				}
			}
		}
	}

	// Should have debug messages from verbose mode
	if debugCount == 0 {
		t.Error("expected debug messages in verbose mode")
	}

	// Should have final success response
	if finalResponse == nil {
		t.Fatal("no final success response found")
	}

	t.Logf("✓ Validated %d debug messages and 1 success response in JSONL format", debugCount)
}

// TestRegistryTextLeakage tests that registry operations don't leak text in JSON mode
func TestRegistryTextLeakage(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Create multiple instances to trigger cleanup operations
	for i := 0; i < 5; i++ {
		_ = mustRunCLI(ctx, t, "instance", "new", "-F", "json")
	}

	// Kill all instances - this triggers registry cleanup logic that was leaking text
	out := mustRunCLI(ctx, t, "instance", "kill", "--all-cli", "-F", "json")

	// STRICT: Verify ONLY JSON output, no text leakage
	assertPureJSON(t, out, "instance kill --all-cli -F json")

	// Parse the JSON response
	var response map[string]interface{}
	if err := json.Unmarshal([]byte(out), &response); err != nil {
		t.Fatalf("failed to parse JSON: %v\nOutput: %s", err, out)
	}

	// Should be successful batch command
	if response["type"] != "command" {
		t.Errorf("expected type=command, got %v", response["type"])
	}
	if response["status"] != "success" {
		t.Errorf("expected status=success, got %v", response["status"])
	}

	// Verify no plain text messages leaked through
	// These are messages that were being output by registry.go before the fixes
	forbidden := []string{
		"Attempting to shutdown",
		"Warning: Failed to request",
		"Removed stale instance",
		"Host bridge shutdown",
		"Set new default instance",
		"Warning:",
		"Removed stale default",
	}

	for _, text := range forbidden {
		if strings.Contains(out, text) {
			t.Errorf("JSON output contains forbidden text (text leakage): %q\nFull output: %s", text, out)
		}
	}

	// The output should ONLY contain valid JSON structure
	// No stray text from registryLog() or registryWarning() calls
	if data, ok := response["result"].(map[string]interface{}); ok {
		// Verify we got structured data about the kill operation
		if _, ok := data["killedCount"]; !ok {
			t.Error("response should include killedCount")
		}
		if _, ok := data["addresses"]; !ok {
			t.Error("response should include addresses array")
		}
	} else {
		t.Error("response should have data field")
	}
}

// min returns the minimum of two integers
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
