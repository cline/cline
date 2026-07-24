#!/usr/bin/env bash

set -Eeuo pipefail

SESSION="${CLINE_EXTENSION_HOST_SESSION:-cline-dev}"
WORKSPACE="${CLINE_WORKSPACE:-$(cd "$(dirname "$0")/.." && pwd)}"
ENVIRONMENT="${CLINE_ENVIRONMENT:-production}"
MODE="${CLINE_EXTENSION_HOST_MODE:-auto}"
CHECK_ONLY=false

usage() {
  cat <<'EOF'
Usage: bash scripts/run-extension-host.sh [--check]

Build and launch the Cline Extension Development Host. When tmux is installed,
the launcher uses four panes. Otherwise it automatically runs the watchers in
the current shell and writes their output to a private temporary log directory.

Options:
  --check  Validate the launcher and print the non-secret demo configuration
           without building, opening VS Code, or contacting an API.

Environment:
  CLINE_EXTENSION_HOST_MODE=auto|tmux|plain
  CLINE_EXTENSION_HOST_SESSION=<tmux-session-name>
  CLINE_EXTENSION_HOST_USER_DATA_DIR=<persistent-isolated-profile>
  CLINE_EXTENSION_HOST_EXTENSIONS_DIR=<persistent-isolated-extensions-dir>
EOF
}

case "${1:-}" in
  "")
    ;;
  --check)
    CHECK_ONLY=true
    ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

case "$MODE" in
  auto)
    if command -v tmux >/dev/null 2>&1; then
      MODE="tmux"
    else
      MODE="plain"
    fi
    ;;
  tmux)
    if ! command -v tmux >/dev/null 2>&1; then
      echo "CLINE_EXTENSION_HOST_MODE=tmux was requested, but tmux is not installed." >&2
      exit 1
    fi
    ;;
  plain)
    ;;
  *)
    echo "CLINE_EXTENSION_HOST_MODE must be auto, tmux, or plain (got: $MODE)." >&2
    exit 2
    ;;
esac

for dependency in bun code; do
  if ! command -v "$dependency" >/dev/null 2>&1; then
    echo "Required command not found: $dependency" >&2
    exit 1
  fi
done

cd "$WORKSPACE"

# The command-line environment wins over .env for the local demo controls.
local_api_was_set="${CLINE_LOCAL_API_BASE_URL+x}"
local_api_value="${CLINE_LOCAL_API_BASE_URL:-}"
auto_picker_was_set="${CLINE_AUTO_MODEL_PICKER_ENABLED+x}"
auto_picker_value="${CLINE_AUTO_MODEL_PICKER_ENABLED:-}"
pass_picker_was_set="${CLINE_PASS_AUTO_MODEL_PICKER_ENABLED+x}"
pass_picker_value="${CLINE_PASS_AUTO_MODEL_PICKER_ENABLED:-}"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

export IS_DEV=true
export DEV_WORKSPACE_FOLDER="$WORKSPACE"
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

echo "Extension Host launcher check:"
echo "  workspace: $WORKSPACE"
echo "  process mode: $MODE"
echo "  CLINE_ENVIRONMENT: $CLINE_ENVIRONMENT"
echo "  CLINE_LOCAL_API_BASE_URL: ${CLINE_LOCAL_API_BASE_URL:-<default>}"
echo "  CLINE_AUTO_MODEL_PICKER_ENABLED: ${CLINE_AUTO_MODEL_PICKER_ENABLED:-false}"
echo "  CLINE_PASS_AUTO_MODEL_PICKER_ENABLED: ${CLINE_PASS_AUTO_MODEL_PICKER_ENABLED:-false}"

if [ "$CHECK_ONLY" = true ]; then
  echo "Check complete. No build, VS Code launch, or API request was made."
  exit 0
fi

if [ "$CLINE_ENVIRONMENT" = "local" ] &&
  { [ "${CLINE_AUTO_MODEL_PICKER_ENABLED:-}" != "true" ] ||
    [ "${CLINE_PASS_AUTO_MODEL_PICKER_ENABLED:-}" != "true" ]; }; then
  echo "Warning: one or both local auto-router picker entries are disabled." >&2
fi

echo "Building protos..."
bun run protos || { echo "Protos build failed" >&2; exit 1; }

echo "Building webview..."
bun run build:webview || { echo "Webview build failed" >&2; exit 1; }

echo "Building extension..."
bun esbuild.mjs || { echo "Extension build failed" >&2; exit 1; }

