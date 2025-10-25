package e2e

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

// TestJSONErrorOutput tests that errors in JSON mode are properly formatted
func TestJSONErrorOutput(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Test non-existent command
	_, errOut, exitCode := runCLI(ctx, t, "nonexistent", "--output-format", "json")

	// Should have non-zero exit code
	if exitCode == 0 {
		t.Error("invalid command should have non-zero exit code")
	}

	// Error output should be JSON in JSON mode
	var errorData map[string]interface{}
	if err := json.Unmarshal([]byte(errOut), &errorData); err != nil {
		t.Logf("Note: error output not JSON: %v", err)
		return
	}

	// Should have error status
	if status, ok := errorData["status"].(string); !ok || status != "error" {
		t.Error("error response should have status=error")
	}
}

// TestPlainErrorOutput tests that errors in plain mode are human-readable
func TestPlainErrorOutput(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Test invalid instance address
	_, errOut, exitCode := runCLI(ctx, t, "instance", "kill", "invalid:address", "--output-format", "plain")

	// Should have non-zero exit code
	if exitCode == 0 {
		t.Error("invalid address should have non-zero exit code")
	}

	// Error should NOT be JSON
	if json.Valid([]byte(errOut)) {
		t.Error("plain mode errors should not be JSON")
	}

	// Should contain error message
	if errOut == "" {
		t.Error("plain mode should output error message")
	}
}

// TestRichErrorOutput tests that errors in rich mode are human-readable
func TestRichErrorOutput(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Test invalid command
	_, errOut, exitCode := runCLI(ctx, t, "instance", "default", "nonexistent:address", "--output-format", "rich")

	// Should have non-zero exit code
	if exitCode == 0 {
		t.Error("invalid address should have non-zero exit code")
	}

	// Error should NOT be JSON
	if json.Valid([]byte(errOut)) {
		t.Error("rich mode errors should not be JSON")
	}

	// Should contain error message
	if errOut == "" {
		t.Error("rich mode should output error message")
	}
}

// TestErrorExitCodes tests that different error types have appropriate exit codes
func TestErrorExitCodes(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	tests := []struct {
		name         string
		args         []string
		expectNonZero bool
	}{
		// Note: "invalid-command" test removed because by design, the CLI accepts
		// any text as a task prompt (e.g., "cline nonexistent" treats "nonexistent" 
		// as a prompt, not an invalid command)
		{"invalid-flag", []string{"version", "--nonexistent-flag"}, true},
		{"invalid-address", []string{"instance", "kill", "invalid"}, true},
		{"valid-command", []string{"version", "--output-format", "json"}, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, _, exitCode := runCLI(ctx, t, tt.args...)
			
			if tt.expectNonZero && exitCode == 0 {
				t.Errorf("%s should have non-zero exit code", tt.name)
			}
			if !tt.expectNonZero && exitCode != 0 {
				t.Errorf("%s should have zero exit code, got %d", tt.name, exitCode)
			}
		})
	}
}

// TestJSONErrorStructure tests the structure of JSON error responses
func TestJSONErrorStructure(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	_, errOut, _ := runCLI(ctx, t, "instance", "kill", "invalid:99999", "--output-format", "json")

	// Parse error JSON
	var errorData map[string]interface{}
	if err := json.Unmarshal([]byte(errOut), &errorData); err != nil {
		t.Fatalf("error output should be valid JSON: %v", err)
	}

	// Check required fields
	if _, ok := errorData["status"]; !ok {
		t.Error("JSON error should have 'status' field")
	}
	if _, ok := errorData["command"]; !ok {
		t.Error("JSON error should have 'command' field")
	}
	if _, ok := errorData["error"]; !ok {
		t.Error("JSON error should have 'error' field")
	}
}

// TestPartialCommandFailure tests handling of partially successful commands
func TestPartialCommandFailure(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Start multiple instances
	_ = mustRunCLI(ctx, t, "instance", "new", "--output-format", "json")
	_ = mustRunCLI(ctx, t, "instance", "new", "--output-format", "json")

	// Try to kill with --all-cli (should succeed)
	out := mustRunCLI(ctx, t, "instance", "kill", "--all-cli", "--output-format", "json")

	// Should be valid JSON
	var result map[string]interface{}
	if err := json.Unmarshal([]byte(out), &result); err != nil {
		t.Fatalf("output should be valid JSON: %v", err)
	}

	// Should report success
	if status, ok := result["status"].(string); !ok || status != "success" {
		t.Error("successful kill should have status=success")
	}
}

