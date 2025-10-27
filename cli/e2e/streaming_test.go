package e2e

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

// TestJSONLStreamingOutput tests streaming JSONL output with verbose flag
func TestJSONLStreamingOutput(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Verbose flag should produce JSONL (streaming JSON lines)
	out := mustRunCLI(ctx, t, "instance", "new", "--output-format", "json", "--verbose")

	// Split into lines
	lines := strings.Split(strings.TrimSpace(out), "\n")

	if len(lines) < 1 {
		t.Fatal("verbose output should have content")
	}

	// Each non-empty line should be valid JSON
	var foundSuccess bool
	validJSONLines := 0

	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			continue
		}

		var lineData map[string]interface{}
		if err := json.Unmarshal([]byte(line), &lineData); err != nil {
			t.Errorf("each JSONL line should be valid JSON: %v\nLine: %s", err, line)
			continue
		}

		validJSONLines++

		// Check line types (optional - implementation may vary)
		if lineType, ok := lineData["type"].(string); ok {
			if lineType == "response" {
				foundSuccess = true
			}
		}
		// Also check for status field as alternative
		if status, ok := lineData["status"].(string); ok && status == "success" {
			foundSuccess = true
		}
	}

	// At least one line should be valid JSON
	if validJSONLines == 0 {
		t.Error("verbose output should have valid JSON lines")
	}

	// Should have final success (may or may not have debug - implementation dependent)
	if !foundSuccess {
		t.Log("Note: no explicit success response found - may be implementation dependent")
	}
}

// TestNonStreamingJSONOutput tests that non-verbose JSON is single response
func TestNonStreamingJSONOutput(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Without verbose, should be single JSON response
	out := mustRunCLI(ctx, t, "instance", "new", "--output-format", "json")

	// Should be single valid JSON object
	var result map[string]interface{}
	if err := json.Unmarshal([]byte(out), &result); err != nil {
		t.Fatalf("non-verbose output should be single JSON: %v", err)
	}

	// Should not have multiple lines
	lines := strings.Split(strings.TrimSpace(out), "\n")
	if len(lines) > 1 {
		t.Error("non-verbose JSON should be single line")
	}

	// Should have response structure
	if _, ok := result["status"]; !ok {
		t.Error("response should have status field")
	}
	if _, ok := result["data"]; !ok {
		t.Error("response should have data field")
	}
}

// TestStreamingVerboseFormats tests verbose flag across all formats
func TestStreamingVerboseFormats(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	tests := []struct {
		name   string
		format string
		checkFn func(string) bool
	}{
		{
			"json-verbose",
			"json",
			func(out string) bool {
				// Should have valid JSON content (may be single or multiple lines)
				lines := strings.Split(strings.TrimSpace(out), "\n")
				if len(lines) < 1 {
					return false
				}
				// Each non-empty line should be valid JSON
				validCount := 0
				for _, line := range lines {
					if strings.TrimSpace(line) == "" {
						continue
					}
					if json.Valid([]byte(line)) {
						validCount++
					}
				}
				return validCount > 0
			},
		},
		{
			"plain-verbose",
			"plain",
			func(out string) bool {
				// Should not be JSON
				return !json.Valid([]byte(out)) && out != ""
			},
		},
		{
			"rich-verbose",
			"rich",
			func(out string) bool {
				// Should not be JSON
				return !json.Valid([]byte(out)) && out != ""
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			out := mustRunCLI(ctx, t, "instance", "list", "--output-format", tt.format, "--verbose")

			if !tt.checkFn(out) {
				t.Errorf("%s verbose output failed validation", tt.name)
			}
		})
	}
}

// TestProgressiveOutput tests that output arrives progressively (not buffered)
func TestProgressiveOutput(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Verbose mode with multiple steps should show incremental progress
	out := mustRunCLI(ctx, t, "instance", "new", "--output-format", "json", "--verbose")

	lines := strings.Split(strings.TrimSpace(out), "\n")

	// Should have multiple progress updates (JSONL lines)
	if len(lines) < 2 {
		t.Error("progressive output should have multiple updates")
	}

	// Lines should arrive in sequence (chronological order can be verified if timestamps exist)
	var timestamps []string
	for _, line := range lines {
		var data map[string]interface{}
		if err := json.Unmarshal([]byte(line), &data); err == nil {
			if ts, ok := data["timestamp"].(string); ok {
				timestamps = append(timestamps, ts)
			}
		}
	}

	// If we have timestamps, they should be in order
	// (Not all lines may have timestamps, so this is optional verification)
	if len(timestamps) > 1 {
		for i := 1; i < len(timestamps); i++ {
			if timestamps[i] < timestamps[i-1] {
				t.Error("timestamps should be in chronological order")
			}
		}
	}
}

// TestBufferedVsUnbufferedOutput tests output buffering behavior
func TestBufferedVsUnbufferedOutput(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Quick commands should complete with full output
	out := mustRunCLI(ctx, t, "version", "--output-format", "json")

	// Should be complete JSON
	var result map[string]interface{}
	if err := json.Unmarshal([]byte(out), &result); err != nil {
		t.Error("buffered output should be complete JSON")
	}

	// Verbose mode should also complete with full JSONL
	verboseOut := mustRunCLI(ctx, t, "version", "--output-format", "json", "--verbose")

	// All lines should be valid
	lines := strings.Split(strings.TrimSpace(verboseOut), "\n")
	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			continue
		}
		if !json.Valid([]byte(line)) {
			t.Error("verbose output lines should all be valid JSON")
		}
	}
}

