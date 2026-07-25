#!/usr/bin/env bash
# Provider QA environment manager.
#
# Owns the lifecycle of the VS Code instance under test so that a QA run never
# has to type a `code` command by hand: two instances sharing a profile attach
# to each other, and you end up testing a window you did not configure.
#
# Usage:
#   qa-env.sh doctor
#   qa-env.sh proxy start|stop|status|reset|tail
#   qa-env.sh start <name> [--keys FILE] [--select PROVIDER] [--no-proxy]
#   qa-env.sh stop [<name>]
#   qa-env.sh recover
#   qa-env.sh status
#   qa-env.sh state <name>
#   qa-env.sh select <name> <provider> [model]
#   qa-env.sh reset-workspace <name>
#   qa-env.sh run <name> <prompt...>

set -uo pipefail

FIXTURES="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$FIXTURES/../../../.." && pwd)"
QA_ROOT="${QA_ROOT:-/tmp/cline-qa}"
PROXY_PORT="${QA_PROXY_PORT:-8788}"
PROXY_DIR="$QA_ROOT/proxy"
PROXY_PID="$PROXY_DIR/proxy.pid"
PROXY_LOG="$PROXY_DIR/proxy.out"
PROXY_REQUESTS="$PROXY_DIR/requests.jsonl"
EXT_PATH="$REPO_ROOT/apps/vscode"
QA_DISPLAY="${QA_DISPLAY:-:1}"

log()  { printf '%s\n' "$*"; }
ok()   { printf 'ok    %s\n' "$*"; }
warn() { printf 'warn  %s\n' "$*"; }
bad()  { printf 'FAIL  %s\n' "$*"; }

instance_root() { printf '%s/%s\n' "$QA_ROOT" "$1"; }

# ---------------------------------------------------------------- doctor

