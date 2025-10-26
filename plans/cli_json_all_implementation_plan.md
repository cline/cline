# Implementation Plan: Complete JSON Output Support for Cline CLI

## [Overview]

Enable complete JSON output support across all Cline CLI commands when the
global `--output-format json` flag is set. Currently, JSON output is only
partially implemented for conversation messages in task streaming. This
implementation will ensure 100% of CLI output can be formatted as valid JSON,
making the CLI fully scriptable and integration-friendly.

The scope includes all batch commands (task, instance, config,
version, logs). Interactive commands (auth, task chat) will gracefully error
with **plain text error messages** (not JSON) when `--output-format json` is
used, since interactive commands cannot meaningfully output JSON output. All
existing "rich" and "plain" output formats will remain completely unchanged.

## [Principles]

The JSON output implementation follows these core principles:

### 1. Universal JSONL Format
**All commands output JSONL (JSON Lines) format** when `--output-format json` is
specified - both streaming and non-streaming commands. Each line is a complete,
independently-parseable JSON object.

**For non-streaming commands:**
- Multiple lines only when verbose mode is enabled
- Debug messages: `{"type":"debug","message":"..."}`
- Final result: `{"status":"success","command":"...","data":{...}}`

**For streaming commands:**
- Status messages: `{"type":"status","message":"...", "data":{...}}`
- Content messages: `{"type":"content","content":"..."}`
- Final result: `{"status":"success","command":"...","data":{...}}`

### 2. Verbose Mode Composition
**All commands that support `--verbose` compose with JSON output.** Verbose
output is never suppressed in JSON mode - it's converted to structured JSONL
debug messages.

Example:
```bash
$ cline instance new -v -F json
{"message":"Starting new Cline instance...","type":"debug"}
{"message":"Starting cline-host on port 58953","type":"debug"}
...21 debug messages...
{"command":"instance new","data":{...},"status":"success"}
```

### 3. Zero Plan/Rich Text Output In JSON Mode
**Only valid JSON in JSON mode.** No plain text, no headers, no status messages
as text. Everything must be structured JSON. This enables reliable parsing and
scripting.

### 4. Interactive Command Rejection
**Interactive commands reject JSON mode with plain text errors** (not JSON),
because:
- They require TTY/terminal interaction
- JSON output would be meaningless for interactive workflows
- Users need clear, readable error messages

Commands that reject JSON:
- `cline auth`
- `cline task chat`

### 5. Never Suppress Information
**Convert ALL informational messages to JSON - never suppress them.** Users
expect the same information in all output modes.

❌ **Wrong - Suppresses output:**
```go
if global.Config.OutputFormat != "json" {
    fmt.Printf("Using instance: %s\n", instanceAddress)
}
```

✅ **Correct - Converts to JSON:**
```go
if global.Config.OutputFormat == "json" {
    output.OutputStatusMessage("status", "Using instance", 
        map[string]interface{}{"instance": instanceAddress})
} else {
    fmt.Printf("Using instance: %s\n", instanceAddress)
}
```

### 6. Immediate Output (Not Buffered)
**Status, debug, and verbose messages output immediately** as JSONL lines as
they occur. This enables real-time monitoring and progress tracking.

### 7. Backward Compatibility & Output Preservation
**Rich and plain output formats remain completely unchanged from the merge base.** JSON is an additive feature - existing workflows continue to work exactly as before.

**Critical Requirement:**
- All existing plain text output (`fmt.Printf`, `fmt.Println`) must remain **byte-for-byte identical** to what existed at the merge base of this branch
- All existing rich format output (markdown, colors, tables) must remain **identical** to the merge base
- NO modifications to existing output statements except to ADD new JSON branches
- When adding JSON support, use `if/else` pattern that preserves original output in the else block

**Implementation Pattern:**
```go
// ✅ CORRECT - Preserves original output exactly
if global.Config.JsonFormat() {
    // NEW: JSON output
    output.OutputJSONSuccess(...)
} else {
    // PRESERVED: Original plain/rich output - DO NOT MODIFY
    fmt.Printf("Successfully completed operation\n")
}

// ❌ WRONG - Modifies or removes original output
if global.Config.JsonFormat() {
    output.OutputJSONSuccess(...)
}
// Original output removed or modified - BREAKS BACKWARD COMPATIBILITY
```

