#!/usr/bin/env bash
# Provider QA environment harness.
#
# Owns every VS Code launch in a QA run so that exactly one instance, with a
# known profile and a known Cline data directory, is ever under test. Also owns
# the fault-injection proxy and reports what the extension actually has
# configured.
#
#   qa-env.sh doctor
#   qa-env.sh proxy start|stop|status|models|count|reset|log
#   qa-env.sh start <profile> [--keys FILE] [--select PROVIDER] [--model ID] [--price]
#   qa-env.sh stop | recover | status
#   qa-env.sh state <profile>
#   qa-env.sh model <profile> <model-id>      # set the model id without the UI
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
QA_ROOT="${QA_ROOT:-/tmp/qa-profiles}"
PROXY_PORT="${QA_PROXY_PORT:-8788}"
PROXY_LOG_DIR="${QA_PROXY_LOG_DIR:-/tmp/qa-proxy}"
PROXY_REQUESTS="$PROXY_LOG_DIR/requests.jsonl"
PROXY_STDOUT="$PROXY_LOG_DIR/proxy.log"
PROXY_PID_FILE="$PROXY_LOG_DIR/proxy.pid"
EXTENSION_ID="saoudrizwan.claude-dev"
CODE_BIN="${QA_CODE_BIN:-code}"
DISPLAY_ID="${QA_DISPLAY:-:1}"

green() { printf '\033[32m%s\033[0m\n' "$*"; }
red() { printf '\033[31m%s\033[0m\n' "$*"; }
info() { printf '%s\n' "$*"; }

profile_dir() { printf '%s/%s' "$QA_ROOT" "$1"; }

# Every VS Code process belonging to a QA profile carries its user-data-dir on
# the command line, which is how instances are counted and stopped.
instance_pids() {
	pgrep -f -- "--user-data-dir=$QA_ROOT" 2>/dev/null | sort -n
}

main_instance_pids() {
	local pid cmd
	for pid in $(instance_pids); do
		cmd="$(tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null)"
		[[ -z "$cmd" ]] && continue
		case "$cmd" in
		*--type=*) continue ;;
		esac
		printf '%s\n' "$pid"
	done
}

# ---------------------------------------------------------------- doctor

cmd_doctor() {
	local failures=0
	local warnings=0

	if command -v node >/dev/null; then
		green "OK    node $(node --version)"
	else
		red "FAIL  node is not installed"
		failures=$((failures + 1))
	fi

	if command -v bun >/dev/null; then
		green "OK    bun $(bun --version)"
	else
		info "WARN  bun is not installed (only needed for repo scripts)"
		warnings=$((warnings + 1))
	fi

	if command -v "$CODE_BIN" >/dev/null; then
		green "OK    $CODE_BIN $("$CODE_BIN" --version 2>/dev/null | head -1)"
	else
		red "FAIL  $CODE_BIN not on PATH"
		failures=$((failures + 1))
	fi

	local extensions
	extensions="$("$CODE_BIN" --no-sandbox --list-extensions --show-versions 2>/dev/null)"
	if grep -qi "^$EXTENSION_ID@" <<<"$extensions"; then
		green "OK    extension installed $(grep -i "^$EXTENSION_ID@" <<<"$extensions" | head -1)"
	else
		red "FAIL  extension $EXTENSION_ID is not installed"
		failures=$((failures + 1))
	fi

	if DISPLAY="$DISPLAY_ID" xdpyinfo >/dev/null 2>&1; then
		green "OK    X display $DISPLAY_ID $(DISPLAY="$DISPLAY_ID" xdpyinfo 2>/dev/null | awk '/dimensions:/{print $2}')"
	else
		red "FAIL  X display $DISPLAY_ID is not reachable"
		failures=$((failures + 1))
	fi

	if mkdir -p "$QA_ROOT" 2>/dev/null && [[ -w "$QA_ROOT" ]]; then
		green "OK    profile root writable $QA_ROOT"
	else
		red "FAIL  profile root not writable $QA_ROOT"
		failures=$((failures + 1))
	fi

	if curl -fsS --max-time 3 "http://127.0.0.1:$PROXY_PORT/__qa/health" >/dev/null 2>&1; then
		green "OK    fault proxy responding on 127.0.0.1:$PROXY_PORT"
	elif (exec 3<>"/dev/tcp/127.0.0.1/$PROXY_PORT") 2>/dev/null; then
		red "FAIL  port $PROXY_PORT is held by something that is not the fault proxy"
		failures=$((failures + 1))
	else
		info "WARN  fault proxy not started yet (run: qa-env.sh proxy start)"
		warnings=$((warnings + 1))
	fi

	local running
	running="$(main_instance_pids | wc -l | tr -d ' ')"
	info "INFO  QA VS Code instances running: $running"

	if ((failures > 0)); then
		red "doctor: $failures blocking problem(s), $warnings warning(s) — environment is not ready"
		return 1
	fi
	green "doctor: clean ($warnings warning(s))"
	return 0
}

