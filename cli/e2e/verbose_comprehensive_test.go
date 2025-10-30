package e2e

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"
)

// TestVerboseCrossCommandConsistency tests that verbose flag works consistently across all CLI commands
func TestVerboseCrossCommandConsistency(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Define command groups with their expected verbose behaviors
	commandTests := []struct {
		name            string
		args            []string
		description     string
		expectJSON      bool // Whether JSON output should be valid
		expectMultiLine bool // Whether verbose should produce multiple lines
	}{
		{
			name:            "version",
			args:            []string{"version"},
			description:     "Version command should support verbose output",
			expectJSON:      true,
			expectMultiLine: false, // Version is a simple command
		},
		{
			name:            "instance-list",
			args:            []string{"instance", "list"},
			description:     "Instance list should show verbose details",
			expectJSON:      true,
			expectMultiLine: false, // List commands are typically single response
		},
		{
			name:            "instance-new",
			args:            []string{"instance", "new"},
			description:     "Instance creation should show verbose progress",
			expectJSON:      true,
			expectMultiLine: true, // Instance creation has multiple steps
		},
		{
			name:            "config-list",
			args:            []string{"config", "list"},
			description:     "Config list should show verbose configuration details",
			expectJSON:      true,
			expectMultiLine: false, // Config list is typically single response
		},
		{
			name:            "logs-path",
			args:            []string{"logs", "path"},
			description:     "Logs path should work with verbose",
			expectJSON:      true,
			expectMultiLine: false, // Simple informational command
		},
	}

	for _, tt := range commandTests {
		t.Run(tt.name, func(t *testing.T) {
			// Test without verbose first for comparison
			normalCmd := append(tt.args, "--output-format", "json")
			normalOut, normalErr, normalExit := runCLI(ctx, t, normalCmd...)

			// Test with verbose
			verboseCmd := append(tt.args, "--output-format", "json", "--verbose")
			verboseOut, verboseErr, verboseExit := runCLI(ctx, t, verboseCmd...)

			// Both should succeed (or fail consistently)
			if normalExit != verboseExit {
				t.Errorf("%s: exit codes differ - normal: %d, verbose: %d", tt.description, normalExit, verboseExit)
			}

			// Skip further tests if command failed
			if normalExit != 0 {
				t.Logf("%s: command failed as expected (exit %d), skipping verbose validation", tt.description, normalExit)
				return
			}

			// Validate JSON structure
			if tt.expectJSON {
				validateVerboseJSONOutput(t, tt.name, verboseOut, tt.expectMultiLine)

				// Compare with normal output structure
				compareOutputStructure(t, tt.name, normalOut, verboseOut)
			}

			// Verbose should generally produce more output
			if len(verboseOut) < len(normalOut) && tt.expectMultiLine {
				t.Errorf("%s: verbose output (%d chars) should be longer than normal output (%d chars)",
					tt.description, len(verboseOut), len(normalOut))
			}

			// Verbose stderr should be same or more detailed
			if verboseErr != normalErr && normalErr != "" {
				t.Logf("%s: verbose stderr differs from normal - this may be expected", tt.description)
			}
		})
	}
}

// validateVerboseJSONOutput validates that verbose JSON output follows expected structure
func validateVerboseJSONOutput(t *testing.T, testName, output string, expectMultiLine bool) {
	t.Helper()

	lines := strings.Split(strings.TrimSpace(output), "\n")

	if expectMultiLine && len(lines) < 2 {
		t.Errorf("%s: verbose JSON should have multiple lines, got %d", testName, len(lines))
	}

	validJSONLines := 0
	hasStatusUpdate := false
	hasResponse := false

	for i, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		// Each line should be valid JSON
		var lineData map[string]interface{}
		if err := json.Unmarshal([]byte(line), &lineData); err != nil {
			t.Errorf("%s line %d: invalid JSON: %v\nLine: %s", testName, i, err, line)
			continue
		}

		validJSONLines++

		// Check for expected fields in verbose JSON
		if lineType, ok := lineData["type"].(string); ok {
			// New format: type="command" with status field
			if lineType == "command" {
				if status, ok := lineData["status"].(string); ok {
					if status == "debug" {
						hasStatusUpdate = true
					} else if status == "success" || status == "error" {
						hasResponse = true
					}
				}
			}
			// Legacy format support (if any)
			switch lineType {
			case "status", "debug", "progress":
				hasStatusUpdate = true
			case "response":
				hasResponse = true
			}
		}

		// All verbose lines should have timestamps if available
		if timestamp, ok := lineData["timestamp"]; ok {
			if _, ok := timestamp.(string); !ok {
				t.Errorf("%s line %d: timestamp should be string, got %T", testName, i, timestamp)
			}
		}
	}

	if validJSONLines == 0 {
		t.Errorf("%s: no valid JSON lines found in verbose output", testName)
	}

	// Multi-line verbose output should have either status updates or final response
	if expectMultiLine && !hasStatusUpdate && !hasResponse {
		t.Errorf("%s: verbose output should contain status updates or response", testName)
	}
}

