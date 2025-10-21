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
- Test-driven development: Write comprehensive e2e tests first that call the CLI
  via the shell; this is the only way to ensure that the tests are recording
  accurate results
- Backward compatibility: No changes to existing rich/plain outputs
- Consistent structure: Standard JSON response format across all commands
- No output leakage: Only valid JSON in JSON mode (no stray text)
- Compose with Verbose: Verbose output will still be shown in JSON mode; it will
  show as JSON
- Graceful degradation: Clear errors for incompatible operations

## [Types]

Define standard JSON output structures for CLI responses.

### JSON Response Structure

All JSON responses follow this format:
```json
{
  "status": "success|error",
  "command": "command-name",
  "data": { ... },
  "error": "error message (if status=error)"
}
```

### Command-Specific Data Structures

**Version Command (`cline version --output-format json`):**
```json
{
  "status": "success",
  "command": "version",
  "data": {
    "cliVersion": "1.2.3",
    "coreVersion": "1.2.3",
    "commit": "abc123",
    "date": "2024-01-01",
    "builtBy": "github-actions",
    "goVersion": "go1.21.0",
    "os": "darwin",
    "arch": "arm64"
  }
}
```

**Instance List Command (`cline instance list --output-format json`):**
```json
{
  "status": "success",
  "command": "instance list",
  "data": {
    "defaultInstance": "localhost:5678",
    "instances": [
      {
        "address": "localhost:5678",
        "status": "SERVING",
        "version": "1.2.3",
        "lastSeen": "2024-01-01T12:00:00Z",
        "pid": 12345,
        "platform": "CLI",
        "isDefault": true
      }
    ]
  }
}
```

**Instance New Command (`cline instance new --output-format json`):**
```json
{
  "status": "success",
  "command": "instance new",
  "data": {
    "address": "localhost:5678",
    "corePort": 5678,
    "hostPort": 5679,
    "isDefault": true
  }
}
```

**Instance Kill Command (`cline instance kill <address> --output-format
json`):**
```json
{
  "status": "success",
  "command": "instance kill",
  "data": {
    "killedCount": 1,
    "addresses": ["localhost:5678"]
  }
}
```

**Config List Command (`cline config list --output-format json`):**
```json
{
  "status": "success",
  "command": "config list",
  "data": {
    "settings": {
      "apiConfiguration": { ... },
      "mode": "plan",
      "yoloModeToggled": false
    }
  }
}
```

**Config Get Command (`cline config get mode --output-format json`):**
```json
{
  "status": "success",
  "command": "config get",
  "data": {
    "key": "mode",
    "value": "plan"
  }
}
```

**Config Set Command (`cline config set mode=act --output-format json`):**
```json
{
  "status": "success",
  "command": "config set",
  "data": {
    "updated": ["mode"],
    "instance": "localhost:5678"
  }
}
```

**Logs List Command (`cline logs list --output-format json`):**
```json
{
  "status": "success",
  "command": "logs list",
  "data": {
    "logsDir": "/Users/user/.cline/logs",
    "logs": [
      {
        "filename": "cline-core-2024-01-01-12-00-00-localhost-5678.log",
        "size": 1024,
        "sizeFormatted": "1.0 KB",
        "created": "2024-01-01T12:00:00Z",
        "age": "2h ago"
      }
    ]
  }
}
```

**Logs Path Command (`cline logs path --output-format json`):**
```json
{
  "status": "success",
  "command": "logs path",
  "data": {
    "path": "/Users/user/.cline/logs"
  }
}
```

**Logs Clean Command (`cline logs clean --dry-run --output-format json`):**
```json
{
  "status": "success",
  "command": "logs clean",
  "data": {
    "deletedCount": 5,
    "bytesFreed": 5242880,
    "formattedSize": "5.0 MB",
    "dryRun": true
  }
}
```

**Task New Command (`cline task new "prompt" --output-format json`):**
```json
{
  "status": "success",
  "command": "task new",
  "data": {
    "taskId": "task-123",
    "instance": "localhost:5678"
  }
}
```

**Task Send Command (`cline task send "message" --output-format json`):**
```json
{
  "status": "success",
  "command": "task send",
  "data": {
    "sent": true,
    "instance": "localhost:5678"
  }
}
```

**Task Pause Command (`cline task pause --output-format json`):**
```json
{
  "status": "success",
  "command": "task pause",
  "data": {
    "cancelled": true,
    "instance": "localhost:5678"
  }
}
```

**Error Response (any command):**
```json
{
  "status": "error",
  "command": "instance kill",
  "error": "instance localhost:5678 not found"
}
```

## [Files]

Files to be created and modified for JSON output support.

### New Files

**cli/pkg/cli/output/json.go**
- Purpose: JSON output helper functions
- Provides `FormatJSONResponse()` function to create JSON response structures
- Provides `OutputJSON()` function for printing JSON to stdout
- Provides `OutputJSONSuccess()` convenience function for success responses
- Provides `OutputJSONError()` convenience function for error responses
- Handles proper JSON marshaling with indentation
- Type definitions for JSONResponse structure