cmd_doctor() {
  local failures=0

  for tool in bun node git code tmux; do
    if command -v "$tool" >/dev/null 2>&1; then
      ok "$tool -> $(command -v "$tool")"
    else
      bad "$tool not found on PATH"
      failures=$((failures + 1))
    fi
  done

  if xdpyinfo -display "$QA_DISPLAY" >/dev/null 2>&1; then
    ok "X display $QA_DISPLAY is live"
  else
    bad "X display $QA_DISPLAY is not answering (GUI cases cannot run)"
    failures=$((failures + 1))
  fi

  if [ -f "$EXT_PATH/dist/extension.js" ]; then
    ok "extension bundle present ($(du -h "$EXT_PATH/dist/extension.js" | cut -f1))"
  else
    bad "missing $EXT_PATH/dist/extension.js — run: cd apps/vscode && bun esbuild.mjs"
    failures=$((failures + 1))
  fi

  if [ -d "$EXT_PATH/webview-ui/build" ]; then
    ok "webview build present"
  else
    bad "missing $EXT_PATH/webview-ui/build — run: cd apps/vscode && bun run build:webview"
    failures=$((failures + 1))
  fi

  if ls "$EXT_PATH"/dist-standalone/ripgrep-binaries/*/rg >/dev/null 2>&1; then
    ok "bundled ripgrep present"
  else
    warn "no bundled ripgrep — search_codebase may fail (cd apps/vscode && bun run download-ripgrep)"
  fi

  if [ -d "$REPO_ROOT/sdk/packages/core/dist" ]; then
    ok "sdk dist present"
  else
    warn "sdk dist missing — run: bun run build:sdk"
  fi

  if mkdir -p "$QA_ROOT" 2>/dev/null; then
    ok "$QA_ROOT writable"
  else
    bad "$QA_ROOT not writable"
    failures=$((failures + 1))
  fi

  if proxy_running; then
    ok "mock proxy already listening on $PROXY_PORT"
  elif port_busy "$PROXY_PORT"; then
    bad "port $PROXY_PORT is held by something that is not our proxy"
    failures=$((failures + 1))
  else
    ok "port $PROXY_PORT free"
  fi

  local running
  running="$(count_instances)"
  if [ "$running" -gt 1 ]; then
    bad "$running VS Code QA instances are running — expected 0 or 1"
    failures=$((failures + 1))
  else
    ok "$running VS Code QA instance(s) running"
  fi

  if [ "$failures" -eq 0 ]; then
    log ""
    log "doctor: clean"
    return 0
  fi
  log ""
  log "doctor: $failures problem(s)"
  return 1
}

# ---------------------------------------------------------------- proxy

port_busy() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | grep -q ":$port "
  else
    netstat -ltn 2>/dev/null | grep -q ":$port "
  fi
}

proxy_running() {
  [ -f "$PROXY_PID" ] || return 1
  local pid
  pid="$(cat "$PROXY_PID" 2>/dev/null)"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null
}

cmd_proxy() {
  local action="${1:-status}"
  mkdir -p "$PROXY_DIR"
  case "$action" in
    start)
      if proxy_running; then
        log "proxy already running (pid $(cat "$PROXY_PID"))"
        return 0
      fi
      if port_busy "$PROXY_PORT"; then
        bad "port $PROXY_PORT already in use by a foreign process"
        return 1
      fi
      local workspace="${QA_PROXY_WORKSPACE:-$QA_ROOT/tools/workspace}"
      mkdir -p "$workspace"
      : > "$PROXY_REQUESTS"
      nohup node "$FIXTURES/mock-provider.mjs" \
        --port "$PROXY_PORT" \
        --workspace "$workspace" \
        --log "$PROXY_REQUESTS" \
        >"$PROXY_LOG" 2>&1 &
      echo $! > "$PROXY_PID"
      sleep 0.6
      if proxy_running; then
        log "proxy started (pid $(cat "$PROXY_PID")) on http://127.0.0.1:$PROXY_PORT"
        log "  workspace: $workspace"
        return 0
      fi
      bad "proxy failed to start; see $PROXY_LOG"
      cat "$PROXY_LOG" 2>/dev/null
      return 1
      ;;
    stop)
      if proxy_running; then
        local pid
        pid="$(cat "$PROXY_PID")"
        kill "$pid" 2>/dev/null
        sleep 0.4
        rm -f "$PROXY_PID"
        log "proxy stopped (pid $pid)"
      else
        log "proxy not running"
      fi
      ;;
    status)
      if proxy_running; then
        log "proxy running (pid $(cat "$PROXY_PID"))"
        curl -sS "http://127.0.0.1:$PROXY_PORT/__health" && echo
      else
        log "proxy not running"
      fi
      ;;
    reset)
      if proxy_running; then
        curl -sS -X POST "http://127.0.0.1:$PROXY_PORT/__reset" >/dev/null && log "proxy request log reset"
      else
        : > "$PROXY_REQUESTS"
        log "proxy not running; cleared $PROXY_REQUESTS"
      fi
      ;;
    tail)
      if [ ! -s "$PROXY_REQUESTS" ]; then
        log "no proxy requests recorded yet ($PROXY_REQUESTS)"
        return 0
      fi
      # Streamed line by line: a stuck loop can make this file far larger than
      # the maximum string length, and reading it whole would just crash.
      node -e '
        const fs = require("fs");
        const readline = require("readline");
        const rl = readline.createInterface({
          input: fs.createReadStream(process.argv[1]),
          crlfDelay: Infinity,
        });
        let i = 0;
        rl.on("line", (line) => {
          if (!line.trim()) return;
          i += 1;
          let e;
          try { e = JSON.parse(line); } catch { console.log(`--- request ${i}: unparseable`); return; }
          console.log(`--- request ${i} [${e.at}] ${e.api} ${e.path}`);
          console.log(`    model:    ${e.model}`);
          console.log(`    phase:    ${e.phase}`);
          console.log(`    messages: ${e.messageCount ?? "?"} (${e.bodyBytes ?? "?"} bytes)`);
          console.log(`    tools:    ${(e.toolsAdvertised || []).join(", ") || "(none)"}`);
          for (const [j, t] of (e.toolResultsSeen || []).entries()) {
            console.log(`    result[${j}]: ${JSON.stringify(String(t).slice(0, 300))}`);
          }
        });
        rl.on("close", () => console.log(`\n${i} request(s) recorded`));
      ' "$PROXY_REQUESTS"
      ;;
    tools)
      # Objective check of what the host advertised on its most recent request.
      # In Act mode the list contains `editor`; in Plan mode it contains
      # `switch_to_act_mode` instead, which is the reliable way to tell the two
      # apart without trusting the UI's highlight.
      node -e '
        const fs = require("fs");
        const readline = require("readline");
        const rl = readline.createInterface({
          input: fs.createReadStream(process.argv[1]),
          crlfDelay: Infinity,
        });
        let last;
        rl.on("line", (line) => {
          if (!line.trim()) return;
          try { last = JSON.parse(line); } catch {}
        });
        rl.on("close", () => {
          if (!last) { console.log("no requests recorded yet"); return; }
          const tools = last.toolsAdvertised || [];
          console.log(`last request: ${last.at} model=${last.model} phase=${last.phase}`);
          console.log(`tools advertised (${tools.length}):`);
          for (const t of tools) console.log(`  ${t}`);
          const hasEditor = tools.includes("editor");
          const hasSwitch = tools.includes("switch_to_act_mode");
          console.log(`\neditor advertised:            ${hasEditor}`);
          console.log(`switch_to_act_mode advertised: ${hasSwitch}`);
          console.log(`inferred mode: ${hasEditor ? "act" : hasSwitch ? "plan" : "unknown"}`);
        });
      ' "$PROXY_REQUESTS"
      ;;
    requests)
      cat "$PROXY_REQUESTS"
      ;;
    *)
      bad "unknown proxy action: $action"
      return 2
      ;;
  esac
}

# ---------------------------------------------------------------- workspace

seed_workspace() {
  local ws="$1"
  mkdir -p "$ws"
  printf 'export const name = "john"\n' > "$ws/qa.txt"
  printf 'alpha placeholder\n' > "$ws/a.txt"
  printf 'beta placeholder\n'  > "$ws/b.txt"
  printf 'gamma placeholder\n' > "$ws/c.txt"
  cat > "$ws/README.md" <<'EOF'
# provider QA workspace

Scratch workspace for provider tool-calling QA. `qa.txt` is the canonical
target; `a.txt`/`b.txt`/`c.txt` back the multi-tool case.
EOF
}

git_init_workspace() {
  local ws="$1"
  if [ ! -d "$ws/.git" ]; then
    git -C "$ws" init -q
  fi
  git -C "$ws" add -A
  git -C "$ws" -c user.email=qa@x -c user.name=qa commit -qm base 2>/dev/null || true
}

cmd_reset_workspace() {
  local name="${1:?usage: qa-env.sh reset-workspace <name>}"
  local ws
  ws="$(instance_root "$name")/workspace"
  [ -d "$ws" ] || { bad "no workspace at $ws"; return 1; }
  git -C "$ws" checkout -- . 2>/dev/null
  git -C "$ws" clean -fdq 2>/dev/null
  log "workspace reset: $ws"
  git -C "$ws" status --short
}

# ---------------------------------------------------------------- instances

count_instances() {
  local n=0
  for pidfile in "$QA_ROOT"/*/vscode.pid; do
    [ -f "$pidfile" ] || continue
    local pid
    pid="$(cat "$pidfile" 2>/dev/null)"
    [ -n "$pid" ] || continue
    if kill -0 "$pid" 2>/dev/null; then
      n=$((n + 1))
    fi
  done
  printf '%s\n' "$n"
}