runtime_root="$(mktemp -d "${TMPDIR:-/tmp}/cline-extension-host.XXXXXX")"
log_dir="$runtime_root/logs"
mkdir -p "$log_dir"
chmod 700 "$runtime_root" "$log_dir"

remove_user_data_dir=true
if [ -n "${CLINE_EXTENSION_HOST_USER_DATA_DIR:-}" ]; then
  user_data_dir="$CLINE_EXTENSION_HOST_USER_DATA_DIR"
  remove_user_data_dir=false
else
  user_data_dir="$runtime_root/user-data"
fi

remove_extensions_dir=true
if [ -n "${CLINE_EXTENSION_HOST_EXTENSIONS_DIR:-}" ]; then
  extensions_dir="$CLINE_EXTENSION_HOST_EXTENSIONS_DIR"
  remove_extensions_dir=false
else
  extensions_dir="$runtime_root/extensions"
fi

mkdir -p "$user_data_dir" "$extensions_dir"
watcher_pids=()
cleaned_up=false

escape_ere() {
  sed 's/[][\\.^$*+?(){}|]/\\&/g' <<<"$1"
}

user_data_process_pattern="$(escape_ere "$user_data_dir")"

process_tree_has_renderer() {
  local child command_line depth pid
  pid="$1"
  depth="${2:-0}"
  if [ "$depth" -gt 12 ]; then
    return 1
  fi

  command_line="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  if [[ "$command_line" == *"--type=renderer"* ]]; then
    return 0
  fi

  while IFS= read -r child; do
    if [ -n "$child" ] && process_tree_has_renderer "$child" "$((depth + 1))"; then
      return 0
    fi
  done < <(pgrep -P "$pid" 2>/dev/null || true)
  return 1
}

isolated_renderer_is_running() {
  local pid
  while IFS= read -r pid; do
    if [ -z "$pid" ] || [ "$pid" = "$$" ]; then
      continue
    fi
    # The macOS Electron main process has the isolated --user-data-dir, while
    # its renderer can omit that argument. Walk descendants instead of only
    # matching the renderer's own command line.
    if process_tree_has_renderer "$pid"; then
      return 0
    fi
  done < <(pgrep -f -- "$user_data_process_pattern" 2>/dev/null || true)
  return 1
}

wait_for_isolated_renderer_start() {
  local attempt
  for attempt in {1..100}; do
    if isolated_renderer_is_running; then
      return 0
    fi
    sleep 0.1
  done
  return 1
}

stop_isolated_extension_host() {
  local all_stopped attempt pid
  local isolated_pids=()
  while IFS= read -r pid; do
    if [ -n "$pid" ] && [ "$pid" != "$$" ]; then
      isolated_pids+=("$pid")
      kill "$pid" 2>/dev/null || true
    fi
  done < <(pgrep -f -- "$user_data_process_pattern" 2>/dev/null || true)

  for attempt in {1..50}; do
    all_stopped=true
    for pid in "${isolated_pids[@]:-}"; do
      if kill -0 "$pid" 2>/dev/null; then
        all_stopped=false
        break
      fi
    done
    if [ "$all_stopped" = true ]; then
      return
    fi
    sleep 0.1
  done

  # These PIDs were resolved from the launcher's unique temporary profile.
  # Force-stop only that isolated instance if Electron ignores termination.
  for pid in "${isolated_pids[@]:-}"; do
    kill -KILL "$pid" 2>/dev/null || true
  done
}