**cli/pkg/cli/output/json_test.go**
- Purpose: Unit tests for JSON helper functions
- Tests JSON response structure formatting
- Tests error handling
- Tests data marshaling edge cases
- Tests pretty-printing vs compact output

**cli/e2e/json_output_test.go**
- Purpose: End-to-end tests for JSON output across all commands
- Tests each command with --output-format json
- Validates JSON structure and parseability using encoding/json
- Ensures no stray text output (only valid JSON)
- Regression tests to ensure rich/plain formats still work
- Tests error responses in JSON format

### Modified Files

**cli/pkg/cli/version.go**
- Modify `RunE` function to check `global.Config.OutputFormat`
- If "json", call `output.OutputJSONSuccess()` with version data structure
- Otherwise, use existing `fmt.Printf()` logic for rich/plain output
- Preserve existing `--short` flag behavior

**cli/pkg/cli/instances.go**
- Modify `newInstanceListCommand` RunE to support JSON output
  - Extract instance data into structured format before rendering
  - Call `output.OutputJSONSuccess()` with instances array if JSON mode
  - Keep existing markdown table rendering for rich mode
- Modify `newInstanceNewCommand` RunE to add JSON response
  - Return structured data about new instance (address, ports, isDefault)
- Modify `killAllCLIInstances` to add JSON summary output
  - Return counts of killed, skipped, failed instances
- Modify `newInstanceKillCommand` RunE to support JSON output
  - Return structured result with killed addresses

**cli/pkg/cli/config.go**
- Add imports for output package
- Commands delegate to config.Manager which handles the actual JSON output

**cli/pkg/cli/config/manager.go**
- Modify `ListSettings()` to check `global.Config.OutputFormat`
  - If "json", marshal state data and call `output.OutputJSONSuccess()`
  - Otherwise, use existing `RenderField()` logic
- Modify `GetSetting()` to check `global.Config.OutputFormat`
  - If "json", output key-value pair in JSON format
  - Otherwise, use existing rendering logic
- Modify `UpdateSettings()` to add JSON success response
  - Return list of updated keys and instance address

**cli/pkg/cli/logs.go**
- Modify `newLogsListCommand` RunE to support JSON output
  - Extract log file data before rendering
  - Call `output.OutputJSONSuccess()` if JSON mode
  - Keep existing markdown table for rich mode
- Modify `newLogsPathCommand` RunE to support JSON output
  - Wrap path string in JSON structure
- Modify `newLogsCleanCommand` RunE to support JSON output
  - Return structured summary of deletion operation
- Modify `renderLogsTable` to extract data structure
  - Return structured log data for JSON output
  - Keep existing table rendering for rich/plain

**cli/pkg/cli/task.go**
- Modify `newTaskNewCommand` RunE to add JSON response
  - Return task ID and instance address in JSON structure
  - Note: Streaming conversation output already handled by task.Manager
- Modify `newTaskSendCommand` RunE to add JSON success response
  - Return confirmation and instance address
- Modify `newTaskPauseCommand` RunE to add JSON success response
  - Return confirmation and instance address
- Note: `task view` and `task chat` already have JSON streaming support in
  task/manager.go

**cli/cmd/cline/main.go**
- Modify root command `RunE` to wrap errors in JSON format when `--output-format
  json` is set
- Add JSON error output for validation failures (e.g., invalid output format)
- Ensure graceful handling of interactive mode + JSON flag combination

**cli/pkg/cli/auth.go**
- Add validation in `NewAuthCommand` to reject `--output-format json` with clear
  error
- Auth is interactive-only, cannot work with JSON output
- Return helpful error message suggesting to use interactive mode

## [Functions]

Functions to be created and modified.

### New Functions

**cli/pkg/cli/output/json.go:**
```go
// JSONResponse represents a standard CLI JSON response
type JSONResponse struct {
    Status  string      `json:"status"`  // "success" or "error"
    Command string      `json:"command"` // e.g., "instance list"
    Data    interface{} `json:"data,omitempty"`
    Error   string      `json:"error,omitempty"`
}

// FormatJSONResponse creates a JSON response string
func FormatJSONResponse(status, command string, data interface{}, errMsg string) (string, error)

// OutputJSON prints a JSON response to stdout
func OutputJSON(status, command string, data interface{}, errMsg string) error

// OutputJSONSuccess outputs a successful JSON response
func OutputJSONSuccess(command string, data interface{}) error

// OutputJSONError outputs an error JSON response
func OutputJSONError(command string, err error) error

// IsJSONMode returns true if global output format is set to JSON
func IsJSONMode() bool
```

### Modified Functions