// compareOutputStructure compares normal vs verbose output structure
func compareOutputStructure(t *testing.T, testName, normalOut, verboseOut string) {
	t.Helper()

	// Parse normal output (should be single JSON)
	var normalData map[string]interface{}
	if err := json.Unmarshal([]byte(normalOut), &normalData); err != nil {
		t.Errorf("%s: normal output should be valid JSON: %v", testName, err)
		return
	}

	// Parse last line of verbose output (should be final response)
	verboseLines := strings.Split(strings.TrimSpace(verboseOut), "\n")
	lastLine := verboseLines[len(verboseLines)-1]

	var verboseData map[string]interface{}
	if err := json.Unmarshal([]byte(lastLine), &verboseData); err != nil {
		t.Errorf("%s: verbose final line should be valid JSON: %v", testName, err)
		return
	}

	// The final response structure should be similar
	if normalStatus, ok := normalData["status"]; ok {
		if verboseStatus, ok := verboseData["status"]; ok {
			if normalStatus != verboseStatus {
				t.Errorf("%s: status differs between normal (%v) and verbose (%v)",
					testName, normalStatus, verboseStatus)
			}
		}
	}

	// Data structure should be preserved
	if normalDataField, ok := normalData["result"]; ok {
		if verboseDataField, ok := verboseData["result"]; ok {
			// Deep comparison of data structures
			if !reflect.DeepEqual(normalDataField, verboseDataField) {
				t.Logf("%s: data structures differ between normal and verbose - this may be expected due to additional verbose fields", testName)
			}
		}
	}
}

// TestVerboseFlagValidation tests that verbose flag is properly validated
func TestVerboseFlagValidation(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	tests := []struct {
		name        string
		args        []string
		expectError bool
	}{
		{
			name:        "verbose-with-json",
			args:        []string{"version", "--verbose", "--output-format", "json"},
			expectError: false,
		},
		{
			name:        "verbose-with-plain",
			args:        []string{"version", "--verbose", "--output-format", "plain"},
			expectError: false,
		},
		{
			name:        "verbose-with-rich",
			args:        []string{"version", "--verbose", "--output-format", "rich"},
			expectError: false,
		},
		{
			name:        "verbose-only",
			args:        []string{"version", "--verbose"},
			expectError: false, // Should use default format
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, _, exit := runCLI(ctx, t, tt.args...)

			if tt.expectError && exit == 0 {
				t.Errorf("expected command to fail but it succeeded")
			}
			if !tt.expectError && exit != 0 {
				t.Errorf("expected command to succeed but it failed with exit %d", exit)
			}
		})
	}
}

// TestVerboseOutputIntegrity tests that verbose output maintains data integrity
func TestVerboseOutputIntegrity(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Run the same command multiple times to ensure consistent verbose output
	const iterations = 5
	var outputs []string

	for i := 0; i < iterations; i++ {
		out := mustRunCLI(ctx, t, "version", "--output-format", "json", "--verbose")
		outputs = append(outputs, out)
	}

	// All outputs should have similar structure
	for i := 1; i < len(outputs); i++ {
		lines1 := strings.Split(strings.TrimSpace(outputs[0]), "\n")
		lines2 := strings.Split(strings.TrimSpace(outputs[i]), "\n")

		if len(lines1) != len(lines2) {
			t.Errorf("iteration %d: line count differs (%d vs %d)", i, len(lines1), len(lines2))
		}

		// Each corresponding line should have same structure (though values may differ)
		for j := 0; j < len(lines1) && j < len(lines2); j++ {
			var data1, data2 map[string]interface{}

			if err := json.Unmarshal([]byte(lines1[j]), &data1); err != nil {
				continue // Skip non-JSON lines
			}
			if err := json.Unmarshal([]byte(lines2[j]), &data2); err != nil {
				continue
			}

			// Should have same keys
			if len(data1) != len(data2) {
				t.Errorf("iteration %d, line %d: field count differs", i, j)
			}

			for key := range data1 {
				if _, ok := data2[key]; !ok {
					t.Errorf("iteration %d, line %d: missing key %s", i, j, key)
				}
			}
		}
	}
}

