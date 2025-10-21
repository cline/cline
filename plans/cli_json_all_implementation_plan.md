# Implementation Plan: Complete JSON Output Support for Cline CLI

## [Overview]

Enable complete JSON output support across all Cline CLI commands when the
global `--output-format json` flag is set. Currently, JSON output is only
partially implemented for conversation messages in task streaming. This
implementation will ensure 100% of CLI output can be formatted as valid JSON,
making the CLI fully scriptable and integration-friendly.

The scope includes all non-interactive commands (task, instance, config,
version, logs). Interactive commands (auth) will gracefully error when JSON mode
is used. All existing "rich" and "plain" output formats will remain completely
unchanged.

Key principles:
- Test-driven development: Write comprehensive e2e tests first that call the
  CLI via the shell; this is the only way to ensure that the tests are recording
  accurate resuts
- Backward compatibility: No changes to existing rich/plain outputs
- Consistent structure: Standard JSON response format across all commands
- No output leakage: Only valid JSON in JSON mode (no stray text)
- Compose with Verbose: Verbose output will still be shown in JSON mode; it will
  show as JSON
- Graceful degradation: Clear errors for incompatible operations

## [Types]

Define standard JSON output structures for CLI responses.

### JSON Structure

Structure format:

``json
{
  "status": "success|error",
  "command": "command-name",
  "data": { ... },
  "error": "error message (if status=error)",
}
```

Example structure:
```json
{
  "status": "success",
  "command": "instance kill",
  "data": {
    "killedCount": 1,
    "addresses": ["localhost:5678"]
  },
}
```

### Command-Specific Data Structures
Each command will get it's own data structure appropriate to it's data.

## [Files]

Files to be created and modified for JSON output support.

### New Files

**cli/pkg/cli/output/json.go**
- Purpose: JSON output helper functions
- Provides `FormatJSONResponse()` function
- Provides `OutputJSON()` function for printing
- Handles timestamp generation and JSON marshaling
- Error wrapping for JSON output

**cli/pkg/cli/output/json_test.go**
- Purpose: Unit tests for JSON helper functions
- Tests JSON response structure
- Tests error handling
- Tests timestamp formatting
- Tests data marshaling edge cases

**cli/e2e/json_output_test.go**
- Purpose: End-to-end tests for JSON output across all commands
- Tests each command with --output-format json
- Validates JSON structure and parseability
- Ensures no stray text output
- Regression tests for rich/plain formats

**cli/scripts/validate_json_output.sh**
- Purpose: Shell script to validate JSON output
- Tests each command's JSON output with jq
- Verifies required fields exist
- Can be run manually or in CI/CD

### Modified Files

**cli/pkg/cli/version.go**
- Add JSON output support to version command
- Preserve existing rich/plain output

**cli/pkg/cli/instances.go**
- Add JSON output for instance list command
- Add JSON output for instance new command
- Add JSON output for instance kill command
- Preserve existing rich/plain output with markdown tables

**cli/pkg/cli/config.go**
- Add JSON output for config list command
- Add JSON output for config get command
- Add JSON output for config set command
- Preserve existing rich/plain output

**cli/pkg/cli/logs.go**
- Add JSON output for logs list command
- Add JSON output for logs path command
- Preserve existing rich/plain output

**cli/pkg/cli/task.go**
- Add JSON output for task new command
- Add JSON output for task pause command
- Add JSON output for task send command
- Note: task view/chat already have JSON streaming support in manager.go

**cli/cmd/cline/main.go**
- Add JSON error output for root command failures
- Ensure graceful handling of interactive mode + JSON flag

**cli/pkg/cli/auth.go** (or auth/auth_menu.go)
- Add validation to reject --output-format json with error message
- Auth is interactive-only, cannot work with JSON output

## [Functions]

Functions to be created and modified.

### New Functions

**cli/pkg/cli/output/json.go:**
```go
// FormatJSONResponse creates a JSON response
func FormatJSONResponse(status, command string, data interface{}, errMsg string) (string, error)

// OutputJSON prints a JSON response to stdout
func OutputJSON(status, command string, data interface{}, errMsg string) error

// OutputJSONSuccess outputs a successful JSON response
func OutputJSONSuccess(command string, data interface{}) error

// OutputJSONError outputs an error JSON response
func OutputJSONError(command string, err error) error

// OutputJSONStatus outputs a status/progress message in JSON format
func OutputJSONStatus(command, message string) error

// WrapError wraps an error in a JSON response
func WrapError(command string, err error) error
```

### Modified Functions

**cli/pkg/cli/version.go:**
```go
// Modify RunE function to check global.Config.OutputFormat
// If "json", call output.OutputJSON() with VersionData
// Otherwise, use existing fmt.Printf() logic
```

**cli/pkg/cli/instances.go:**
```go
// newInstanceListCommand: Modify RunE to support JSON output
// renderLogsTable: Extract data, format as JSON if needed
// newInstanceNewCommand: Add JSON response for instance creation
// killAllCLIInstances: Add JSON summary output
```

**cli/pkg/cli/config.go:**
```go
// (Manager).ListSettings: Check OutputFormat, output JSON if needed
// (Manager).GetSetting: Check OutputFormat, output JSON if needed
// (Manager).UpdateSettings: Add JSON success response
```

**cli/pkg/cli/logs.go:**
```go
// newLogsListCommand: Add JSON output support
// newLogsPathCommand: Add JSON output (simple string wrapper)
// newLogsCleanCommand: Add JSON summary for deleted files
// renderLogsTable: Extract data structure for JSON output
```

**cli/pkg/cli/task.go:**
```go
// CreateTask: Add JSON response with task ID
// SendMessage: Add JSON success response
// CancelTask: Add JSON success response
// Note: Streaming already handled in task/manager.go
```

## [Classes]

No new classes needed. The existing Manager structs (task.Manager,
config.Manager) remain unchanged in structure, only their methods are enhanced
to support JSON output.

## [Dependencies]

No new external dependencies required. All JSON handling uses Go's standard
library `encoding/json` package which is already used throughout the codebase.

## [Testing]

Comprehensive testing strategy to ensure correctness and prevent regressions.

### Integration Tests

**cli/e2e/json_output_test.go:**

Test categories:
1. **JSON Validity Tests** - Every command output is valid JSON
2. **Structure Tests** - Required fields present (status, command, data)
3. **Regression Tests** - Rich/plain outputs unchanged
4. **No Leakage Tests** - No text outside JSON in JSON mode
5. **Compose with Verbose Tests** - when JSON mode and verbose mode are used
   together, the verbose output is present in JSON format
6. **Error Handling Tests** - Errors formatted as JSON


### Manual Testing Checklist

Create `cli/TESTING.md` with manual test procedures:
```markdown
# JSON Output Testing Checklist

## Version Command
- [ ] `cline version --output-format json | jq`
- [ ] Verify all fields present
- [ ] `cline version` (rich) - unchanged
- [ ] `cline version --output-format plain` - unchanged

## Instance Commands
- [ ] `cline instance list --output-format json | jq`
- [ ] Verify all fields present
- [ ] Rich/plain formats unchanged
```

# Tasks
1. Ensure there are e2e tests calling the CLI directly for plain, rich and JSON
   format
2. Ensure that all of the plan and rich tests pass
3. For JSON tests that are failing, impement the JSON formatting as required
4. Repeat #3 until all JSON outputting is successful