**cli/pkg/cli/version.go:**
```go
// In NewVersionCommand, modify RunE function:
RunE: func(cmd *cobra.Command, args []string) error {
    if short {
        // For --short flag, just print version number (no JSON)
        fmt.Println(global.CliVersion)
        return nil
    }

    // Check for JSON output mode
    if global.Config.OutputFormat == "json" {
        data := map[string]string{
            "cliVersion":  global.CliVersion,
            "coreVersion": global.Version,
            "commit":      global.Commit,
            "date":        global.Date,
            "builtBy":     global.BuiltBy,
            "goVersion":   runtime.Version(),
            "os":          runtime.GOOS,
            "arch":        runtime.GOARCH,
        }
        return output.OutputJSONSuccess("version", data)
    }

    // Existing rich/plain output
    fmt.Printf("Cline CLI\n")
    // ... rest of existing code
    return nil
}
```

**cli/pkg/cli/instances.go:**
```go
// In newInstanceListCommand, modify RunE to extract data first:
RunE: func(cmd *cobra.Command, args []string) error {
    // ... existing instance loading code ...

    // Extract structured data
    type instanceData struct {
        Address   string `json:"address"`
        Status    string `json:"status"`
        Version   string `json:"version"`
        LastSeen  string `json:"lastSeen"`
        PID       string `json:"pid"`
        Platform  string `json:"platform"`
        IsDefault bool   `json:"isDefault"`
    }

    var rows []instanceData
    for _, instance := range instances {
        // ... existing data extraction ...
        rows = append(rows, instanceData{...})
    }

    // Check output format
    if global.Config.OutputFormat == "json" {
        data := map[string]interface{}{
            "defaultInstance": defaultInstance,
            "instances":       rows,
        }
        return output.OutputJSONSuccess("instance list", data)
    }

    // Existing rich/plain rendering
    if global.Config.OutputFormat == "plain" {
        // ... existing tabwriter code ...
    } else {
        // ... existing markdown table code ...
    }
    return nil
}

// In newInstanceNewCommand, add JSON output:
RunE: func(cmd *cobra.Command, args []string) error {
    // ... existing instance creation code ...

    if global.Config.OutputFormat == "json" {
        data := map[string]interface{}{
            "address":   instance.Address,
            "corePort":  instance.CorePort(),
            "hostPort":  instance.HostPort(),
            "isDefault": registry.GetDefaultInstance() == instance.Address,
        }
        return output.OutputJSONSuccess("instance new", data)
    }

    // Existing rich/plain output
    fmt.Printf("Successfully started new instance:\n")
    // ... rest of existing code
    return nil
}

// In killAllCLIInstances, add JSON output:
func killAllCLIInstances(ctx context.Context, registry *global.ClientRegistry) error {
    // ... existing kill logic ...

    if global.Config.OutputFormat == "json" {
        data := map[string]interface{}{
            "killedCount":      successful,
            "alreadyDeadCount": alreadyDead,
            "failedCount":      failed,
            "skippedCount":     skippedNonCLI,
            "addresses":        killedAddresses,
        }
        return output.OutputJSONSuccess("instance kill", data)
    }

    // Existing rich/plain summary
    fmt.Printf("\nSummary: ")
    // ... rest of existing code
    return nil
}
```

**cli/pkg/cli/config/manager.go:**
```go
// In ListSettings:
func (m *Manager) ListSettings(ctx context.Context) error {
    stateData, err := m.GetState(ctx)
    if err != nil {
        return err
    }

    if global.Config.OutputFormat == "json" {
        // Filter to settings fields
        settings := make(map[string]interface{})
        for _, field := range settingsFields {
            if value, ok := stateData[field]; ok {
                settings[field] = value
            }
        }
        data := map[string]interface{}{
            "settings": settings,
        }
        return output.OutputJSONSuccess("config list", data)
    }

    // Existing rich/plain rendering
    for _, field := range settingsFields {
        // ... existing RenderField code ...
    }
    return nil
}

// In GetSetting:
func (m *Manager) GetSetting(ctx context.Context, key string) error {
    // ... existing get value logic ...

    if global.Config.OutputFormat == "json" {
        data := map[string]interface{}{
            "key":   key,
            "value": value,
        }
        return output.OutputJSONSuccess("config get", data)
    }

    // Existing rich/plain rendering
    if len(parts) == 1 {
        return RenderField(rootField, value, false)
    } else {
        fmt.Printf("%s: %s\n", key, formatValue(value, rootField, true))
    }
    return nil
}

// In UpdateSettings:
func (m *Manager) UpdateSettings(ctx context.Context, settings *cline.Settings, secrets *cline.Secrets) error {
    // ... existing update logic ...

    if global.Config.OutputFormat == "json" {
        // Extract updated field names
        updated := extractUpdatedFields(settings, secrets)
        data := map[string]interface{}{
            "updated":  updated,
            "instance": m.clientAddress,
        }
        return output.OutputJSONSuccess("config set", data)
    }

    // Existing rich/plain output
    fmt.Println("Settings updated successfully")
    fmt.Printf("Instance: %s\n", m.clientAddress)
    return nil
}
```