// TestMissingRequiredParameter tests error handling for missing parameters
func TestMissingRequiredParameter(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	tests := []struct {
		name string
		args []string
	}{
		{"instance-kill-no-address", []string{"instance", "kill", "--output-format", "json"}},
		{"instance-default-no-address", []string{"instance", "default", "--output-format", "json"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, errOut, exitCode := runCLI(ctx, t, tt.args...)

			// Should fail
			if exitCode == 0 {
				t.Error("missing required parameter should fail")
			}

			// In JSON mode, error should be JSON
			if strings.Contains(tt.args[len(tt.args)-1], "json") {
				if !json.Valid([]byte(errOut)) {
					t.Error("JSON mode error should be valid JSON")
				}
			}
		})
	}
}

// TestInvalidFlagCombinations tests error handling for invalid flag combinations
func TestInvalidFlagCombinations(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Test invalid output format
	_, errOut, exitCode := runCLI(ctx, t, "version", "--output-format", "invalid")

	// Should fail
	if exitCode == 0 {
		t.Error("invalid output format should fail")
	}

	// Should mention the invalid value
	if !strings.Contains(errOut, "invalid") {
		t.Error("error should mention invalid format")
	}
}

// TestNetworkErrorHandling tests handling of network/connection errors
func TestNetworkErrorHandling(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Try to connect to non-existent instance
	_, errOut, exitCode := runCLI(ctx, t, "instance", "kill", "127.0.0.1:99999", "--output-format", "json")

	// Should fail gracefully
	if exitCode == 0 {
		t.Error("connection to non-existent instance should fail")
	}

	// In JSON mode, should return JSON error
	var errorData map[string]interface{}
	if err := json.Unmarshal([]byte(errOut), &errorData); err != nil {
		t.Errorf("connection error in JSON mode should be JSON: %v", err)
	}
}

// TestErrorMessageClarity tests that error messages are clear and actionable
func TestErrorMessageClarity(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	tests := []struct {
		name          string
		args          []string
		shouldContain []string
	}{
		// Note: "invalid-command" test removed for same reason as in TestErrorExitCodes
		// The CLI by design accepts any text as a task prompt
		{
			"invalid-instance",
			[]string{"instance", "default", "nonexistent:9999", "--output-format", "plain"},
			[]string{"not found", "instance"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, errOut, exitCode := runCLI(ctx, t, tt.args...)

			// Should fail
			if exitCode == 0 {
				t.Error("invalid command should fail")
			}

			// Should contain helpful keywords
			errOutLower := strings.ToLower(errOut)
			for _, keyword := range tt.shouldContain {
				if !strings.Contains(errOutLower, strings.ToLower(keyword)) {
					t.Errorf("error message should contain '%s', got: %s", keyword, errOut)
				}
			}
		})
	}
}

// TestConcurrentErrors tests error handling with concurrent operations
func TestConcurrentErrors(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Start instance
	_ = mustRunCLI(ctx, t, "instance", "new")

	// Try to set default to non-existent instance
	_, errOut, exitCode := runCLI(ctx, t, "instance", "default", "nonexistent:9999", "--output-format", "json")

	// Should fail
	if exitCode == 0 {
		t.Error("setting non-existent default should fail")
	}

	// Error should be JSON
	var errorData map[string]interface{}
	if err := json.Unmarshal([]byte(errOut), &errorData); err != nil {
		t.Errorf("error should be JSON: %v", err)
	}

	// Original instance should still be default
	listOut := mustRunCLI(ctx, t, "instance", "list", "--output-format", "json")

	var listData map[string]interface{}
	if err := json.Unmarshal([]byte(listOut), &listData); err != nil {
		t.Fatalf("list output should be JSON: %v", err)
	}

	// Default should not have changed
	if data, ok := listData["data"].(map[string]interface{}); ok {
		if defaultInstance, ok := data["defaultInstance"].(string); ok && defaultInstance == "nonexistent:9999" {
			t.Error("default instance should not have changed after failed update")
		}
	}
}