**Verification:**
- Run `git diff <merge-base>..HEAD` to verify no changes to existing plain/rich output
- All changes should be ADDITIONS of new JSON branches only
- Original output statements should remain unchanged in the else blocks

### 8. Consistent Structure
**All JSON responses follow a standard format:**
```json
{
  "status": "success|error",
  "command": "command-name",
  "data": { ... },
  "error": "error message (if status=error)"
}
```

**Related Abstractions:**
- `verboseLog()` and `verboseLogf()` helper functions in `cli/pkg/cli/global/cline-clients.go` for verbose output
- `OutputStatusMessage()`, `OutputJSONSuccess()`, `OutputJSONError()` in `cli/pkg/cli/output/json.go` for structured output

### 10. Pragmatic Output Abstraction ✅
**Format Detection Helpers** (Recommended for Safety):
Use helper methods on `GlobalConfig` to prevent typos in format string comparisons:

```go
// In cli/pkg/cli/global/global.go

// JsonFormat returns true if output format is set to JSON
func (cfg *GlobalConfig) JsonFormat() bool {
    if cfg.OutputFormat == "" {
        return false // Default is rich
    }
    return cfg.OutputFormat == "json"
}

// PlainFormat returns true if output format is set to plain
func (cfg *GlobalConfig) PlainFormat() bool {
    if cfg.OutputFormat == "" {
        return false // Default is rich
    }
    return cfg.OutputFormat == "plain"
}

// RichFormat returns true if output format is set to rich (or default)
func (cfg *GlobalConfig) RichFormat() bool {
    return cfg.OutputFormat == "" || cfg.OutputFormat == "rich"
}
```

**Usage:**
```go
// ❌ WRONG - Prone to typos
if global.Config.OutputFormat == "json" {  // Could typo "json" as "jsn"
    output.OutputJSONSuccess(...)
}

// ✅ CORRECT - Type-safe, prevents typos
if global.Config.JsonFormat() {
    output.OutputJSONSuccess(...)
}
```

**Note:** These are instance methods on the `GlobalConfig` struct, similar to the `global.Config.Verbose` pattern. Rich format is the default when OutputFormat is empty string.

**Error Output in JSON:**

All errors must be output as JSON when in JSON mode:

```json
{
  "type": "error",
  "message": "Failed to connect to instance",
  "data": {
    "address": "localhost:5678",
    "error": "connection refused",
    "attemptCount": 3
  }
}
```

## [Testing]

### TDD Approach

This implementation follows strict Test-Driven Development:

1. **Write comprehensive tests FIRST** that call the `cline` CLI binary via
   shell
2. **Run tests** and observe failures (no JSON support yet)
3. **Implement minimal code** to make specific tests pass
4. **Refactor** while keeping tests green
5. **Repeat** for each command until all tests pass

### Test Categories

1. **JSON Validity Tests** - Every command output is valid JSON
2. **Structure Tests** - Required fields present (status, command, data)
3. **Data Completeness Tests** - All expected data fields are present
4. **Regression Tests** - Rich/plain outputs unchanged
5. **No Leakage Tests** - No text outside JSON in JSON mode
6. **Compose with Verbose Tests** - JSON mode works with --verbose flag
7. **Error Handling Tests** - Errors formatted as JSON

## [Command Coverage Matrix]

### Comprehensive Test Matrix for All Output Formats

Testing must validate ALL three output formats (JSON, plain, rich) across ALL command types to ensure the universal output abstraction doesn't break existing functionality.

#### Test Dimensions

Every command must be tested across these dimensions:
1. **Output Format**: JSON, Plain, Rich
2. **Command Type**: Batch, Interactive, Streaming
3. **Execution State**: Success, Error
4. **Verbosity**: Normal, Verbose (--verbose flag)


**Test Execution:**
```bash
# Run all tests
go test ./e2e/... -v

# Run format-specific tests
go test ./e2e -run TestJSON -v        # All JSON tests
go test ./e2e -run TestPlain -v       # All plain tests
go test ./e2e -run TestRich -v        # All rich tests

# Run command-type tests
go test ./e2e -run Batch -v           # Batch command tests
go test ./e2e -run Streaming -v       # Streaming tests
go test ./e2e -run Interactive -v     # Interactive tests

# Run output-type tests  
go test ./e2e -run Verbose -v         # Verbose output tests
go test ./e2e -run Error -v           # Error output tests
```