**cli/pkg/cli/logs.go:**
```go
// In newLogsListCommand, modify RunE:
RunE: func(cmd *cobra.Command, args []string) error {
    logsDir := filepath.Join(global.Config.ConfigPath, "logs")
    logs, err := listLogFiles(logsDir)
    if err != nil {
        return fmt.Errorf("failed to list log files: %w", err)
    }

    if len(logs) == 0 {
        if global.Config.OutputFormat == "json" {
            data := map[string]interface{}{
                "logsDir": logsDir,
                "logs":    []interface{}{},
            }
            return output.OutputJSONSuccess("logs list", data)
        }
        fmt.Println("No log files found.")
        fmt.Printf("Log files will be created in: %s\n", logsDir)
        return nil
    }

    if global.Config.OutputFormat == "json" {
        type logData struct {
            Filename       string `json:"filename"`
            Size           int64  `json:"size"`
            SizeFormatted  string `json:"sizeFormatted"`
            Created        string `json:"created"`
            Age            string `json:"age"`
        }
        var jsonLogs []logData
        for _, log := range logs {
            jsonLogs = append(jsonLogs, logData{
                Filename:      log.name,
                Size:          log.size,
                SizeFormatted: formatFileSize(log.size),
                Created:       log.created.Format(time.RFC3339),
                Age:           formatAge(log.created),
            })
        }
        data := map[string]interface{}{
            "logsDir": logsDir,
            "logs":    jsonLogs,
        }
        return output.OutputJSONSuccess("logs list", data)
    }

    // Existing rich/plain rendering
    return renderLogsTable(logs, false)
}

// In newLogsPathCommand:
RunE: func(cmd *cobra.Command, args []string) error {
    logsDir := filepath.Join(global.Config.ConfigPath, "logs")

    if global.Config.OutputFormat == "json" {
        data := map[string]interface{}{
            "path": logsDir,
        }
        return output.OutputJSONSuccess("logs path", data)
    }

    fmt.Println(logsDir)
    return nil
}

// In newLogsCleanCommand:
RunE: func(cmd *cobra.Command, args []string) error {
    // ... existing deletion logic ...

    if global.Config.OutputFormat == "json" {
        data := map[string]interface{}{
            "deletedCount":   count,
            "bytesFreed":     bytesFreed,
            "formattedSize":  formatFileSize(bytesFreed),
            "dryRun":         dryRun,
        }
        return output.OutputJSONSuccess("logs clean", data)
    }

    // Existing rich/plain summary
    fmt.Printf("Deleted %d log %s (%s freed)\n", count, fileWord, formatFileSize(bytesFreed))
    return nil
}
```

**cli/pkg/cli/task.go:**
```go
// In newTaskNewCommand:
RunE: func(cmd *cobra.Command, args []string) error {
    // ... existing task creation logic ...

    taskID, err := taskManager.CreateTask(ctx, prompt, images, files, settings)
    if err != nil {
        return fmt.Errorf("failed to create task: %w", err)
    }

    if global.Config.OutputFormat == "json" {
        data := map[string]interface{}{
            "taskId":   taskID,
            "instance": taskManager.GetCurrentInstance(),
        }
        return output.OutputJSONSuccess("task new", data)
    }

    if global.Config.Verbose {
        fmt.Printf("Task created successfully with ID: %s\n", taskID)
    }
    return nil
}

// In newTaskSendCommand:
RunE: func(cmd *cobra.Command, args []string) error {
    // ... existing send logic ...

    if global.Config.OutputFormat == "json" {
        data := map[string]interface{}{
            "sent":     true,
            "instance": taskManager.GetCurrentInstance(),
        }
        return output.OutputJSONSuccess("task send", data)
    }

    fmt.Printf("Message sent successfully.\n")
    fmt.Printf("Instance: %s\n", taskManager.GetCurrentInstance())
    return nil
}

// In newTaskPauseCommand:
RunE: func(cmd *cobra.Command, args []string) error {
    // ... existing cancel logic ...

    if global.Config.OutputFormat == "json" {
        data := map[string]interface{}{
            "cancelled": true,
            "instance":  taskManager.GetCurrentInstance(),
        }
        return output.OutputJSONSuccess("task pause", data)
    }

    fmt.Println("Task paused successfully")
    fmt.Printf("Instance: %s\n", taskManager.GetCurrentInstance())
    return nil
}
```

## [Classes]

No new classes needed. The existing Manager structs (task.Manager,
config.Manager) remain unchanged in structure, only their methods are enhanced
to support JSON output by checking `global.Config.OutputFormat`.

## [Dependencies]

No new external dependencies required. All JSON handling uses Go's standard
library `encoding/json` package which is already used throughout the codebase.

## [Testing]

Comprehensive testing strategy to ensure correctness and prevent regressions.

### E2E Test Structure

**cli/e2e/json_output_test.go:**