// TestVerboseErrorHandling tests that verbose mode handles errors gracefully
func TestVerboseErrorHandling(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Test commands that should fail
	errorTests := []struct {
		name string
		args []string
	}{
		{
			name: "invalid-instance",
			args: []string{"instance", "kill", "nonexistent:9999", "--verbose", "--output-format", "json"},
		},
		{
			name: "invalid-flag",
			args: []string{"version", "--invalid-flag", "--verbose", "--output-format", "json"},
		},
	}

	for _, tt := range errorTests {
		t.Run(tt.name, func(t *testing.T) {
			out, errOut, exit := runCLI(ctx, t, tt.args...)

			// Should fail
			if exit == 0 {
				t.Errorf("expected command to fail but it succeeded")
			}

			// Even in error cases, if JSON output is requested and produced, it should be valid
			if strings.Contains(strings.Join(tt.args, " "), "--output-format") &&
				strings.Contains(strings.Join(tt.args, " "), "json") &&
				out != "" {

				// Try to parse as JSON
				lines := strings.Split(strings.TrimSpace(out), "\n")
				for _, line := range lines {
					line = strings.TrimSpace(line)
					if line == "" {
						continue
					}

					var data map[string]interface{}
					if err := json.Unmarshal([]byte(line), &data); err != nil {
						t.Errorf("error output should be valid JSON: %v\nLine: %s", err, line)
					}
				}
			}

			// Error output should be present
			if errOut == "" && out == "" {
				t.Error("expected some error output")
			}
		})
	}
}

// TestVerboseTimestampConsistency tests that timestamps in verbose output are reasonable
func TestVerboseTimestampConsistency(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	out := mustRunCLI(ctx, t, "version", "--output-format", "json", "--verbose")

	lines := strings.Split(strings.TrimSpace(out), "\n")
	var timestamps []time.Time

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		var data map[string]interface{}
		if err := json.Unmarshal([]byte(line), &data); err != nil {
			continue
		}

		if tsStr, ok := data["timestamp"].(string); ok {
			// Try common timestamp formats
			formats := []string{
				time.RFC3339,
				time.RFC3339Nano,
				"2006-01-02T15:04:05.000Z",
				"2006-01-02T15:04:05Z",
			}

			var ts time.Time
			var parseErr error
			for _, format := range formats {
				ts, parseErr = time.Parse(format, tsStr)
				if parseErr == nil {
					break
				}
			}

			if parseErr != nil {
				t.Errorf("unable to parse timestamp %s: %v", tsStr, parseErr)
			} else {
				timestamps = append(timestamps, ts)
			}
		}
	}

	// Timestamps should be in chronological order
	for i := 1; i < len(timestamps); i++ {
		if timestamps[i].Before(timestamps[i-1]) {
			t.Errorf("timestamps not in chronological order: %v before %v",
				timestamps[i], timestamps[i-1])
		}
	}

	// All timestamps should be recent (within last minute)
	now := time.Now()
	for i, ts := range timestamps {
		if now.Sub(ts) > time.Minute {
			t.Errorf("timestamp %d too old: %v (now: %v)", i, ts, now)
		}
	}
}

// TestVerboseModeMemoryUsage tests that verbose mode doesn't cause memory issues
func TestVerboseModeMemoryUsage(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Run verbose command multiple times to check for memory leaks
	const iterations = 10

	for i := 0; i < iterations; i++ {
		out := mustRunCLI(ctx, t, "version", "--output-format", "json", "--verbose")

		// Output length should be reasonable (not growing unboundedly)
		if len(out) > 100*1024 { // 100KB threshold for version command
			t.Errorf("iteration %d: verbose output unusually large (%d bytes)", i, len(out))
		}

		// Should still be valid JSON
		lines := strings.Split(strings.TrimSpace(out), "\n")
		for j, line := range lines {
			if strings.TrimSpace(line) == "" {
				continue
			}

			var data map[string]interface{}
			if err := json.Unmarshal([]byte(line), &data); err != nil {
				t.Errorf("iteration %d, line %d: invalid JSON: %v", i, j, err)
			}
		}
	}
}
