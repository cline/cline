#!/usr/bin/env bash

SESSION="cline-dev"
WORKSPACE="${CLINE_WORKSPACE:-$(cd "$(dirname "$0")/.." && pwd)}"
ENVIRONMENT="${CLINE_ENVIRONMENT:-production}"

cd "$WORKSPACE"

# Export env vars -- tmux inherits them automatically
export IS_DEV=true
export DEV_WORKSPACE_FOLDER="$WORKSPACE"
export CLINE_ENVIRONMENT="$ENVIRONMENT"
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

# Step 1: Build protos (everything depends on this)
echo "Building protos..."
npm run protos || { echo "Protos build failed"; exit 1; }

# Step 2: Build webview once
echo "Building webview..."
npm run build:webview || { echo "Webview build failed"; exit 1; }

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

tmux send-keys -t "$SESSION:0.0" "npm run watch:esbuild" Enter
tmux send-keys -t "$SESSION:0.1" "npm run watch:tsc" Enter
tmux send-keys -t "$SESSION:0.2" "npm run dev:webview" Enter
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