Test organization:
```go
// TestJSONOutputVersion tests version command JSON output
func TestJSONOutputVersion(t *testing.T) {
    ctx := context.Background()
    setTempClineDir(t)

    // Test version command
    out := mustRunCLI(ctx, t, "version", "--output-format", "json")

    // Parse JSON
    var response output.JSONResponse
    if err := json.Unmarshal([]byte(out), &response); err != nil {
        t.Fatalf("failed to parse JSON: %v", err)
    }

    // Validate structure
    if response.Status != "success" {
        t.Errorf("expected status=success, got %s", response.Status)
    }
    if response.Command != "version" {
        t.Errorf("expected command=version, got %s", response.Command)
    }

    // Validate data fields
    data := response.Data.(map[string]interface{})
    requiredFields := []string{"cliVersion", "coreVersion", "commit"}
    for _, field := range requiredFields {
        if _, ok := data[field]; !ok {
            t.Errorf("missing required field: %s", field)
        }
    }
}

// TestJSONOutputInstanceList tests instance list JSON output
func TestJSONOutputInstanceList(t *testing.T) {
    // Similar structure for instance list
}

// TestJSONOutputValidation tests JSON output is valid
func TestJSONOutputValidation(t *testing.T) {
    // Test all commands produce valid JSON
    commands := [][]string{
        {"version", "--output-format", "json"},
        {"instance", "list", "--output-format", "json"},
        {"logs", "path", "--output-format", "json"},
        // ... more commands
    }

    for _, cmd := range commands {
        out := mustRunCLI(ctx, t, cmd...)
        if !json.Valid([]byte(out)) {
            t.Errorf("command %v produced invalid JSON", cmd)
        }
    }
}

// TestJSONOutputNoLeakage tests no stray text in JSON mode
func TestJSONOutputNoLeakage(t *testing.T) {
    // Ensure output is ONLY valid JSON, no extra text
    out := mustRunCLI(ctx, t, "version", "--output-format", "json")

    // First character should be '{'
    trimmed := strings.TrimSpace(out)
    if !strings.HasPrefix(trimmed, "{") {
        t.Errorf("JSON output has leading text: %s", out[:50])
    }
    if !strings.HasSuffix(trimmed, "}") {
        t.Errorf("JSON output has trailing text")
    }
}

// TestRichPlainUnchanged tests backward compatibility
func TestRichPlainUnchanged(t *testing.T) {
    // Verify rich and plain outputs still work and haven't changed
    richOut := mustRunCLI(ctx, t, "version", "--output-format", "rich")
    plainOut := mustRunCLI(ctx, t, "version", "--output-format", "plain")

    // Should not be JSON
    if json.Valid([]byte(richOut)) {
        t.Error("rich output should not be JSON")
    }
    if json.Valid([]byte(plainOut)) {
        t.Error("plain output should not be JSON")
    }
}

// TestJSONWithVerbose tests JSON + verbose flag composition
func TestJSONWithVerbose(t *testing.T) {
    // Verbose mode should work with JSON
    // Verbose output should be included in JSON structure
}

// TestJSONErrors tests error responses in JSON format
func TestJSONErrors(t *testing.T) {
    ctx := context.Background()
    setTempClineDir(t)

    // Test invalid command
    _, errOut, exit := runCLI(ctx, t, "instance", "kill", "nonexistent:9999", "--output-format", "json")

    if exit == 0 {
        t.Error("expected non-zero exit code for error")
    }

    // Error should be in JSON format
    var response output.JSONResponse
    if err := json.Unmarshal([]byte(errOut), &response); err != nil {
        t.Fatalf("error output should be valid JSON: %v", err)
    }

    if response.Status != "error" {
        t.Errorf("expected status=error, got %s", response.Status)
    }
}
```

### Test Categories

1. **JSON Validity Tests** - Every command output is valid JSON
2. **Structure Tests** - Required fields present (status, command, data)
3. **Data Completeness Tests** - All expected data fields are present
4. **Regression Tests** - Rich/plain outputs unchanged
5. **No Leakage Tests** - No text outside JSON in JSON mode
6. **Compose with Verbose Tests** - JSON mode works with --verbose flag
7. **Error Handling Tests** - Errors formatted as JSON

## [Testing]

### TDD Approach

This implementation follows strict Test-Driven Development:

1. **Write comprehensive tests FIRST** that call the `cline` CLI binary via
   shell
2. **Run tests** and observe failures (no JSON support yet)
3. **Implement minimal code** to make specific tests pass
4. **Refactor** while keeping tests green
5. **Repeat** for each command until all tests pass

### Comprehensive Test Matrix

All tests execute the actual `cline` binary via shell using the `runCLI()`
helper from `cli/e2e/helpers_test.go`. Each test validates output for all three
format modes:

