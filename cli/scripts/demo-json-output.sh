#!/usr/bin/env bash
# Demo script showing all CLI command/output format combinations
# This demonstrates every command tested in the e2e test suite

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
CLI_BIN="${SCRIPT_DIR}/../bin/cline"

# Check if CLI binary exists
if [[ ! -f "$CLI_BIN" ]]; then
    echo -e "${RED}Error: CLI binary not found at $CLI_BIN${NC}"
    echo "Please run: cd cli && ./scripts/build-cli.sh"
    exit 1
fi

# Create temp CLINE_DIR
export CLINE_DIR=$(mktemp -d)
echo -e "${GREEN}Using temp CLINE_DIR: $CLINE_DIR${NC}\n"

# Cleanup function
cleanup() {
    echo -e "\n${YELLOW}Cleaning up...${NC}"
    # Kill any running instances
    "$CLI_BIN" instance kill --all-cli &>/dev/null || true
    # Wait a bit for processes to die
    sleep 1
    # Remove temp directory
    rm -rf "$CLINE_DIR"
}
trap cleanup EXIT

# Function to print test header
print_test() {
    echo -e "\n${BLUE}=================================================================================${NC}"
    echo -e "${BLUE}TEST: $1${NC}"
    echo -e "${BLUE}=================================================================================${NC}"
}

# Function to print command
print_cmd() {
    echo -e "\n${YELLOW}Command:${NC} $*"
    echo -e "${YELLOW}Output:${NC}"
}

# Function to run command and show output
run_cmd() {
    print_cmd "$@"
    "$CLI_BIN" "$@" || echo -e "${RED}(Command failed with exit code $?)${NC}"
}

# Function to run command that should fail
run_cmd_expect_fail() {
    print_cmd "$@" "(expected to fail)"
    "$CLI_BIN" "$@" 2>&1 || echo -e "${GREEN}✓ Failed as expected (exit code $?)${NC}"
}

echo -e "${GREEN}===========================================${NC}"
echo -e "${GREEN}   Cline CLI JSON Output Demonstration${NC}"
echo -e "${GREEN}===========================================${NC}"

# ========================================
# VERSION COMMANDS
# ========================================

print_test "TestJSONOutputVersion - version with JSON output"
run_cmd version -F json

print_test "TestJSONOutputVersionShort - version --short (overrides JSON)"
run_cmd version --short -F json

# ========================================
# INSTANCE COMMANDS
# ========================================

print_test "Setup: Start a new instance for testing"
run_cmd instance new -F json

print_test "TestJSONOutputInstanceList - instance list with JSON"
run_cmd instance list -F json

print_test "TestJSONOutputInstanceNew - instance new with JSON"
run_cmd instance new -F json

print_test "TestJSONOutputInstanceNewWithVerbose - instance new with verbose + JSON"
run_cmd instance new --verbose -F json

print_test "TestJSONOutputInstanceDefault - instance default with JSON"
# Get an instance address first
INSTANCE_ADDR=$("$CLI_BIN" instance list -F json | grep -o '"address":"[^"]*"' | head -1 | cut -d'"' -f4)
if [[ -n "$INSTANCE_ADDR" ]]; then
    run_cmd instance default "$INSTANCE_ADDR" -F json
fi

print_test "TestJSONOutputInstanceKill - instance kill with JSON"
# Create a new instance to kill
KILL_ADDR=$("$CLI_BIN" instance new -F json | grep -o '"address":"[^"]*"' | cut -d'"' -f4)
if [[ -n "$KILL_ADDR" ]]; then
    run_cmd instance kill "$KILL_ADDR" -F json
fi

# ========================================
# LOGS COMMANDS
# ========================================

print_test "TestJSONOutputLogsPath - logs path with JSON"
run_cmd logs path -F json

print_test "TestJSONOutputLogsList - logs list with JSON"
run_cmd logs list -F json

print_test "TestJSONOutputLogsClean - logs clean with JSON (dry-run)"
run_cmd logs clean --dry-run -F json

# ========================================
# CONFIG COMMANDS
# ========================================

print_test "TestJSONOutputConfigList - config list with JSON"
run_cmd config list -F json

print_test "TestJSONOutputConfigSet - config set with JSON"
run_cmd config set auto-approval-settings.enabled=true -F json

print_test "TestJSONOutputConfigGet - config get with JSON"
run_cmd config get auto-approval-settings.enabled -F json

# ========================================
# TASK COMMANDS (Non-interactive)
# ========================================

print_test "Setup: Create a task for testing"
run_cmd task new "test task for demo" --yolo -F json

print_test "TestJSONOutputTaskList - task list with JSON"
run_cmd task list -F json