# ---------------------------------------------------------------- proxy

proxy_pid() {
	[[ -f "$PROXY_PID_FILE" ]] || return 1
	local pid
	pid="$(cat "$PROXY_PID_FILE")"
	[[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null && printf '%s' "$pid"
}

cmd_proxy() {
	local action="${1:-status}"
	mkdir -p "$PROXY_LOG_DIR"
	case "$action" in
	start)
		if proxy_pid >/dev/null; then
			info "fault proxy already running (pid $(proxy_pid))"
			return 0
		fi
		QA_PROXY_PORT="$PROXY_PORT" QA_PROXY_LOG="$PROXY_REQUESTS" \
			setsid node "$HERE/fault-proxy.mjs" >>"$PROXY_STDOUT" 2>&1 &
		local pid=$!
		printf '%s' "$pid" >"$PROXY_PID_FILE"
		for _ in $(seq 1 30); do
			if curl -fsS --max-time 2 "http://127.0.0.1:$PROXY_PORT/__qa/health" >/dev/null 2>&1; then
				green "fault proxy started (pid $pid) on http://127.0.0.1:$PROXY_PORT"
				return 0
			fi
			sleep 0.2
		done
		red "fault proxy did not become healthy; see $PROXY_STDOUT"
		return 1
		;;
	stop)
		local pid
		if pid="$(proxy_pid)"; then
			kill "$pid" 2>/dev/null
			info "fault proxy stopped (pid $pid)"
		else
			info "fault proxy not running"
		fi
		rm -f "$PROXY_PID_FILE"
		;;
	status)
		if proxy_pid >/dev/null; then
			green "fault proxy running (pid $(proxy_pid)) port $PROXY_PORT"
			curl -fsS "http://127.0.0.1:$PROXY_PORT/__qa/health"
			printf '\n'
		else
			red "fault proxy not running"
			return 1
		fi
		;;
	reset)
		curl -fsS -X POST "http://127.0.0.1:$PROXY_PORT/__qa/reset" >/dev/null && green "request log cleared"
		;;
	models)
		node -e '
const fs = require("node:fs");
const path = process.argv[1];
let lines = [];
try { lines = fs.readFileSync(path, "utf8").split("\n").filter((l) => l.trim()); } catch {}
const chat = lines.map((l) => JSON.parse(l)).filter((e) => e.kind === "chat.completions");
if (chat.length === 0) { console.log("(no chat.completions requests recorded)"); process.exit(0); }
console.log("seq  at                        model                    msgs tools auth");
for (const entry of chat) {
  const auth = entry.auth?.present
    ? `${entry.auth.digest} len=${entry.auth.length}${entry.auth.hasSurroundingWhitespace ? " UNTRIMMED" : ""}`
    : "(none)";
  console.log(
    `${String(entry.seq).padEnd(4)} ${entry.at} ${String(entry.model).padEnd(24)} ${String(entry.messageCount).padEnd(4)} ${String(entry.toolCount).padEnd(5)} ${auth}`,
  );
}
const last = chat[chat.length - 1];
console.log(`\nmost recent model on wire: ${last.model}`);
' "$PROXY_REQUESTS"
		;;
	count)
		node -e '
const fs = require("node:fs");
let lines = [];
try { lines = fs.readFileSync(process.argv[1], "utf8").split("\n").filter((l) => l.trim()); } catch {}
const entries = lines.map((l) => JSON.parse(l));
const chat = entries.filter((e) => e.kind === "chat.completions");
const byModel = new Map();
for (const entry of chat) { byModel.set(entry.model, (byModel.get(entry.model) ?? 0) + 1); }
console.log(`chat.completions requests: ${chat.length}`);
for (const [model, count] of byModel) { console.log(`  ${String(model).padEnd(26)} ${count}`); }
const other = entries.filter((e) => e.kind !== "chat.completions");
if (other.length) {
  console.log("other events:");
  const byKind = new Map();
  for (const entry of other) { byKind.set(entry.kind, (byKind.get(entry.kind) ?? 0) + 1); }
  for (const [kind, count] of byKind) { console.log(`  ${String(kind).padEnd(26)} ${count}`); }
}
' "$PROXY_REQUESTS"
		;;
	log)
		tail -n "${2:-40}" "$PROXY_REQUESTS" 2>/dev/null || info "(no requests logged)"
		;;
	*)
		red "unknown proxy action: $action"
		return 2
		;;
	esac
}