| Command | Plain Output | Rich Output | JSON Output | Interactive? |
|---------|--------------|-------------|-------------|--------------|
| `cline version` | ✓ Test exists | ✓ Test exists | ✓ Add test | No |
| `cline version --short` | ✓ Test exists | ✓ Test exists | ✗ No JSON (plain only) | No |
| `cline instance list` | ✓ Test exists | ✓ Test exists | ✓ Add test | No |
| `cline instance new` | ✓ Test exists | ✓ Test exists | ✓ Add test | No |
| `cline instance kill <addr>` | ✓ Test exists | ✓ Test exists | ✓ Add test | No |
| `cline instance kill --all-cli` | ✓ Test exists | ✓ Test exists | ✓ Add test | No |
| `cline instance default <addr>` | ✓ Test exists | ✓ Test exists | ✓ Add test | No |
| `cline config list` | ✓ Test exists | ✓ Test exists | ✓ Add test | No |
| `cline config get <key>` | ✓ Test exists | ✓ Test exists | ✓ Add test | No |
| `cline config set key=val` | ✓ Test exists | ✓ Test exists | ✓ Add test | No |
| `cline logs list` | ✓ Test exists | ✓ Test exists | ✓ Add test | No |
| `cline logs path` | ✓ Test exists | ✓ Test exists | ✓ Add test | No |
| `cline logs clean` | ✓ Test exists | ✓ Test exists | ✓ Add test | No |
| `cline task new "prompt"` | ✓ Test exists | ✓ Test exists | ✓ Add test | No |
| `cline task send "msg"` | ✓ Test exists | ✓ Test exists | ✓ Add test | No |
| `cline task pause` | ✓ Test exists | ✓ Test exists | ✓ Add test | No |
| `cline task view` | ✓ Test exists | ✓ Test exists | ✓ Audit existing | Streaming |
| `cline task view --follow` | ✓ Test exists | ✓ Test exists | ✓ Audit existing | Streaming |
| `cline task chat` | ✓ Test exists | ✓ Test exists | ✗ Must error | **Yes** |
| `cline task list` | ✓ Test exists | ✓ Test exists | ✓ Add test | No |
| `cline task open <id>` | ✓ Test exists | ✓ Test exists | ✓ Add test | No |
| `cline task restore <checkpoint>` | ✓ Test exists | ✓ Test exists | ✓ Add test | No |
| `cline auth` | ✓ Test exists | ✓ Test exists | ✗ Must error | **Yes** |
| `cline <prompt>` (root) | ✓ Test exists | ✓ Test exists | ✗ Must error | **Yes** |

**Legend:**
- ✓ Test exists: Verify existing behavior still works
- ✓ Add test: Create new JSON format test
- ✓ Audit existing: Review and potentially fix existing JSON implementation
- ✗ Must error: Command must return error in JSON mode
- ✗ No JSON: Command doesn't support JSON by design

### E2E Test Structure

**cli/e2e/json_output_test.go:**

Complete test file structure covering all commands:

```go
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

// TestInteractiveCommandsErrorInJSONMode tests that interactive commands reject JSON mode
func TestInteractiveCommandsErrorInJSONMode(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Test auth command
	_, errOut, exit := runCLI(ctx, t, "auth", "--output-format", "json")
	if exit == 0 {
		t.Error("auth command should error in JSON mode")
	}
	
	// Error should be in JSON format
	var response map[string]interface{}
	if err := json.Unmarshal([]byte(errOut), &response); err != nil {
		t.Fatalf("error output should be valid JSON: %v", err)
	}
	if response["status"] != "error" {
		t.Errorf("expected status=error, got %v", response["status"])
	}
	if !strings.Contains(response["error"].(string), "interactive") {
		t.Error("error message should mention interactive mode")
	}

	// Test task chat command
	_, errOut, exit = runCLI(ctx, t, "task", "chat", "--output-format", "json")
	if exit == 0 {
		t.Error("task chat command should error in JSON mode")
	}
	if err := json.Unmarshal([]byte(errOut), &response); err != nil {
		t.Fatalf("error output should be valid JSON: %v", err)
	}
	if response["status"] != "error" {
		t.Errorf("expected status=error, got %v", response["status"])
	}

	// Test root command (interactive)
	_, errOut, exit = runCLI(ctx, t, "--output-format", "json")
	if exit == 0 {
		t.Error("root command without args should error in JSON mode")
	}
	if err := json.Unmarshal([]byte(errOut), &response); err != nil {
		t.Fatalf("error output should be valid JSON: %v", err)
	}
}

// TestJSONOutputNoLeakage tests that JSON mode produces ONLY JSON
func TestJSONOutputNoLeakage(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	commands := [][]string{
		{"version", "--output-format", "json"},
		{"instance", "list", "--output-format", "json"},
		{"logs", "path", "--output-format", "json"},
		{"config", "list", "--output-format", "json"},
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
		
		// Should contain no extra newlines or text
		lines := strings.Split(trimmed, "\n")
		for i, line := range lines {
			if i == 0 && !strings.HasPrefix(line, "{") {
				t.Errorf("command %v: first line should start with {", cmd)
			}
			// Every line should be part of JSON structure
			if strings.TrimSpace(line) == "" && i != len(lines)-1 {
				t.Errorf("command %v: JSON should not have blank lines", cmd)
			}
		}
	}
}

// TestJSONWithVerboseFlag tests that verbose output is included in JSON
func TestJSONWithVerboseFlag(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Start instance to have something to query
	_ = mustRunCLI(ctx, t, "instance", "new")

	// Test with verbose flag
	out := mustRunCLI(ctx, t, "instance", "list", "--output-format", "json", "--verbose")

	// Should still be valid JSON
	var response map[string]interface{}
	if err := json.Unmarshal([]byte(out), &response); err != nil {
		t.Fatalf("verbose JSON output should be valid JSON: %v", err)
	}

	// Verbose info might be in a verbose field or embedded in the response
	// The key is that it's structured JSON, not mixed text+JSON
	if response["status"] != "success" {
		t.Errorf("expected status=success even with verbose, got %v", response["status"])
	}
}

// TestAuditExistingJSONImplementation audits task view/chat JSON support
func TestAuditExistingJSONImplementation(t *testing.T) {
	ctx := context.Background()
	setTempClineDir(t)

	// Start instance and create task
	_ = mustRunCLI(ctx, t, "instance", "new")
	_ = mustRunCLI(ctx, t, "task", "new", "test task", "--yolo")

	// Task view with JSON should work (already implemented)
	out := mustRunCLI(ctx, t, "task", "view", "--output-format", "json")

	// Every line should be valid JSON or part of JSON stream
	lines := strings.Split(strings.TrimSpace(out), "\n")
	for _, line := range lines {
		if line == "" {
			continue
		}
		// Each line in streaming mode should be valid JSON
		if !json.Valid([]byte(line)) {
			t.Errorf("task view JSON line is not valid JSON: %s", line[:min(100, len(line))])
		}
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
		{"instance-list", []string{"instance", "list", "--output-format", "json"}},
		{"logs-path", []string{"logs", "path", "--output-format", "json"}},
		{"logs-list", []string{"logs", "list", "--output-format", "json"}},
		{"config-list", []string{"config", "list", "--output-format", "json"}},
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
```

