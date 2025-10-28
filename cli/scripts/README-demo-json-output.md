# JSON Output Demonstration Script

This script (`demo-json-output.sh`) demonstrates all CLI command and output format combinations that are tested in the e2e test suite.

## Purpose

Shows real-world JSON output from every command in these categories:
- **Version commands** - JSON output with -F json flag
- **Instance commands** - new, list, kill, default
- **Logs commands** - path, list, clean
- **Config commands** - list, get, set
- **Task commands** - new, list, open, view, send, pause, restore
- **Verbose output** - JSONL debug messages with `--verbose` flag
- **Interactive commands** - Proper rejection in JSON mode
- **Format validation** - JSON purity checks (no text leakage)

**Note:** This script demonstrates JSON output only. It uses the `-F json` flag (short form of `--output-format json`) for all commands.

## Usage

```bash
# From the cli directory
./scripts/demo-json-output.sh

# Or from the project root
./cli/scripts/demo-json-output.sh
```

## What It Does

1. **Creates temporary CLINE_DIR** - Isolated environment for testing
2. **Runs every command** from the e2e test suite with output format variations
3. **Shows command and output** - Each test displays the command and its result
4. **Color-coded output** - Easy to read with color highlighting
5. **Automatic cleanup** - Kills instances and removes temp directory on exit

## Output Format

Each test section shows:
```
=================================================================================
TEST: TestJSONOutputVersion - version with JSON output
=================================================================================

Command: version --output-format json
Output:
{
  "status": "success",
  "command": "version",
  "result": {
    "cliVersion": "1.2.3",
    ...
  }
}
```

## Command Types Demonstrated

### 1. Batch Commands (Single JSON Object)
- `version -F json`
- `instance list -F json`
- `logs path -F json`
- etc.

**Output**: Single JSON object with `status`, `command`, and `data` fields.

### 2. Streaming Commands (JSONL - Multiple JSON Objects)
- `task view -F json`

**Output**: Multiple JSON objects, one per line (JSONL format).

### 3. Verbose Output (JSONL Debug Messages)
- `instance new --verbose -F json`

**Output**: 
```json
{"type":"debug","message":"Starting new instance..."}
{"type":"debug","message":"Starting cline-host on port 12345"}
...
{"status":"success","command":"instance new","result":{...}}
```

### 4. Interactive Commands (Rejected in JSON Mode)
- `auth -F json` → Plain text error
- `task chat -F json` → Plain text error
- Root command `-F json` with no args → Plain text error

**Output**: Plain text error message (NOT JSON):
```
Error: auth is an interactive command and cannot be used with -F json
```

## Test Coverage

The script demonstrates **100% JSON command coverage** from the e2e test suite:

| Category | Commands | Combinations | Details |
|----------|----------|--------------|---------|
| Version | 1 | 3 | standard, verbose, short |
| Instance | 4 | 7 | new (std, verbose), list (std, verbose), default, kill, kill --all-cli |
| Instance Errors | 2 | 2 | kill nonexistent, default nonexistent |
| Logs | 3 | 5 | path (std, verbose), list (std, verbose), clean |
| Config | 3 | 4 | list (std, verbose), get, set |
| Config Errors | 1 | 1 | get invalid key |
| Task | 6 | 8 | new (std, verbose), list, open, send, pause, view, restore |
| Task Errors | 2 | 2 | open nonexistent, restore invalid |
| Interactive | 3 | 3 | auth, task chat, root (all reject JSON) |

**Total**: 34 command combinations demonstrated (all with JSON output or proper rejection)

**Note**: Numbers show base commands vs. total combinations when including verbose variants and error scenarios.

## Exit Status

- **0** - All commands executed (some may fail as expected)
- **1** - CLI binary not found (need to build first)

## Prerequisites

The CLI binary must exist:
```bash
cd cli
./scripts/build-cli.sh
```

## Features

✅ **JSON output only** - Demonstrates pure JSON output with -F json flag  
✅ **Automatic cleanup** - Temp directory and instances removed on exit  
✅ **Color-coded output** - Easy to read test results  
✅ **Comprehensive coverage** - Every e2e JSON test represented  
✅ **JSON validation** - Checks for text leakage  
✅ **Expected failures** - Interactive commands properly rejected  
✅ **JSONL demonstration** - Shows verbose and streaming output

## Examples

### JSON Output (Batch Command)
```bash
$ ./cli/bin/cline version -F json
{
  "status": "success",
  "command": "version",
  "result": {
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

### JSONL Output (Verbose Mode)
```bash
$ ./cli/bin/cline instance new --verbose -F json
{"message":"Starting new Cline instance...","type":"debug"}
{"message":"Finding available ports...","type":"debug"}
{"message":"Starting cline-host on port 54321","type":"debug"}
...
{"command":"instance new","result":{"address":"localhost:54321",...},"status":"success"}
```

### Interactive Command Rejection
```bash
$ ./cli/bin/cline auth -F json
Error: auth is an interactive command and cannot be used with -F json
Usage:
  cline auth [flags]
```

## Notes

- The script uses `set -e` but handles expected failures gracefully
- Each test is isolated with appropriate setup and cleanup
- Temp directory path is shown at start of script execution
- All instances are killed and temp directory removed on exit (even on script errors)

## Related Files

- **Source**: `cli/scripts/demo-json-output.sh`
- **Tests**: `cli/e2e/json_output_test.go`
- **Implementation**: `cli/pkg/cli/output/json.go`
- **Plan**: `plans/cli_json_all_implementation_plan.md`