# ---------------------------------------------------------------- start/stop

seed_profile() {
	local dir="$1"
	mkdir -p "$dir/vscode-user/User" "$dir/cline/data/settings" "$dir/workspace"

	cat >"$dir/vscode-user/User/settings.json" <<'JSON'
{
  "window.zoomLevel": 0,
  "window.zoomPerWindow": false,
  "workbench.startupEditor": "none",
  "workbench.tips.enabled": false,
  "workbench.welcomePage.walkthroughs.openOnInstall": false,
  "workbench.enableExperiments": false,
  "workbench.editor.enablePreview": false,
  "window.commandCenter": false,
  "window.titleBarStyle": "custom",
  "telemetry.telemetryLevel": "off",
  "update.mode": "none",
  "update.showReleaseNotes": false,
  "extensions.autoUpdate": false,
  "extensions.autoCheckUpdates": false,
  "extensions.ignoreRecommendations": true,
  "security.workspace.trust.enabled": false,
  "git.openRepositoryInParentFolders": "never",
  "chat.commandCenter.enabled": false,
  "editor.minimap.enabled": false
}
JSON

	if [[ ! -f "$dir/workspace/README.md" ]]; then
		cat >"$dir/workspace/README.md" <<'MD'
# QA scratch workspace

Opened by qa-env.sh so Cline has a workspace root. Nothing here is real code.
MD
	fi
	# A file big enough to overflow a small context window (E4-context-local).
	if [[ ! -f "$dir/workspace/large-file.txt" ]]; then
		node -e '
const fs = require("node:fs");
const line = "The quick brown fox jumps over the lazy dog while counting tokens. ";
let out = "";
for (let i = 0; i < 12000; i += 1) { out += `${String(i).padStart(6, "0")} ${line}\n`; }
fs.writeFileSync(process.argv[1], out);
' "$dir/workspace/large-file.txt"
	fi
}

cmd_start() {
	local profile="${1:-costerr}"
	shift || true
	local keys="" select="" model="" price=""
	while (($# > 0)); do
		case "$1" in
		--keys)
			keys="$2"
			shift 2
			;;
		--select)
			select="$2"
			shift 2
			;;
		--model)
			model="$2"
			shift 2
			;;
		--price)
			price="--price"
			shift
			;;
		*)
			red "unknown start option: $1"
			return 2
			;;
		esac
	done

	local existing
	existing="$(main_instance_pids | wc -l | tr -d ' ')"
	if ((existing > 0)); then
		red "refusing to start: $existing QA VS Code instance(s) already running (run: qa-env.sh stop)"
		return 1
	fi

	local dir
	dir="$(profile_dir "$profile")"
	seed_profile "$dir"

	if [[ -n "$keys" ]]; then
		node "$HERE/apply-keys.mjs" --keys "$keys" --profile-dir "$dir" \
			${select:+--select "$select"} ${model:+--model "$model"} $price || return 1
	fi

	local log="$dir/code.log"
	: >"$log"
	CLINE_DIR="$dir/cline" DISPLAY="$DISPLAY_ID" setsid "$CODE_BIN" \
		--no-sandbox \
		--disable-gpu-sandbox \
		--user-data-dir="$dir/vscode-user" \
		--disable-workspace-trust \
		--skip-welcome \
		--skip-release-notes \
		--disable-telemetry \
		--disable-updates \
		"$dir/workspace" >>"$log" 2>&1 &
	disown

	for _ in $(seq 1 60); do
		if [[ -n "$(main_instance_pids)" ]]; then
			sleep 3
			green "started profile '$profile'"
			info "  clineDir     $dir/cline"
			info "  userDataDir  $dir/vscode-user"
			info "  workspace    $dir/workspace"
			info "  pids         $(main_instance_pids | tr '\n' ' ')"
			return 0
		fi
		sleep 0.5
	done
	red "VS Code did not start; see $log"
	return 1
}