### Implementation Approach

**Audit Existing JSON Support:**

Before adding new JSON output, audit the existing partial implementation in
`cli/pkg/cli/task/manager.go`:

```go
// Current JSON output locations in task/manager.go:
// 1. Line ~X: if global.Config.OutputFormat == "json" - streaming messages
// 2. Line ~Y: if global.Config.OutputFormat == "json" - API responses
// 3. Line ~Z: if global.Config.OutputFormat == "json" - status updates
// 4. Line ~W: if global.Config.OutputFormat == "json" - completions
```

**Requirements for existing JSON code:**
1. ✓ Ensure no plain text mixed with JSON output
2. ✓ Verify verbose output is formatted as JSON when in JSON mode
3. ✓ Confirm error messages are JSON-formatted
4. ✓ Check that all streaming chunks are valid JSON

## [Implementation Order]

**TDD Implementation Steps** - Each step follows: Write Test → See Failure →
Implement → Pass Test

### Step 1: Create JSON Output Infrastructure (0.5 day)

**1.1 Write Unit Tests**
- Create `cli/pkg/cli/output/json_test.go`
- Write tests for `FormatJSONResponse()` with various data types
- Write tests for `OutputJSONSuccess()` and `OutputJSONError()`
- Write tests for JSON marshaling edge cases
- Run tests - they will fail (functions don't exist yet)

**1.2 Implement JSON Helpers**
- Create `cli/pkg/cli/output/json.go`
- Implement `JSONResponse` type
- Implement `FormatJSONResponse()` - minimal code to pass tests
- Implement `OutputJSON()` wrapper
- Implement `OutputJSONSuccess()` and `OutputJSONError()` helpers
- Implement `IsJSONMode()` helper
- Run tests - should pass

**1.3 Verify**
```bash
cd cli && go test ./pkg/cli/output/... -v
```

### Step 2: Create Comprehensive E2E Test Suite (1 day)

**2.1 Write All JSON Tests**
- Create `cli/e2e/json_output_test.go`
- Write test for EVERY command in the matrix above
- Include tests for:
  - JSON output validation
  - Plain output regression
  - Rich output regression  
  - No text leakage in JSON mode
  - Interactive command errors
  - Verbose flag composition
- Run tests - MOST WILL FAIL (JSON not implemented yet)

**2.2 Document Expected Failures**
```bash
cd cli && go test ./e2e/json_output_test.go -v | tee test-failures.log
```
Save this as baseline of what needs to be fixed.

**2.3 Write Test Helper Functions**
- Add JSON validation helpers
- Add output format testing utilities
- Add instance management test helpers

### Step 3: Implement Version Command (0.5 day)

**3.1 Run Version Tests**
```bash
cd cli && go test ./e2e -run TestJSONOutputVersion -v
```
See failure: "status field missing" or similar

**3.2 Implement Version JSON**
- Modify `cli/pkg/cli/version.go`
- Add JSON output check
- Call `output.OutputJSONSuccess()` with version data
- Keep plain/rich unchanged

**3.3 Verify**
```bash
cd cli && go test ./e2e -run TestJSONOutputVersion -v
# Should pass
./cli/bin/cline version --output-format json | jq
# Should display formatted JSON
```

### Step 4: Implement Instance Commands (1 day)

**4.1 Run Instance Tests**
```bash
cd cli && go test ./e2e -run TestJSONOutputInstance -v
```

**4.2 Implement Instance List**
- Modify `newInstanceListCommand` in `cli/pkg/cli/instances.go`
- Extract data structure before rendering
- Add JSON output branch
- Run tests until passing

**4.3 Implement Instance New**
- Modify `newInstanceNewCommand`
- Add JSON output with instance details
- Test

**4.4 Implement Instance Kill**
- Modify `killAllCLIInstances` and `newInstanceKillCommand`
- Add JSON summary output
- Test

**4.5 Verify All Instance Commands**
```bash
cd cli && go test ./e2e -run TestJSONOutputInstance -v
```

### Step 5: Implement Config Commands (0.5 day)

**5.1 Run Config Tests**
```bash
cd cli && go test ./e2e -run TestJSONOutputConfig -v
```

**5.2 Implement Config List**
- Modify `ListSettings()` in `cli/pkg/cli/config/manager.go`
- Add JSON output branch
- Test

**5.3 Implement Config Get/Set**
- Modify `GetSetting()` and `UpdateSettings()`
- Add JSON output
- Test

**5.4 Verify**
```bash
cd cli && go test ./e2e -run TestJSONOutputConfig -v
```

### Step 6: Implement Logs Commands (0.5 day)

**6.1 Run Logs Tests**
```bash
cd cli && go test ./e2e -run TestJSONOutputLogs -v
```

**6.2 Implement Logs Commands**
- Modify `newLogsListCommand`, `newLogsPathCommand`, `newLogsCleanCommand`
- Add JSON output for each
- Test each incrementally

**6.3 Verify**
```bash
cd cli && go test ./e2e -run TestJSONOutputLogs -v
```

### Step 7: Implement Task Commands (0.5 day)

**7.1 Run Task Tests**
```bash
cd cli && go test ./e2e -run TestJSONOutputTask -v
```

**7.2 Implement Task New/Send/Pause**
- Modify commands in `cli/pkg/cli/task.go`
- Add JSON output
- Test

**7.3 Audit Existing Task View/Chat**
- Review `cli/pkg/cli/task/manager.go`
- Ensure existing JSON streaming is comprehensive
- Fix any mixed text/JSON issues
- Test

**7.4 Verify**
```bash
cd cli && go test ./e2e -run TestJSONOutputTask -v
cd cli && go test ./e2e -run TestAuditExistingJSON -v
```

### Step 8: Add Interactive Command Guards (0.5 day)

**8.1 Run Interactive Tests**
```bash
cd cli && go test ./e2e -run TestInteractiveCommandsError -v
```

**8.2 Implement Auth Guard**
- Modify `cli/pkg/cli/auth.go`
- Add JSON mode detection
- Return JSON error
- Test

**8.3 Implement Task Chat Guard**
- Modify `newTaskChatCommand`
- Add JSON mode check
- Return JSON error
- Test

**8.4 Implement Root Command Guard**
- Modify `cli/cmd/cline/main.go`
- Detect interactive mode + JSON
- Return JSON error
- Test

**8.5 Verify**
```bash
cd cli && go test ./e2e -run TestInteractiveCommandsError -v
```

### Step 9: Final Validation (0.5 day)

**9.1 Run All Tests**
```bash
cd cli && go test ./e2e/json_output_test.go -v
```
All tests should pass.

**9.2 Run Full Test Suite**
```bash
cd cli && go test ./e2e/... -v
```
Ensure no regressions in existing tests.

**9.3 Manual Verification**
```bash
# Test each command manually
./cli/bin/cline version --output-format json | jq
./cli/bin/cline instance list --output-format json | jq
./cli/bin/cline config list --output-format json | jq
./cli/bin/cline logs path --output-format json | jq

# Verify plain still works
./cli/bin/cline version --output-format plain
./cli/bin/cline version --output-format rich

# Verify interactive errors
./cli/bin/cline auth --output-format json
# Should show JSON error

# Verify no leakage
./cli/bin/cline version --output-format json --verbose
# Should be pure JSON with verbose info embedded
```

**9.4 Update Documentation**
- Update CLI README with JSON output examples
- Update man pages
- Add JSON output to docs site

### Total Estimated Time: ~5 days

**Key TDD Principles Applied:**
1. ✓ Tests written FIRST for each component
2. ✓ See RED (failures) before implementing
3. ✓ Implement minimal code to turn tests GREEN
4. ✓ Refactor while keeping tests green
5. ✓ Incremental progress - one command at a time
6. ✓ Comprehensive test coverage before code
7. ✓ All tests call real CLI binary via shell
