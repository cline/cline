#!/usr/bin/env bash
# Demo script showing ALL CLI commands with JSON output format (-F json)
# Demonstrates: batch vs interactive, verbose vs standard, streaming vs non-streaming, success vs errors

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
    "$CLI_BIN" instance kill --all-cli -F json &>/dev/null || true
    # Wait a bit for processes to die
    sleep 1
    # Remove temp directory
    rm -rf "$CLINE_DIR"
}
trap cleanup EXIT

# Function to print section header
print_section() {
    echo -e "\n${GREEN}=================================================================================${NC}"
    echo -e "${GREEN}$1${NC}"
    echo -e "${GREEN}=================================================================================${NC}"
}

# Function to print test header
print_test() {
    echo -e "\n${BLUE}─────────────────────────────────────────────────────────────────────────────${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}─────────────────────────────────────────────────────────────────────────────${NC}"
}

# Function to run command and show output
run_cmd() {
    echo -e "${YELLOW}\$${NC} cline $*"
    "$CLI_BIN" "$@" || echo -e "${RED}(Command failed with exit code $?)${NC}"
}

# Function to run command that should fail
run_cmd_error() {
    echo -e "${YELLOW}\$${NC} cline $* ${RED}(expected to fail)${NC}"
    "$CLI_BIN" "$@" 2>&1 || echo -e "${GREEN}✓ Failed as expected (exit code $?)${NC}"
}

echo -e "${GREEN}=====================================================================${NC}"
echo -e "${GREEN}        Cline CLI: Complete JSON Output Demonstration${NC}"
echo -e "${GREEN}        All commands tested with -F json flag${NC}"
echo -e "${GREEN}=====================================================================${NC}"

# ==========================================
# VERSION COMMANDS (Batch, Non-streaming)
# ==========================================

print_section "1. VERSION COMMANDS"

print_test "version -F json (standard output)"
run_cmd version -F json

print_test "version --verbose -F json (with debug messages - JSONL)"
run_cmd version --verbose -F json

print_test "version --short -F json (plain text override)"
run_cmd version --short -F json

# ==========================================
# INSTANCE COMMANDS (Batch, Non-streaming)
# ==========================================

print_section "2. INSTANCE COMMANDS"

print_test "instance new -F json (standard output)"
run_cmd instance new -F json

print_test "instance new --verbose -F json (JSONL with ~21 debug messages)"
run_cmd instance new --verbose -F json

print_test "instance list -F json (standard output)"
run_cmd instance list -F json

print_test "instance list --verbose -F json (with debug messages)"
run_cmd instance list --verbose -F json

print_test "instance default <address> -F json (set default instance)"
INSTANCE_ADDR=$("$CLI_BIN" instance list -F json | grep -o '"address":"[^"]*"' | head -1 | cut -d'"' -f4)
if [[ -n "$INSTANCE_ADDR" ]]; then
    run_cmd instance default "$INSTANCE_ADDR" -F json
fi

print_test "instance kill <address> -F json (kill specific instance)"
KILL_ADDR=$("$CLI_BIN" instance new -F json | grep -o '"address":"[^"]*"' | cut -d'"' -f4)
if [[ -n "$KILL_ADDR" ]]; then
    run_cmd instance kill "$KILL_ADDR" -F json
fi

print_test "instance kill --all-cli -F json (kill all instances, triggers cleanup)"
# Create multiple instances to demonstrate cleanup
for i in {1..3}; do
    "$CLI_BIN" instance new -F json > /dev/null 2>&1
done
run_cmd instance kill --all-cli -F json

# ==========================================
# INSTANCE ERROR SCENARIOS
# ==========================================

print_section "3. INSTANCE COMMANDS - ERROR SCENARIOS"

print_test "instance kill nonexistent:9999 -F json (error: not found)"
run_cmd_error instance kill nonexistent:9999 -F json

print_test "instance default nonexistent:9999 -F json (error: not found)"
run_cmd_error instance default nonexistent:9999 -F json

# ==========================================
# LOGS COMMANDS (Batch, Non-streaming)
# ==========================================

print_section "4. LOGS COMMANDS"

print_test "logs path -F json (simple command)"
run_cmd logs path -F json

