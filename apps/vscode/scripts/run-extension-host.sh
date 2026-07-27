#!/usr/bin/env bash

SESSION="cline-dev"
WORKSPACE="${CLINE_WORKSPACE:-$(cd "$(dirname "$0")/.." && pwd)}"
ENVIRONMENT="${CLINE_ENVIRONMENT:-production}"
CHECK_ONLY=false

case "${1:-}" in
  "")
    ;;
  --check)
    CHECK_ONLY=true
    ;;
  *)
    echo "Usage: bash scripts/run-extension-host.sh [--check]" >&2
    exit 2
    ;;
esac

cd "$WORKSPACE"

# Command-line demo settings win over optional values in .env.
local_api_was_set="${CLINE_LOCAL_API_BASE_URL+x}"
local_api_value="${CLINE_LOCAL_API_BASE_URL:-}"
auto_picker_was_set="${CLINE_AUTO_MODEL_PICKER_ENABLED+x}"
auto_picker_value="${CLINE_AUTO_MODEL_PICKER_ENABLED:-}"
pass_picker_was_set="${CLINE_PASS_AUTO_MODEL_PICKER_ENABLED+x}"
pass_picker_value="${CLINE_PASS_AUTO_MODEL_PICKER_ENABLED:-}"

# Export env vars -- tmux inherits them automatically
export IS_DEV=true
export DEV_WORKSPACE_FOLDER="$WORKSPACE"
export CLINE_ENVIRONMENT="$ENVIRONMENT"
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi
export CLINE_ENVIRONMENT="$ENVIRONMENT"
if [ -n "$local_api_was_set" ]; then
  export CLINE_LOCAL_API_BASE_URL="$local_api_value"
fi
if [ -n "$auto_picker_was_set" ]; then
  export CLINE_AUTO_MODEL_PICKER_ENABLED="$auto_picker_value"
fi
if [ -n "$pass_picker_was_set" ]; then
  export CLINE_PASS_AUTO_MODEL_PICKER_ENABLED="$pass_picker_value"
fi

case "${CLINE_LOCAL_API_BASE_URL:-}" in
  ""|http://localhost:7777|http://localhost:7777/|http://localhost:17777|http://localhost:17777/|\
  http://127.0.0.1:7777|http://127.0.0.1:7777/|http://127.0.0.1:17777|http://127.0.0.1:17777/|\
  http://\[::1\]:7777|http://\[::1\]:7777/|http://\[::1\]:17777|http://\[::1\]:17777/)
    ;;
  *)
    echo "CLINE_LOCAL_API_BASE_URL must be loopback HTTP on port 7777 or 17777." >&2
    exit 2
    ;;
esac

if [ "$CHECK_ONLY" = true ]; then
  echo "Extension Host launcher check:"
  echo "  CLINE_ENVIRONMENT: $CLINE_ENVIRONMENT"
  echo "  CLINE_LOCAL_API_BASE_URL: ${CLINE_LOCAL_API_BASE_URL:-http://localhost:7777}"
  echo "  CLINE_AUTO_MODEL_PICKER_ENABLED: ${CLINE_AUTO_MODEL_PICKER_ENABLED:-false}"
  echo "  CLINE_PASS_AUTO_MODEL_PICKER_ENABLED: ${CLINE_PASS_AUTO_MODEL_PICKER_ENABLED:-false}"
  echo "Check complete. No build, VS Code launch, or API request was made."
  exit 0
fi

# Step 1: Build protos (everything depends on this)
echo "Building protos..."
bun run protos || { echo "Protos build failed"; exit 1; }

# Step 2: Build webview once
echo "Building webview..."
bun run build:webview || { echo "Webview build failed"; exit 1; }

if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux is not installed; using the standard Extension Development Host flow."
  bun run watch:esbuild &
  esbuild_pid=$!
  bun run watch:tsc &
  tsc_pid=$!
  bun run dev:webview &
  webview_pid=$!

  cleanup_watchers() {
    kill "$esbuild_pid" "$tsc_pid" "$webview_pid" 2>/dev/null || true
  }
  trap cleanup_watchers EXIT INT TERM

  code --new-window \
    --extensionDevelopmentPath="$WORKSPACE" \
    --disable-workspace-trust \
    --disable-extension saoudrizwan.claude-dev \
    --disable-extension saoudrizwan.cline-nightly \
    "$WORKSPACE" || exit 1
  echo "Extension Development Host launched. Press Ctrl+C here after the demo."
  wait
  exit
fi

# Step 3: Kill existing session if one is running
tmux kill-session -t "$SESSION" 2>/dev/null
true

# Step 4: Create tmux session with 4 vertical panes
#
#   ┌────────────┬────────────┬────────────┬────────────┐
#   │  esbuild   │    tsc     │  webview   │  ext host  │
#   └────────────┴────────────┴────────────┴────────────┘

echo "Starting tmux session..."
tmux new-session -d -s "$SESSION" -c "$WORKSPACE"
tmux split-window -h -t "$SESSION" -c "$WORKSPACE"
tmux split-window -h -t "$SESSION:0.0" -c "$WORKSPACE"
tmux split-window -h -t "$SESSION:0.2" -c "$WORKSPACE"
tmux select-layout -t "$SESSION" even-horizontal

# Ctrl+C kills the whole session
tmux bind-key -T root C-c kill-session

tmux send-keys -t "$SESSION:0.0" "bun run watch:esbuild" Enter
tmux send-keys -t "$SESSION:0.1" "bun run watch:tsc" Enter
tmux send-keys -t "$SESSION:0.2" "bun run dev:webview" Enter
tmux send-keys -t "$SESSION:0.3" "while [ ! -f '$WORKSPACE/dist/extension.js' ]; do sleep 0.5; done && echo 'Launching Extension Host...' && code --extensionDevelopmentPath='$WORKSPACE' --disable-workspace-trust --disable-extension saoudrizwan.claude-dev --disable-extension saoudrizwan.cline-nightly '$WORKSPACE' && echo 'Extension Host launched.'" Enter

# Attach to the session
tmux attach-session -t "$SESSION"

# Session ended -- run full cleanup
tmux unbind-key -T root C-c 2>/dev/null
# Kill watcher processes and their node children
pkill -f "watch:esbuild|watch:tsc|dev:webview" 2>/dev/null
pkill -f "esbuild.mjs --watch" 2>/dev/null
pkill -f "tsc --noEmit --watch" 2>/dev/null
pkill -f "vite.*/webview-ui" 2>/dev/null
# Close the Extension Development Host window
osascript -e '
tell application "System Events"
  tell process "Electron"
    set windowList to every window whose title contains "Extension Development Host"
    repeat with w in windowList
      click button 1 of w
    end repeat
  end tell
end tell' 2>/dev/null
echo "Stopped"