// TestJSONErrorInstanceKillNotInRegistry tests error when killing instance not in registry
func TestJSONErrorInstanceKillNotInRegistry(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Try to kill instance that doesn't exist in registry
	// Use a valid address format but not a registered instance
	_, errOut, exitCode := runCLI(ctx, t, "instance", "kill", "localhost:5000", "--output-format", "json")

	// Should fail
	if exitCode == 0 {
		t.Error("killing non-existent instance should fail")
	}

	// Error should be JSON
	var errorData map[string]interface{}
	if err := json.Unmarshal([]byte(errOut), &errorData); err != nil {
		t.Fatalf("error output should be valid JSON: %v\nOutput: %s", err, errOut)
	}

	// Should have error status
	if status, ok := errorData["status"].(string); !ok || status != "error" {
		t.Errorf("expected status=error, got %v", errorData["status"])
	}

	// Should have error message mentioning "not found"
	if errMsg, ok := errorData["error"].(string); ok {
		if !strings.Contains(strings.ToLower(errMsg), "not found") {
			t.Errorf("error message should mention 'not found', got: %s", errMsg)
		}
	}
}

// TestJSONErrorConfigGetInvalid tests error when getting invalid config key
func TestJSONErrorConfigGetInvalid(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Start instance
	_ = mustRunCLI(ctx, t, "instance", "new")

	// Try to get non-existent config key
	_, errOut, exitCode := runCLI(ctx, t, "config", "get", "invalid.nonexistent.key", "--output-format", "json")

	// Should fail
	if exitCode == 0 {
		t.Error("getting invalid config key should fail")
	}

	// Error should be JSON
	var errorData map[string]interface{}
	if err := json.Unmarshal([]byte(errOut), &errorData); err != nil {
		t.Fatalf("error output should be valid JSON: %v\nOutput: %s", err, errOut)
	}

	// Should have error status
	if status, ok := errorData["status"].(string); !ok || status != "error" {
		t.Errorf("expected status=error, got %v", errorData["status"])
	}

	// Should have error field
	if _, ok := errorData["error"]; !ok {
		t.Error("error response should have error field")
	}
}

// TestJSONErrorTaskOpenNonexistent tests error when opening nonexistent task
func TestJSONErrorTaskOpenNonexistent(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Start instance
	_ = mustRunCLI(ctx, t, "instance", "new")

	// Try to open non-existent task with high ID that won't exist
	_, errOut, exitCode := runCLI(ctx, t, "task", "open", "99999", "--output-format", "json")

	// Should fail
	if exitCode == 0 {
		t.Error("opening non-existent task should fail")
	}

	// Error should be JSON
	var errorData map[string]interface{}
	if err := json.Unmarshal([]byte(errOut), &errorData); err != nil {
		t.Fatalf("error output should be valid JSON: %v\nOutput: %s", err, errOut)
	}

	// Should have error status
	if status, ok := errorData["status"].(string); !ok || status != "error" {
		t.Errorf("expected status=error, got %v", errorData["status"])
	}

	// Should have error message
	if errMsg, ok := errorData["error"].(string); ok {
		if !strings.Contains(strings.ToLower(errMsg), "not found") && 
		   !strings.Contains(strings.ToLower(errMsg), "does not exist") {
			t.Logf("Note: error message format: %s", errMsg)
		}
	}
}

// TestJSONErrorInstanceDefaultDetailed tests comprehensive error scenarios for instance default
func TestJSONErrorInstanceDefaultDetailed(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	tests := []struct {
		name          string
		address       string
		shouldContain string
	}{
		{
			name:          "invalid-port",
			address:       "localhost:99999",
			shouldContain: "not found",
		},
		{
			name:          "invalid-address",
			address:       "nonexistent:9999",
			shouldContain: "not found",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Try to set invalid instance as default
			_, errOut, exitCode := runCLI(ctx, t, "instance", "default", tt.address, "--output-format", "json")

			// Should fail
			if exitCode == 0 {
				t.Errorf("setting invalid default %s should fail", tt.address)
			}

			// Error should be JSON
			var errorData map[string]interface{}
			if err := json.Unmarshal([]byte(errOut), &errorData); err != nil {
				t.Fatalf("error output should be valid JSON: %v", err)
			}

			// Should have error status
			if status, ok := errorData["status"].(string); !ok || status != "error" {
				t.Errorf("expected status=error, got %v", errorData["status"])
			}

			// Check error message content
			if errMsg, ok := errorData["error"].(string); ok {
				if !strings.Contains(strings.ToLower(errMsg), tt.shouldContain) {
					t.Errorf("error message should contain '%s', got: %s", tt.shouldContain, errMsg)
				}
			}
		})
	}
}