wait_for_exit() {
	local seconds="$1"
	for _ in $(seq 1 $((seconds * 2))); do
		[[ -z "$(instance_pids)" ]] && return 0
		sleep 0.5
	done
	return 1
}

cmd_stop() {
	local pids
	pids="$(main_instance_pids)"
	if [[ -z "$pids" ]]; then
		info "no QA VS Code instance running"
		return 0
	fi
	info "sending SIGTERM to $(tr '\n' ' ' <<<"$pids")"
	# shellcheck disable=SC2086
	kill -TERM $pids 2>/dev/null
	if wait_for_exit 25; then
		green "stopped cleanly"
		return 0
	fi
	red "instances still alive after 25s — run: qa-env.sh recover"
	return 1
}

cmd_recover() {
	local pids
	pids="$(instance_pids)"
	if [[ -n "$pids" ]]; then
		# shellcheck disable=SC2086
		kill -TERM $pids 2>/dev/null
		wait_for_exit 15
	fi
	pids="$(instance_pids)"
	if [[ -n "$pids" ]]; then
		info "escalating to SIGKILL for stuck processes: $(tr '\n' ' ' <<<"$pids")"
		# shellcheck disable=SC2086
		kill -KILL $pids 2>/dev/null
		wait_for_exit 10
	fi
	find "$QA_ROOT" -name 'code.lock' -delete 2>/dev/null
	find "$QA_ROOT" -path '*vscode-user*' -name 'SingletonLock' -delete 2>/dev/null
	if [[ -z "$(instance_pids)" ]]; then
		green "recovered: no QA VS Code processes remain"
		return 0
	fi
	red "recover failed; processes remain: $(instance_pids | tr '\n' ' ')"
	return 1
}

cmd_status() {
	local mains all
	mains="$(main_instance_pids)"
	all="$(instance_pids)"
	local main_count all_count
	main_count="$(wc -l <<<"${mains:-}" | tr -d ' ')"
	[[ -z "$mains" ]] && main_count=0
	all_count="$(wc -l <<<"${all:-}" | tr -d ' ')"
	[[ -z "$all" ]] && all_count=0

	info "QA VS Code main instances: $main_count (total processes incl. helpers: $all_count)"
	local pid cmd
	for pid in $mains; do
		cmd="$(tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null)"
		info "  pid $pid  $(sed -E 's/.*--user-data-dir=([^ ]+).*/profile=\1/' <<<"$cmd")"
	done
	if proxy_pid >/dev/null; then
		info "fault proxy: running (pid $(proxy_pid))"
	else
		info "fault proxy: not running"
	fi
	if ((main_count == 1)); then
		green "exactly one instance"
	elif ((main_count == 0)); then
		red "no instance running"
	else
		red "more than one instance — stop and start again"
		return 1
	fi
}

cmd_state() {
	local profile="${1:-costerr}"
	node "$HERE/apply-keys.mjs" --show --profile-dir "$(profile_dir "$profile")"
}

# Sets the OpenAI-compatible model id directly in the profile, bypassing the
# autocomplete in the settings UI. VS Code must be stopped first: the extension
# caches global state in memory and rewrites the file on change.
cmd_model() {
	local profile="${1:?profile required}" model="${2:?model id required}"
	local dir
	dir="$(profile_dir "$profile")"
	node -e '
const fs = require("node:fs");
const file = process.argv[1];
const model = process.argv[2];
const state = JSON.parse(fs.readFileSync(file, "utf8"));
state.planModeOpenAiModelId = model;
state.actModeOpenAiModelId = model;
fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
console.log(`set planMode/actModeOpenAiModelId = ${model}`);
' "$dir/cline/data/globalState.json" "$model"
}

case "${1:-}" in
doctor) shift && cmd_doctor "$@" ;;
proxy) shift && cmd_proxy "$@" ;;
start) shift && cmd_start "$@" ;;
stop) shift && cmd_stop "$@" ;;
recover) shift && cmd_recover "$@" ;;
status) shift && cmd_status "$@" ;;
state) shift && cmd_state "$@" ;;
model) shift && cmd_model "$@" ;;
*)
	cat <<USAGE
usage: qa-env.sh <command>

  doctor                                   check the environment
  proxy start|stop|status|models|count|reset|log
  start <profile> [--keys F] [--select P] [--model ID] [--price]
  stop | recover | status
  state <profile>                          what the extension has configured
  model <profile> <model-id>               set the model id without the UI
USAGE
	exit 2
	;;
esac