# Seeds an instance directory (workspace + git baseline + provider config)
# without launching any editor. Used for headless CLI cases.
cmd_prepare() {
  local name="" keys="" select="" use_proxy=1
  name="${1:?usage: qa-env.sh prepare <name> [--keys FILE] [--select PROVIDER]}"
  shift
  while [ $# -gt 0 ]; do
    case "$1" in
      --keys)   keys="$2"; shift 2 ;;
      --select) select="$2"; shift 2 ;;
      --no-proxy) use_proxy=0; shift ;;
      *) bad "unknown prepare option: $1"; return 2 ;;
    esac
  done

  local root data ws
  root="$(instance_root "$name")"
  data="$root/data"; ws="$root/workspace"
  mkdir -p "$data"
  seed_workspace "$ws"
  git_init_workspace "$ws"

  if [ -n "$keys" ]; then
    if [ -n "$select" ]; then
      node "$FIXTURES/apply-keys.mjs" --keys "$keys" --dir "$data" --select "$select" || return 1
    else
      node "$FIXTURES/apply-keys.mjs" --keys "$keys" --dir "$data" || return 1
    fi
  fi

  if [ "$use_proxy" -eq 1 ]; then
    QA_PROXY_WORKSPACE="$ws" cmd_proxy start || warn "proxy did not start"
  fi

  log "prepared instance '$name' (no editor launched)"
  log "  workspace:      $ws"
  log "  cline data dir: $data"
}

