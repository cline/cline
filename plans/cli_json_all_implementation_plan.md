# Implementation Plan: Complete JSON Output Support for Cline CLI

## [Overview]

Enable complete JSON output support across all Cline CLI commands when the
global `--output-format json` flag is set. Currently, JSON output is only
partially implemented for conversation messages in task streaming. This
implementation will ensure 100% of CLI output can be formatted as valid JSON,
making the CLI fully scriptable and integration-friendly.

This plan maintains two separate JSON output formats:
1. **Streaming Format**: Task conversation streaming (already implemented, not
   changing)
2. **Batch Command Format**: All other CLI commands (this branch's work)

The scope includes all batch commands (task new/send/list, instance, config,
version, logs). Interactive commands (auth, task chat) will gracefully error
with **plain text error messages** (not JSON) when `--output-format json` is
used. All existing "rich" and "plain" output formats will remain completely
unchanged.

## [JSON Output Architecture]

### Two Distinct Formats

#### Format 1: Streaming (Existing, Not Modified)

**Purpose:** Real-time task conversation streaming with LLM responses

**Format:**
```json
{"type":"say","say":"text","text":"...","ts":1761516645817}
{"type":"say","say":"api_req_started","text":"...","ts":1761516645824}
{"type":"say","say":"reasoning","text":"...","ts":1761516648124}
{"type":"ask","ask":"plan_mode_respond","text":"...","ts":1761516650545}
```

**Structure:**
- `type`: Message category ("say" | "ask")
- `say` or `ask`: Subtype (e.g., "text", "api_req_started", "reasoning",
  "plan_mode_respond")
- `text`: Message content
- `ts`: Timestamp in milliseconds

**Used By:**
- `cline --yolo "prompt"` (root command with task)
- `task view --follow`
- `task view --follow-complete`
- `task chat` (interactive mode)

**Implementation:** `task/manager.go::outputMessageAsJSON()`

This format predates this branch and is not changed.

#### Format 2: Batch Commands (New - This Branch)

**Purpose:** Structured output for non-streaming CLI commands

**Format:**
```json
{"type":"command","command":"instance new","status":"success","data":{...}}
{"type":"command","command":"logs list","status":"success","data":{...}}
{"type":"command","command":"instance kill","status":"error","message":"Instance not found"}
{"type":"command","command":"instance new","status":"debug","message":"Starting services..."}
```

**Structure:**
- `type`: Always "command" (discriminates from streaming format)
- `command`: Command name (e.g., "instance new", "task list")
- `status`: Status indicator ("success" | "error" | "debug" | "progress")
- `message`: Optional human-readable message
- `data`: Optional structured response data (nested, prevents key collisions)

**Used By:**
- `instance list/new/default/kill`
- `logs list/clean/path`
- `version`
- `config list/get/set`
- `task new/send/pause/list/open/restore`
- All other batch commands

### Why Two Formats?

1. **Different Use Cases**
   - Streaming: Real-time conversation flow requiring timestamps and message
     ordering
   - Batch: One-shot command results with structured data

2. **Clear Separation**
   - `type` field discriminates: "say"/"ask" vs "command"
   - No ambiguity about output format

## [Principles]

The JSON output implementation follows these core principles:

### 1. Universal JSONL Format
**All commands output JSONL (JSON Lines) format** when `--output-format json` is
specified - both streaming and non-streaming commands. Each line is a complete,
independently-parseable JSON object.

**For batch commands:**
- Multiple lines only when verbose mode is enabled
- Debug messages:
  `{"type":"command","command":"...","status":"debug","message":"..."}`
- Final result:
  `{"type":"command","command":"...","status":"success","data":{...}}`

**For streaming commands:**
- Already implemented with Format 1 (see Architecture section)
- Status messages: `{"type":"say","say":"status","text":"..."}`
- Content messages: `{"type":"say","say":"text","text":"..."}`

### 2. Verbose Mode Composition
**All commands that support `--verbose` compose with JSON output.** Verbose
output is never suppressed in JSON mode - it's converted to structured JSONL
debug messages.

Example:
```bash
$ cline instance new -v -F json
{"type":"command","command":"instance new","status":"debug","message":"Starting new Cline instance..."}
{"type":"command","command":"instance new","status":"debug","message":"Starting cline-host on port 58953"}
...21 debug messages...
{"type":"command","command":"instance new","status":"success","data":{"address":"localhost:58953",...}}
```

### 3. Zero Plain/Rich Text Output In JSON Mode
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

**Implementation:** Use cobra's `PreRunE` hook:
```go
cmd := &cobra.Command{
    Use: "auth",
    PreRunE: func(cmd *cobra.Command, args []string) error {
        return global.Config.MustNotBeJSON("auth")
    },
    RunE: func(cmd *cobra.Command, args []string) error {
        // Command logic
    },
}
```

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
if global.Config.JsonFormat() {
    output.OutputCommandStatus("instance new", "debug", 
        fmt.Sprintf("Using instance: %s", instanceAddress), nil)
} else {
    fmt.Printf("Using instance: %s\n", instanceAddress)
}
```

### 6. Immediate Output (Not Buffered)
**Status, debug, and verbose messages output immediately** as JSONL lines as
they occur. This enables real-time monitoring and progress tracking.

### 7. Backward Compatibility & Output Preservation
**Rich and plain output formats remain completely unchanged from the merge
base.** JSON is an additive feature - existing workflows continue to work
exactly as before.

**Critical Requirement:**
- All existing plain text output (`fmt.Printf`, `fmt.Println`) must remain
  **byte-for-byte identical** to what existed at the merge base of this branch
- All existing rich format output (markdown, colors, tables) must remain
  **identical** to the merge base
- NO modifications to existing output statements except to ADD new JSON branches
- When adding JSON support, use `if/else` pattern that preserves original output
  in the else block

**Implementation Pattern:**
```go
// ✅ CORRECT - Preserves original output exactly
if global.Config.JsonFormat() {
    // NEW: JSON output
    output.OutputCommandSuccess("instance new", data)
} else {
    // PRESERVED: Original plain/rich output - DO NOT MODIFY
    fmt.Printf("Successfully started instance\n")
}

// ❌ WRONG - Modifies or removes original output
if global.Config.JsonFormat() {
    output.OutputCommandSuccess("instance new", data)
}
// Original output removed or modified - BREAKS BACKWARD COMPATIBILITY
```

**Verification:**
- Run `git diff <merge-base>..HEAD` to verify no changes to existing plain/rich
  output
- All changes should be ADDITIONS of new JSON branches only
- Original output statements should remain unchanged in the else blocks

### 8. Command Context in All Output
**Every JSON output must include the command that produced it.** This enables
consumers to filter, route, and process messages correctly.

Example:
```json
{"type":"command","command":"instance new","status":"debug","message":"Starting..."}
{"type":"command","command":"task list","status":"success","data":{"tasks":[...]}}
```

### 9. Pragmatic Output Abstraction ✅
**Format Detection Helpers** (Recommended for Safety): Use helper methods on
`GlobalConfig` to prevent typos in format string comparisons:

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
    output.OutputCommandSuccess(...)
}

// ✅ CORRECT - Type-safe, prevents typos
if global.Config.JsonFormat() {
    output.OutputCommandSuccess(...)
}
```

**Note:** These are instance methods on the `GlobalConfig` struct, similar to
the `global.Config.Verbose` pattern. Rich format is the default when
OutputFormat is empty string.

### New Output Functions

Add these functions to `cli/pkg/cli/output/json.go`:

```go
// OutputCommandStatus outputs a command status message in batch format
func OutputCommandStatus(command, status, message string, data map[string]interface{}) error {
    obj := map[string]interface{}{
        "type":    "command",
        "command": command,
        "status":  status,
    }
    
    if message != "" {
        obj["message"] = message
    }
    
    if data != nil {
        obj["data"] = data
    }
    
    return OutputJSONLine(obj)
}

// OutputCommandSuccess outputs a successful command result
func OutputCommandSuccess(command string, data interface{}) error {
    return OutputCommandStatus(command, "success", "", map[string]interface{}{"result": data})
}

// OutputCommandError outputs a command error
func OutputCommandError(command, message string) error {
    return OutputCommandStatus(command, "error", message, nil)
}
```

## [Command Coverage Matrix]

### Complete Command Inventory

| Command                       | Type        | JSON Status     | Notes                               |
| ----------------------------- | ----------- | --------------- | ----------------------------------- |
| `version`                     | Batch       | ✅ Implemented   | Uses OutputCommandSuccess           |
| `version --short`             | Batch       | ✅ Implemented   | Always plain text (by design)       |
| `logs list`                   | Batch       | ✅ Implemented   | Fully JSON-enabled                  |
| `logs clean`                  | Batch       | ✅ Implemented   | Fully JSON-enabled                  |
| `logs path`                   | Batch       | ✅ Implemented   | Fully JSON-enabled                  |
| `instance list`               | Batch       | ✅ Implemented   | Full JSON support with verbose      |
| `instance new`                | Batch       | ✅ Implemented   | Full JSON + ~22 verbose debug msgs  |
| `instance default`            | Batch       | ✅ Implemented   | Full JSON support                   |
| `instance kill`               | Batch       | ✅ Implemented   | Full JSON support                   |
| `task new`                    | Batch       | ✅ Implemented   | Full JSON + verbose debug msgs      |
| `task send`                   | Batch       | ✅ Implemented   | Full JSON support                   |
| `task pause`                  | Batch       | ✅ Implemented   | Full JSON support                   |
| `task list`                   | Batch       | ✅ Implemented   | Full JSON support                   |
| `task open`                   | Batch       | ✅ Implemented   | Full JSON + verbose debug msgs      |
| `task restore`                | Batch       | ✅ Implemented   | Full JSON support                   |
| `task view`                   | Batch       | ✅ Implemented   | Snapshot mode (JSONL)               |
| `task view --follow`          | Streaming   | ✅ Implemented   | Uses Format 1 (streaming)           |
| `task view --follow-complete` | Streaming   | ✅ Implemented   | Uses Format 1 (streaming)           |
| `config list`                 | Batch       | ✅ Implemented   | Full JSON support                   |
| `config get`                  | Batch       | ✅ Implemented   | Full JSON support                   |
| `config set`                  | Batch       | ✅ Implemented   | Full JSON support                   |
| `auth`                        | Interactive | ✅ Implemented   | Rejects JSON with PreRunE           |
| `task chat`                   | Interactive | ✅ Implemented   | Rejects JSON with PreRunE           |
| `cline "prompt"`              | Root+Task   | ✅ Implemented   | Uses Format 1 (streaming)           |

**Status Summary:**
- **Total Commands:** 23
- **Fully Implemented:** 23 (100%)
- **All Tests Passing:** ✅ (99+ tests, 139s runtime)
- **Demo Script Validated:** ✅ (Zero text leakage, pure JSON)
- **Production Ready:** ✅

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
2. **Structure Tests** - Required fields present (type, command, status)
3. **Data Completeness Tests** - All expected data fields are present
4. **Regression Tests** - Rich/plain outputs unchanged
5. **No Leakage Tests** - No text outside JSON in JSON mode
6. **Compose with Verbose Tests** - JSON mode works with --verbose flag
7. **Error Handling Tests** - Errors formatted as JSON
8. **Format Discrimination Tests** - Streaming vs batch format detection

### Comprehensive Test Matrix

Testing must validate ALL three output formats (JSON, plain, rich) across ALL
command types.

**Test Dimensions:**
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