print_test "TestJSONOutputTaskOpen - task open with JSON"
# Get the first task ID
TASK_ID=$("$CLI_BIN" task list -F json | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
if [[ -n "$TASK_ID" ]]; then
    run_cmd task open "$TASK_ID" -F json
fi

print_test "TestJSONOutputTaskView - task view with JSON (JSONL stream)"
run_cmd task view -F json

print_test "TestJSONOutputTaskSend - task send with JSON"
run_cmd task send "continue" -F json

print_test "TestJSONOutputTaskPause - task pause with JSON"
run_cmd task pause -F json

print_test "TestJSONOutputTaskRestore - task restore with JSON"
run_cmd task restore 0 -F json 2>&1 || echo -e "${YELLOW}(No checkpoints to restore)${NC}"

# ========================================
# VERBOSE FLAG COMBINATIONS
# ========================================

print_test "TestJSONOutputWithVerboseFlag - version --verbose with JSON"
run_cmd version --verbose -F json

print_test "TestJSONOutputWithVerboseFlag - instance list --verbose with JSON"
run_cmd instance list --verbose -F json

print_test "TestJSONOutputWithVerboseFlag - logs path --verbose with JSON"
run_cmd logs path --verbose -F json

print_test "TestJSONOutputWithVerboseFlag - logs list --verbose with JSON"
run_cmd logs list --verbose -F json

print_test "TestJSONOutputWithVerboseFlag - config list --verbose with JSON"
run_cmd config list --verbose -F json

print_test "TestJSONOutputWithVerboseFlag - task new --verbose with JSON"
run_cmd task new "verbose test task" --yolo --verbose -F json

# ========================================
# INTERACTIVE COMMANDS (Should fail with JSON)
# ========================================

print_test "TestInteractiveCommandsErrorInJSONMode - auth with JSON (should fail)"
run_cmd_expect_fail auth -F json

print_test "TestInteractiveCommandsErrorInJSONMode - task chat with JSON (should fail)"
run_cmd_expect_fail task chat -F json

print_test "TestInteractiveCommandsErrorInJSONMode - root command with JSON (should fail)"
run_cmd_expect_fail -F json

# ========================================
# JSON VALIDATION TESTS
# ========================================

print_test "TestJSONOutputNoLeakage - Multiple commands checked for pure JSON"
echo -e "${YELLOW}Testing commands for JSON purity (no text leakage)...${NC}"

echo -e "\n${YELLOW}1. version -F json${NC}"
OUTPUT=$("$CLI_BIN" version -F json)
if [[ "$OUTPUT" =~ ^\{.*\}$ ]]; then
    echo -e "${GREEN}✓ Pure JSON (starts with { and ends with })${NC}"
else
    echo -e "${RED}✗ Has text leakage${NC}"
fi
echo "$OUTPUT" | head -5

echo -e "\n${YELLOW}2. instance list -F json${NC}"
OUTPUT=$("$CLI_BIN" instance list -F json)
if [[ "$OUTPUT" =~ ^\{.*\}$ ]]; then
    echo -e "${GREEN}✓ Pure JSON${NC}"
else
    echo -e "${RED}✗ Has text leakage${NC}"
fi
echo "$OUTPUT" | head -5

echo -e "\n${YELLOW}3. logs path -F json${NC}"
OUTPUT=$("$CLI_BIN" logs path -F json)
if [[ "$OUTPUT" =~ ^\{.*\}$ ]]; then
    echo -e "${GREEN}✓ Pure JSON${NC}"
else
    echo -e "${RED}✗ Has text leakage${NC}"
fi
echo "$OUTPUT" | head -5

# ========================================
# SUMMARY
# ========================================

echo -e "\n${GREEN}=================================================================================${NC}"
echo -e "${GREEN}                              DEMONSTRATION COMPLETE${NC}"
echo -e "${GREEN}=================================================================================${NC}"
echo -e "\n${BLUE}Summary of tested command combinations:${NC}"
echo -e "  ${GREEN}✓${NC} Version commands (JSON output, short override)"
echo -e "  ${GREEN}✓${NC} Instance commands (new, list, kill, default)"
echo -e "  ${GREEN}✓${NC} Logs commands (path, list, clean)"
echo -e "  ${GREEN}✓${NC} Config commands (list, get, set)"
echo -e "  ${GREEN}✓${NC} Task commands (new, list, open, view, send, pause, restore)"
echo -e "  ${GREEN}✓${NC} Verbose flag with JSON output (JSONL debug messages)"
echo -e "  ${GREEN}✓${NC} Interactive command rejection in JSON mode"
echo -e "  ${GREEN}✓${NC} JSON purity validation (no text leakage)"
echo -e "\n${BLUE}Output format:${NC}"
echo -e "  ${GREEN}✓${NC} JSON only (-F json or --output-format json)"
echo -e "\n${BLUE}Command types tested:${NC}"
echo -e "  ${GREEN}✓${NC} Batch/non-streaming commands (single JSON object)"
echo -e "  ${GREEN}✓${NC} Streaming commands (JSONL - multiple JSON objects)"
echo -e "  ${GREEN}✓${NC} Interactive commands (properly reject JSON mode)"
echo -e "  ${GREEN}✓${NC} Verbose output (JSONL debug messages with type:debug)"
echo -e "\n${YELLOW}Note: Temp directory $CLINE_DIR will be cleaned up automatically${NC}\n"