cmd_start() {
  local name="" keys="" select="" use_proxy=1
  name="${1:?usage: qa-env.sh start <name> [--keys FILE] [--select PROVIDER]}"
  shift
  local prepare_args=("$name")
  while [ $# -gt 0 ]; do
    case "$1" in
      --keys)   keys="$2"; prepare_args+=(--keys "$2"); shift 2 ;;
      --select) select="$2"; prepare_args+=(--select "$2"); shift 2 ;;
      --no-proxy) use_proxy=0; prepare_args+=(--no-proxy); shift ;;
      *) bad "unknown start option: $1"; return 2 ;;
    esac
  done

  local running
  running="$(count_instances)"
  if [ "$running" -gt 0 ]; then
    bad "$running instance(s) already running — run 'qa-env.sh stop' first"
    return 1
  fi

  cmd_prepare "${prepare_args[@]}" || return 1

  local root data ws userdata extdir
  root="$(instance_root "$name")"
  data="$root/data"; ws="$root/workspace"
  userdata="$root/userdata"; extdir="$root/extensions"
  mkdir -p "$userdata" "$extdir"

  # VS Code writes its own state under userdata; the Cline data dir is separate
  # so provider config can be re-seeded without discarding editor state.
  #
  # Both CLINE_DIR and CLINE_DATA_DIR are set because the extension resolves the
  # data directory in two places that disagree: the SDK-side reader honours
  # CLINE_DATA_DIR, while the StateManager-backed storage context only looks at
  # CLINE_DIR (falling back to ~/.cline). Setting just one leaks the UI's own
  # provider selection into the real home directory.
  local out="$root/vscode.out"
  DISPLAY="$QA_DISPLAY" CLINE_DATA_DIR="$data" CLINE_DIR="$root" \
  nohup code \
    --no-sandbox \
    --disable-gpu-sandbox \
    --disable-workspace-trust \
    --skip-release-notes \
    --skip-welcome \
    --disable-telemetry \
    --user-data-dir "$userdata" \
    --extensions-dir "$extdir" \
    --extensionDevelopmentPath="$EXT_PATH" \
    "$ws" \
    >"$out" 2>&1 &
  local pid=$!
  echo "$pid" > "$root/vscode.pid"
  printf '%s\n' "$name" > "$QA_ROOT/current"

  local waited=0
  while [ "$waited" -lt 40 ]; do
    if ! kill -0 "$pid" 2>/dev/null; then
      bad "VS Code exited immediately; see $out"
      tail -20 "$out" 2>/dev/null
      rm -f "$root/vscode.pid"
      return 1
    fi
    if xdotool search --onlyvisible --class 'code' >/dev/null 2>&1; then
      break
    fi
    sleep 1
    waited=$((waited + 1))
  done

  log "started instance '$name' (pid $pid)"
  log "  workspace:      $ws"
  log "  cline data dir: $data"
  log "  user data dir:  $userdata"
  log "  log:            $out"
}