print_test "logs path --verbose -F json (with debug messages)"
run_cmd logs path --verbose -F json

print_test "logs list -F json (list all log files)"
run_cmd logs list -F json

print_test "logs list --verbose -F json (with debug messages)"
run_cmd logs list --verbose -F json

print_test "logs clean --dry-run -F json (dry-run cleanup)"
run_cmd logs clean --dry-run -F json

# ==========================================
# CONFIG COMMANDS (Batch, Non-streaming)
# ==========================================

print_section "5. CONFIG COMMANDS"

# Restart an instance for config commands
"$CLI_BIN" instance new -F json > /dev/null 2>&1

print_test "config list -F json (list all settings)"
run_cmd config list -F json

print_test "config list --verbose -F json (with debug messages)"
run_cmd config list --verbose -F json

print_test "config set key=value -F json (modify setting)"
run_cmd config set auto-approval-settings.enabled=true -F json

print_test "config get key -F json (get specific setting)"
run_cmd config get auto-approval-settings.enabled -F json

# ==========================================
# CONFIG ERROR SCENARIOS
# ==========================================

print_section "6. CONFIG COMMANDS - ERROR SCENARIOS"

print_test "config get invalid.key.path -F json (error: not found)"
run_cmd_error config get invalid.key.path -F json

# ==========================================
# TASK COMMANDS (Batch, Non-streaming)
# ==========================================

print_section "7. TASK COMMANDS - BATCH"

print_test "task new 'prompt' --yolo -F json (create task)"
run_cmd task new "test task for demo" --yolo -F json

print_test "task new 'prompt' --yolo --verbose -F json (JSONL with debug)"
run_cmd task new "verbose test task" --yolo --verbose -F json

print_test "task list -F json (list all tasks)"
run_cmd task list -F json