cleanup() {
  if [ "$cleaned_up" = true ]; then
    return
  fi
  cleaned_up=true

  if [ "$MODE" = "tmux" ]; then
    tmux kill-session -t "$SESSION" 2>/dev/null || true
  fi

  local pid
  for pid in "${watcher_pids[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
  for pid in "${watcher_pids[@]:-}"; do
    wait "$pid" 2>/dev/null || true
  done

  stop_isolated_extension_host

  if [ "$remove_user_data_dir" = true ]; then
    find "$user_data_dir" -depth -delete 2>/dev/null || true
  fi
  if [ "$remove_extensions_dir" = true ]; then
    find "$extensions_dir" -depth -delete 2>/dev/null || true
  fi
  find "$log_dir" -depth -delete 2>/dev/null || true
  rmdir "$runtime_root" 2>/dev/null || true
  echo "Stopped"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

code_args=(
  code
  --wait
  --new-window
  --user-data-dir "$user_data_dir"
  --extensions-dir "$extensions_dir"
  --extensionDevelopmentPath="$WORKSPACE"
  --disable-workspace-trust
  --disable-extension saoudrizwan.claude-dev
  --disable-extension saoudrizwan.cline-nightly
  "$WORKSPACE"
)

if [ "$MODE" = "plain" ]; then
  echo "tmux is unavailable or plain mode was selected."
  echo "Watcher logs: $log_dir"

  watcher_names=(esbuild tsc webview)
  bun run watch:esbuild >"$log_dir/esbuild.log" 2>&1 &
  watcher_pids+=("$!")
  bun run watch:tsc >"$log_dir/tsc.log" 2>&1 &
  watcher_pids+=("$!")
  bun run dev:webview >"$log_dir/webview.log" 2>&1 &
  watcher_pids+=("$!")

  # Catch missing dependencies and occupied dev-server ports before VS Code
  # opens. The complete log remains available until this launcher exits.
  sleep 1
  for index in 0 1 2; do
    if ! kill -0 "${watcher_pids[$index]}" 2>/dev/null; then
      watcher_name="${watcher_names[$index]}"
      echo "$watcher_name watcher failed to start:" >&2
      tail -n 40 "$log_dir/$watcher_name.log" >&2 || true
      exit 1
    fi
  done

  echo "Launching isolated Extension Development Host..."
  echo "Close the Extension Development Host window or press Ctrl+C here to stop."
  code_started_at=$SECONDS
  code_status=0
  "${code_args[@]}" || code_status=$?
  code_elapsed_seconds=$((SECONDS - code_started_at))

  if [ "$code_status" -ne 0 ]; then
    echo "VS Code exited with status $code_status." >&2
    exit "$code_status"
  fi

  # On some macOS launches the VS Code CLI returns 0 before its isolated
  # renderer is ready, even with --wait. Without this handoff the EXIT trap
  # immediately tears down the profile and the user never sees a window.
  monitor_renderer=false
  if [ "$code_elapsed_seconds" -lt 5 ]; then
    if wait_for_isolated_renderer_start; then
      monitor_renderer=true
    else
      echo "VS Code CLI returned before startup; retrying once."
      stop_isolated_extension_host
      code_started_at=$SECONDS
      code_status=0
      "${code_args[@]}" || code_status=$?
      code_elapsed_seconds=$((SECONDS - code_started_at))

      if [ "$code_status" -ne 0 ]; then
        echo "VS Code retry exited with status $code_status." >&2
        exit "$code_status"
      fi

      if [ "$code_elapsed_seconds" -lt 5 ]; then
        if ! wait_for_isolated_renderer_start; then
          echo "VS Code returned before an isolated Extension Development Host started." >&2
          exit 1
        fi
        monitor_renderer=true
      fi
    fi
  fi

  if [ "$monitor_renderer" = true ]; then
    if ! isolated_renderer_is_running; then
      echo "VS Code returned before an isolated Extension Development Host started." >&2
      exit 1
    fi

    echo "VS Code CLI returned early; monitoring the isolated Extension Development Host."
    while isolated_renderer_is_running; do
      sleep 1
    done
  fi
else
  if tmux has-session -t "$SESSION" 2>/dev/null; then
    echo "tmux session '$SESSION' already exists." >&2
    echo "Attach with 'tmux attach-session -t $SESSION' or choose another CLINE_EXTENSION_HOST_SESSION." >&2
    exit 1
  fi

  echo "Starting tmux session..."
  tmux new-session -d -s "$SESSION" -c "$WORKSPACE"
  tmux split-window -h -t "$SESSION" -c "$WORKSPACE"
  tmux split-window -h -t "$SESSION:0.0" -c "$WORKSPACE"
  tmux split-window -h -t "$SESSION:0.2" -c "$WORKSPACE"
  tmux select-layout -t "$SESSION" even-horizontal
  tmux bind-key -T root C-c kill-session

  printf -v quoted_code_command '%q ' "${code_args[@]}"
  tmux send-keys -t "$SESSION:0.0" "bun run watch:esbuild" Enter
  tmux send-keys -t "$SESSION:0.1" "bun run watch:tsc" Enter
  tmux send-keys -t "$SESSION:0.2" "bun run dev:webview" Enter
  tmux send-keys -t "$SESSION:0.3" "echo 'Launching isolated Extension Development Host...' && $quoted_code_command" Enter

  echo "Ctrl+C inside tmux stops this launcher and its isolated Extension Host."
  tmux attach-session -t "$SESSION"
fi