cmd_stop() {
  local name="${1:-}"
  local pidfiles=()
  if [ -n "$name" ]; then
    pidfiles=("$(instance_root "$name")/vscode.pid")
  else
    for f in "$QA_ROOT"/*/vscode.pid; do [ -f "$f" ] && pidfiles+=("$f"); done
  fi
  if [ "${#pidfiles[@]}" -eq 0 ]; then
    log "no tracked instances"
    return 0
  fi
  for pidfile in "${pidfiles[@]}"; do
    [ -f "$pidfile" ] || continue
    local pid
    pid="$(cat "$pidfile" 2>/dev/null)"
    if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$pidfile"
      continue
    fi
    # Graceful only. A hard kill corrupts the profile and the next start
    # silently attaches to a half-dead instance.
    kill -TERM "$pid" 2>/dev/null
    local waited=0
    while [ "$waited" -lt 20 ] && kill -0 "$pid" 2>/dev/null; do
      sleep 1
      waited=$((waited + 1))
    done
    if kill -0 "$pid" 2>/dev/null; then
      bad "pid $pid still alive after 20s of SIGTERM — run 'qa-env.sh recover'"
    else
      rm -f "$pidfile"
      log "stopped pid $pid"
    fi
  done
  rm -f "$QA_ROOT/current"
}

cmd_recover() {
  log "recover: escalating on tracked pids only"
  for pidfile in "$QA_ROOT"/*/vscode.pid; do
    [ -f "$pidfile" ] || continue
    local pid
    pid="$(cat "$pidfile" 2>/dev/null)"
    [ -n "$pid" ] || { rm -f "$pidfile"; continue; }
    if kill -0 "$pid" 2>/dev/null; then
      kill -TERM "$pid" 2>/dev/null
      sleep 3
    fi
    if kill -0 "$pid" 2>/dev/null; then
      warn "pid $pid ignored SIGTERM; sending SIGKILL as the documented last resort"
      kill -KILL "$pid" 2>/dev/null
      sleep 1
    fi
    rm -f "$pidfile"
  done
  for root in "$QA_ROOT"/*/; do
    [ -d "${root}userdata" ] || continue
    rm -f "${root}userdata"/*.lock 2>/dev/null
    rm -rf "${root}userdata/Crashpad" 2>/dev/null
  done
  rm -f "$QA_ROOT/current"
  log "recover: done; $(count_instances) instance(s) running"
}

cmd_status() {
  local n
  n="$(count_instances)"
  log "tracked VS Code QA instances running: $n"
  for pidfile in "$QA_ROOT"/*/vscode.pid; do
    [ -f "$pidfile" ] || continue
    local pid name
    pid="$(cat "$pidfile" 2>/dev/null)"
    name="$(basename "$(dirname "$pidfile")")"
    if kill -0 "$pid" 2>/dev/null; then
      log "  $name: pid $pid (alive)"
    else
      log "  $name: pid $pid (dead, stale pidfile)"
    fi
  done
  if proxy_running; then
    log "mock proxy: running (pid $(cat "$PROXY_PID"))"
  else
    log "mock proxy: stopped"
  fi
}