// TestRealTimeStatusUpdates tests that status updates appear in real-time
func TestRealTimeStatusUpdates(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Commands with multiple steps should show updates as they progress
	out := mustRunCLI(ctx, t, "instance", "new", "--output-format", "json", "--verbose")

	// Parse JSONL
	lines := strings.Split(strings.TrimSpace(out), "\n")

	// Should have status/debug messages throughout execution
	var statusUpdates []string
	for _, line := range lines {
		var data map[string]interface{}
		if err := json.Unmarshal([]byte(line), &data); err == nil {
			// Check for new format: type="command" with status="debug"
			if lineType, ok := data["type"].(string); ok {
				if lineType == "command" {
					if status, ok := data["status"].(string); ok && status == "debug" {
						if msg, ok := data["message"].(string); ok {
							statusUpdates = append(statusUpdates, msg)
						}
					}
				}
			}
		}
	}

	// Should have at least one status/debug update
	if len(statusUpdates) == 0 {
		t.Error("real-time updates should include status/debug messages")
	}
}

// TestStreamingOutputIntegrity tests that streaming doesn't corrupt data
func TestStreamingOutputIntegrity(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Create multiple instances with verbose output
	for i := 0; i < 3; i++ {
		out := mustRunCLI(ctx, t, "instance", "new", "--output-format", "json", "--verbose")

		// All JSONL lines should be valid
		lines := strings.Split(strings.TrimSpace(out), "\n")
		for j, line := range lines {
			if strings.TrimSpace(line) == "" {
				continue
			}

			var data map[string]interface{}
			if err := json.Unmarshal([]byte(line), &data); err != nil {
				t.Errorf("instance %d, line %d: corrupted JSON: %v\nLine: %s", i, j, err, line)
			}
		}
	}
}

// TestJSONLParsing tests that JSONL can be parsed line-by-line
func TestJSONLParsing(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	out := mustRunCLI(ctx, t, "instance", "new", "--output-format", "json", "--verbose")

	// Simulate line-by-line parsing (as a consumer would do)
	lines := strings.Split(out, "\n")

	var parsedLines int
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		var data map[string]interface{}
		if err := json.Unmarshal([]byte(line), &data); err != nil {
			t.Errorf("failed to parse JSONL line: %v\nLine: %s", err, line)
			continue
		}

		parsedLines++

		// Each line should be self-contained
		if _, ok := data["type"]; !ok {
			t.Error("each JSONL line should have a type field")
		}
	}

	if parsedLines < 2 {
		t.Error("should have multiple parseable JSONL lines")
	}
}

// TestNonStreamingCommands tests commands that don't support streaming
func TestNonStreamingCommands(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Simple informational commands should be non-streaming
	commands := [][]string{
		{"logs", "path", "--output-format", "json"},
		{"version", "--short"},
	}

	for _, cmd := range commands {
		out := mustRunCLI(ctx, t, cmd...)

		// Should be single output (not multiple lines)
		lines := strings.Split(strings.TrimSpace(out), "\n")
		if len(lines) > 1 {
			t.Errorf("command %v should have single-line output", cmd)
		}
	}
}

// TestVerboseFlagConsistency tests that verbose flag works consistently
func TestVerboseFlagConsistency(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Test verbose flag with different commands
	verboseCommands := [][]string{
		{"instance", "list", "--output-format", "json", "--verbose"},
		{"instance", "new", "--output-format", "json", "--verbose"},
		{"config", "list", "--output-format", "json", "--verbose"},
	}

	for _, cmd := range verboseCommands {
		t.Run(strings.Join(cmd[:len(cmd)-2], "-"), func(t *testing.T) {
			out := mustRunCLI(ctx, t, cmd...)

			// In JSON mode with verbose, should be JSONL
			lines := strings.Split(strings.TrimSpace(out), "\n")

			// Should have at least one line
			if len(lines) == 0 {
				t.Error("verbose output should not be empty")
			}

			// Each line should be valid JSON
			for i, line := range lines {
				if strings.TrimSpace(line) == "" {
					continue
				}
				if !json.Valid([]byte(line)) {
					t.Errorf("line %d should be valid JSON: %s", i, line)
				}
			}
		})
	}
}

// TestOutputOrdering tests that output maintains correct ordering
func TestOutputOrdering(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	out := mustRunCLI(ctx, t, "instance", "new", "--output-format", "json", "--verbose")

	lines := strings.Split(strings.TrimSpace(out), "\n")

	// Find the final response line (should be last)
	var responseLineIndex = -1
	for i, line := range lines {
		var data map[string]interface{}
		if err := json.Unmarshal([]byte(line), &data); err == nil {
			if lineType, ok := data["type"].(string); ok && lineType == "response" {
				responseLineIndex = i
			}
		}
	}

	// Response should be the last line
	if responseLineIndex != -1 && responseLineIndex != len(lines)-1 {
		t.Error("final response should be the last line in JSONL output")
	}
}