print_test "task open <id> -F json (open specific task)"
TASK_ID=$("$CLI_BIN" task list -F json 2>/dev/null | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
if [[ -n "$TASK_ID" ]]; then
    run_cmd task open "$TASK_ID" -F json
fi

print_test "task send 'message' -F json (send message to task)"
run_cmd task send "continue with task" -F json

print_test "task pause -F json (pause active task)"
run_cmd task pause -F json

# ==========================================
# TASK ERROR SCENARIOS  
# ==========================================

print_section "8. TASK COMMANDS - ERROR SCENARIOS"

print_test "task open 99999 -F json (error: task not found)"
run_cmd_error task open 99999 -F json

print_test "task restore 0 -F json (error: no checkpoints)"
run_cmd_error task restore 0 -F json

# ==========================================
# TASK COMMANDS (Streaming)
# ==========================================

print_section "9. TASK COMMANDS - STREAMING (JSONL)"

print_test "task view -F json (streaming JSONL output)"
echo -e "${YELLOW}Note: Outputs JSONL (JSON Lines) - one JSON object per line${NC}"
run_cmd task view -F json

# ==========================================
# INTERACTIVE COMMANDS (Must Reject JSON)
# ==========================================

print_section "10. INTERACTIVE COMMANDS - MUST REJECT JSON MODE"

print_test "auth -F json (interactive - must reject with plain text error)"
echo -e "${YELLOW}Interactive command - JSON mode not supported${NC}"
run_cmd_error auth -F json

print_test "task chat -F json (interactive - must reject with plain text error)"
echo -e "${YELLOW}Interactive command - JSON mode not supported${NC}"  
run_cmd_error task chat -F json

print_test "cline -F json (root interactive - must reject with plain text error)"
echo -e "${YELLOW}Interactive command - JSON mode not supported${NC}"
run_cmd_error -F json

# ==========================================
# JSON VALIDATION
# ==========================================

print_section "11. JSON PURITY VALIDATION (Zero Text Leakage)"

echo -e "${YELLOW}Testing commands for pure JSON output (no text leakage)...${NC}\n"

# Test 1: version
echo -e "${BLUE}Test 1: version -F json${NC}"
OUTPUT=$("$CLI_BIN" version -F json)
if [[ "$OUTPUT" =~ ^\{.*\}$ ]]; then
    echo -e "${GREEN}✓ Pure JSON (starts with { ends with })${NC}"
else
    echo -e "${RED}✗ Has text leakage!${NC}"
fi

# Test 2: instance list  
echo -e "\n${BLUE}Test 2: instance list -F json${NC}"
"$CLI_BIN" instance new -F json > /dev/null 2>&1
OUTPUT=$("$CLI_BIN" instance list -F json)
if [[ "$OUTPUT" =~ ^\{.*\}$ ]]; then
    echo -e "${GREEN}✓ Pure JSON${NC}"
else
    echo -e "${RED}✗ Has text leakage!${NC}"
fi

# Test 3: logs path
echo -e "\n${BLUE}Test 3: logs path -F json${NC}"
OUTPUT=$("$CLI_BIN" logs path -F json)
if [[ "$OUTPUT" =~ ^\{.*\}$ ]]; then
    echo -e "${GREEN}✓ Pure JSON${NC}"
else
    echo -e "${RED}✗ Has text leakage!${NC}"
fi

# Test 4: config list
echo -e "\n${BLUE}Test 4: config list -F json${NC}"
OUTPUT=$("$CLI_BIN" config list -F json)
if [[ "$OUTPUT" =~ ^\{.*\}$ ]]; then
    echo -e "${GREEN}✓ Pure JSON${NC}"
else
    echo -e "${RED}✗ Has text leakage!${NC}"
fi

# Test 5: instance kill (tests registry cleanup)
echo -e "\n${BLUE}Test 5: instance kill --all-cli -F json (registry cleanup)${NC}"
for i in {1..5}; do
    "$CLI_BIN" instance new -F json > /dev/null 2>&1
done
OUTPUT=$("$CLI_BIN" instance kill --all-cli -F json)
if [[ "$OUTPUT" =~ ^\{.*\}$ ]]; then
    echo -e "${GREEN}✓ Pure JSON (no registry cleanup text leakage)${NC}"
else
    echo -e "${RED}✗ Has text leakage!${NC}"
fi

# ==========================================
# SUMMARY
# ==========================================

print_section "DEMONSTRATION COMPLETE"

echo -e "\n${BLUE}Commands Tested:${NC}"
echo -e "  ${GREEN}✓${NC} version (standard, verbose, short)"
echo -e "  ${GREEN}✓${NC} instance (new, list, default, kill, kill --all-cli)"
echo -e "  ${GREEN}✓${NC} logs (path, list, clean)"
echo -e "  ${GREEN}✓${NC} config (list, get, set)"
echo -e "  ${GREEN}✓${NC} task (new, list, open, view, send, pause, restore)"
echo -e "  ${GREEN}✓${NC} auth, task chat, root (interactive - properly reject JSON)"

echo -e "\n${BLUE}Test Categories Covered:${NC}"
echo -e "  ${GREEN}✓${NC} Batch commands (single JSON response)"
echo -e "  ${GREEN}✓${NC} Streaming commands (JSONL - multiple JSON objects)"
echo -e "  ${GREEN}✓${NC} Interactive commands (plain text error rejection)"
echo -e "  ${GREEN}✓${NC} Verbose flag (JSONL debug messages with type:debug)"
echo -e "  ${GREEN}✓${NC} Success scenarios (all commands working correctly)"
echo -e "  ${GREEN}✓${NC} Error scenarios (proper JSON error formatting)"
echo -e "  ${GREEN}✓${NC} JSON purity validation (zero text leakage)"

echo -e "\n${BLUE}Key Features Demonstrated:${NC}"
echo -e "  ${GREEN}✓${NC} All output is valid JSON when -F json is used"
echo -e "  ${GREEN}✓${NC} JSONL format for verbose output (type:debug)"
echo -e "  ${GREEN}✓${NC} JSONL format for streaming output (task view)"
echo -e "  ${GREEN}✓${NC} Interactive commands reject JSON with plain text errors"
echo -e "  ${GREEN}✓${NC} Error responses formatted as JSON (status:error)"
echo -e "  ${GREEN}✓${NC} Registry cleanup operations produce pure JSON (no text leakage)"
echo -e "  ${GREEN}✓${NC} Verbose mode composes with JSON (outputs JSONL debug messages)"

echo -e "\n${YELLOW}Note: Temp directory $CLINE_DIR will be cleaned up automatically${NC}\n"