cmd_state() {
  local name="${1:?usage: qa-env.sh state <name>}"
  local data
  data="$(instance_root "$name")/data"
  node -e '
    const fs = require("fs");
    const path = require("path");
    const dataDir = process.argv[1];
    const providersPath = path.join(dataDir, "settings", "providers.json");
    const read = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return undefined; } };
    const providers = read(providersPath);
    if (!providers) {
      console.log(`no providers.json at ${providersPath}`);
    } else {
      const active = providers.lastUsedProvider;
      console.log(`lastUsedProvider: ${active ?? "(unset)"}`);
      const entry = active ? providers.providers?.[active] : undefined;
      if (entry) {
        const s = entry.settings ?? {};
        console.log(`  provider: ${s.provider}`);
        console.log(`  model:    ${s.model ?? "(unset)"}`);
        console.log(`  baseUrl:  ${s.baseUrl ?? "(default)"}`);
        console.log(`  protocol: ${s.protocol ?? "(inferred)"}`);
        console.log(`  apiKey:   ${s.apiKey ? `set (${String(s.apiKey).slice(0, 6)}…, ${String(s.apiKey).length} chars)` : "(unset)"}`);
      }
      console.log(`  configured: ${Object.keys(providers.providers ?? {}).join(", ")}`);
    }
    // The UI-owned selection can land in either root, because the extension
    // resolves the data dir inconsistently. Report whichever one holds it: the
    // legacy globalState values win over providers.json for credentials.
    const keys = ["actModeApiProvider", "planModeApiProvider", "actModeApiModelId", "planModeApiModelId",
      "actModeOpenAiModelId", "planModeOpenAiModelId", "openAiBaseUrl", "mode"];
    const roots = [
      ["instance", path.join(dataDir, "globalState.json")],
      ["home fallback", path.join(process.env.HOME || "", ".cline", "data", "globalState.json")],
    ];
    for (const [label, file] of roots) {
      const gs = read(file);
      if (!gs) continue;
      const present = keys.filter((k) => gs[k] !== undefined);
      if (present.length === 0) continue;
      console.log(`globalState (UI-owned) [${label}] ${file}:`);
      for (const k of present) console.log(`  ${k}: ${JSON.stringify(gs[k])}`);
    }
  ' "$data"
}

cmd_select() {
  local name="${1:?usage: qa-env.sh select <name> <provider> [model]}"
  local provider="${2:?usage: qa-env.sh select <name> <provider> [model]}"
  local model="${3:-}"
  local data
  data="$(instance_root "$name")/data"
  node -e '
    const fs = require("fs");
    const path = require("path");
    const [dataDir, provider, model] = process.argv.slice(1);
    const p = path.join(dataDir, "settings", "providers.json");
    const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!cfg.providers?.[provider]) {
      console.error(`provider ${provider} is not configured in ${p}`);
      process.exit(1);
    }
    cfg.lastUsedProvider = provider;
    if (model) cfg.providers[provider].settings.model = model;
    fs.writeFileSync(p, `${JSON.stringify(cfg, null, 2)}\n`);
    console.log(`selected ${provider} (model ${cfg.providers[provider].settings.model ?? "unset"})`);
  ' "$data" "$provider" "$model"
}

# Headless equivalent of sending the prompt in the UI. Runs the CLI from source
# with the instance's Cline data dir and the instance workspace as the cwd, so
# relative commands inside tool calls resolve the same way the UI resolves them.
cmd_run() {
  local name="${1:?usage: qa-env.sh run <name> <prompt...>}"
  shift
  local root data ws
  root="$(instance_root "$name")"
  data="$root/data"; ws="$root/workspace"
  ( cd "$ws" \
    && CLINE_DATA_DIR="$data" CLINE_BUILD_ENV=development \
       timeout "${QA_RUN_TIMEOUT:-300}" \
       bun --conditions=development "$REPO_ROOT/apps/cli/src/index.ts" \
         --cwd "$ws" --auto-approve true "$*" )
}

# ---------------------------------------------------------------- dispatch

main() {
  local cmd="${1:-help}"
  shift || true
  case "$cmd" in
    doctor)          cmd_doctor "$@" ;;
    proxy)           cmd_proxy "$@" ;;
    prepare)         cmd_prepare "$@" ;;
    start)           cmd_start "$@" ;;
    stop)            cmd_stop "$@" ;;
    recover)         cmd_recover "$@" ;;
    status)          cmd_status "$@" ;;
    state)           cmd_state "$@" ;;
    select)          cmd_select "$@" ;;
    reset-workspace) cmd_reset_workspace "$@" ;;
    run)             cmd_run "$@" ;;
    help|--help|-h)
      sed -n '2,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      ;;
    *)
      bad "unknown command: $cmd"
      return 2
      ;;
  esac
}

main "$@"
