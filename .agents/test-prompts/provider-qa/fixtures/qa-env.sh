#!/usr/bin/env bash
# Environment control for the provider QA runs.
#
# Exists so a test agent never has to compose a VS Code launch line by hand.
# Every failure mode observed while building these prompts — a second instance
# silently attaching to the first, a SIGKILLed profile poisoning every later
# launch with "crashed, code 133", an agent testing a window it did not
# configure — comes from ad-hoc launching. Use only these subcommands.
#
#   qa-env.sh start   <slug> [--keys <file> --select <provider>]
#   qa-env.sh status
#   qa-env.sh recover <slug>
#   qa-env.sh stop    <slug>
#   qa-env.sh state   <slug>
#   qa-env.sh proxy   start|stop|reset|tail|count
#   qa-env.sh doctor
#
# `start` is idempotent-ish: it refuses to run while another instance is up,
# because that is the single most common way a run silently tests the wrong
# window.

set -uo pipefail

REPO=/workspace
FIXTURES="$REPO/.agents/test-prompts/provider-qa/fixtures"
ROOT=/tmp/cline-qa
PROXY_LOG=/tmp/fault-proxy.jsonl
PROXY_PORT=8788
ACTIVATION_TIMEOUT=75

red() { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }

qa_dir() { echo "$ROOT/$1"; }

running_instances() {
	pgrep -f -- "--extensionDevelopmentPath=$REPO/apps/vscode" 2>/dev/null | tr '\n' ' '
}

instance_for_slug() {
	pgrep -f -- "--user-data-dir=$(qa_dir "$1")/vscode-userdata" 2>/dev/null | head -1
}

# The Cline extension creates its data dir contents on activation, so their
# appearance is a usable "the extension host really came up" signal.
wait_for_activation() {
	local data_dir="$1" waited=0
	while [ "$waited" -lt "$ACTIVATION_TIMEOUT" ]; do
		if [ -d "$data_dir/db" ] || [ -f "$data_dir/settings/global-settings.json" ]; then
			return 0
		fi
		sleep 3
		waited=$((waited + 3))
	done
	return 1
}

crash_in_log() {
	local ud="$1"
	grep -rlsi "terminated unexpectedly\|crashed, code\|code: '133'" "$ud/logs" 2>/dev/null | head -1
}

cmd_start() {
	local slug="${1:-}"
	shift || true
	[ -z "$slug" ] && {
		red "usage: qa-env.sh start <slug> [--keys <file> --select <provider>]"
		exit 2
	}

	local keys="" select=""
	while [ $# -gt 0 ]; do
		case "$1" in
		--keys)
			keys="$2"
			shift 2
			;;
		--select)
			select="$2"
			shift 2
			;;
		*)
			red "unknown argument: $1"
			exit 2
			;;
		esac
	done

	local existing
	existing="$(running_instances)"
	if [ -n "$existing" ]; then
		red "REFUSING TO START: VS Code is already running (pids: $existing)."
		red "A second instance can attach to the first, and you would test the wrong window."
		red "Run 'qa-env.sh stop <slug>' for the existing run first, then retry."
		exit 1
	fi

	local qa
	qa="$(qa_dir "$slug")"
	rm -rf "$qa"
	mkdir -p "$qa/workspace" "$qa/data/settings"
	printf 'export const name = "john"\n' >"$qa/workspace/qa.txt"

	if [ -n "$keys" ]; then
		local apply_args=(--keys "$keys" --dir "$qa/data")
		[ -n "$select" ] && apply_args+=(--select "$select")
		node "$FIXTURES/apply-keys.mjs" "${apply_args[@]}" || exit 1
	fi

	echo "Launching VS Code (slug=$slug, data=$qa/data)…"
	setsid env DISPLAY=:1 CLINE_DATA_DIR="$qa/data" \
		code --no-sandbox --disable-workspace-trust --disable-dev-shm-usage \
		--user-data-dir="$qa/vscode-userdata" \
		--extensionDevelopmentPath="$REPO/apps/vscode" \
		"$qa/workspace" </dev/null >"$qa/code.log" 2>&1 &
	disown 2>/dev/null || true

	if wait_for_activation "$qa/data"; then
		green "READY: extension activated. Open the Cline panel from the Activity Bar."
		echo "  data dir : $qa/data"
		echo "  workspace: $qa/workspace"
		echo "  pid(s)   : $(running_instances)"
		return 0
	fi

	local crashlog
	crashlog="$(crash_in_log "$qa/vscode-userdata")"
	red "FAILED: extension did not activate within ${ACTIVATION_TIMEOUT}s."
	[ -n "$crashlog" ] && red "  crash signature found in $crashlog"
	yellow "Run 'qa-env.sh recover $slug' once. If that also fails, run 'qa-env.sh doctor'."
	return 1
}

cmd_recover() {
	local slug="${1:-}"
	[ -z "$slug" ] && {
		red "usage: qa-env.sh recover <slug>"
		exit 2
	}
	local qa
	qa="$(qa_dir "$slug")"

	yellow "Recovering $slug: terminating VS Code and discarding the VS Code profile."
	yellow "The Cline data directory ($qa/data) is preserved, so state under test survives."
	cmd_stop "$slug"

	# A window stuck on the "terminated unexpectedly" modal ignores SIGTERM,
	# because VS Code is waiting on the dialog. Escalating is safe here and only
	# here: the profile that SIGKILL would corrupt is deleted on the next line.
	local pid
	pid="$(instance_for_slug "$slug")"
	if [ -n "$pid" ]; then
		yellow "pid $pid ignored SIGTERM (likely stuck on the crash dialog); escalating."
		pkill -KILL -f -- "--user-data-dir=$qa/vscode-userdata" 2>/dev/null
		sleep 3
	fi
	rm -rf "$qa/vscode-userdata"

	setsid env DISPLAY=:1 CLINE_DATA_DIR="$qa/data" \
		code --no-sandbox --disable-workspace-trust --disable-dev-shm-usage \
		--user-data-dir="$qa/vscode-userdata" \
		--extensionDevelopmentPath="$REPO/apps/vscode" \
		"$qa/workspace" </dev/null >"$qa/code.log" 2>&1 &
	disown 2>/dev/null || true

	if wait_for_activation "$qa/data"; then
		green "RECOVERED: extension activated."
		return 0
	fi
	red "RECOVERY FAILED. Run 'qa-env.sh doctor' before reporting anything as a Cline bug."
	return 1
}

cmd_stop() {
	local slug="${1:-}"
	local pid
	if [ -n "$slug" ]; then
		pid="$(instance_for_slug "$slug")"
	else
		pid="$(running_instances | awk '{print $1}')"
	fi
	[ -z "$pid" ] && {
		echo "No matching VS Code instance."
		return 0
	}
	# SIGTERM only. SIGKILL corrupts the profile and poisons every later launch.
	kill -TERM "$pid" 2>/dev/null
	local waited=0
	while kill -0 "$pid" 2>/dev/null && [ "$waited" -lt 20 ]; do
		sleep 1
		waited=$((waited + 1))
	done
	if kill -0 "$pid" 2>/dev/null; then
		yellow "pid $pid still alive after 20s; leaving it rather than SIGKILLing."
		return 1
	fi
	green "Stopped pid $pid."
}

cmd_status() {
	local pids
	pids="$(running_instances)"
	if [ -z "$pids" ]; then
		echo "VS Code instances: none"
	else
		local count
		count="$(echo "$pids" | wc -w)"
		echo "VS Code instances: $count"
		ps -o pid=,args= -p "$(echo "$pids" | tr ' ' ',' | sed 's/,$//')" 2>/dev/null |
			sed 's/--extensionDevelopmentPath[^ ]*//' | cut -c1-160
		[ "$count" -gt 1 ] && red "MORE THAN ONE INSTANCE — stop all but the one under test before continuing."
	fi
	if curl -s -m 2 "http://127.0.0.1:$PROXY_PORT/__requests" >/dev/null 2>&1; then
		echo "fault-proxy: up ($(curl -s -m 2 "http://127.0.0.1:$PROXY_PORT/__requests"))"
	else
		echo "fault-proxy: down"
	fi
}

cmd_state() {
	local slug="${1:-}"
	[ -z "$slug" ] && {
		red "usage: qa-env.sh state <slug>"
		exit 2
	}
	local qa
	qa="$(qa_dir "$slug")"
	echo "--- providers.json ---"
	cat "$qa/data/settings/providers.json" 2>/dev/null || echo "(absent)"
	echo "--- globalState.json (legacy store; often absent on fresh installs) ---"
	python3 -c "
import json, os, sys
p = '$qa/data/globalState.json'
if not os.path.exists(p):
    print('(absent)')
else:
    s = json.load(open(p))
    print(json.dumps({k: v for k, v in s.items()
                      if 'ApiProvider' in k or 'ModelId' in k or k == 'mode'}, indent=2))
" 2>/dev/null || echo "(unreadable)"
}

cmd_proxy() {
	case "${1:-}" in
	start)
		if curl -s -m 2 "http://127.0.0.1:$PROXY_PORT/__requests" >/dev/null 2>&1; then
			green "fault-proxy already up on :$PROXY_PORT"
			return 0
		fi
		setsid node "$FIXTURES/fault-proxy.mjs" </dev/null >/tmp/fault-proxy.out 2>&1 &
		disown 2>/dev/null || true
		sleep 2
		curl -s -m 3 "http://127.0.0.1:$PROXY_PORT/__requests" >/dev/null &&
			green "fault-proxy up on :$PROXY_PORT" ||
			red "fault-proxy failed to start; see /tmp/fault-proxy.out"
		;;
	stop) pkill -f "fault-proxy.mjs" && green "fault-proxy stopped" ;;
	reset) curl -s -X POST "http://127.0.0.1:$PROXY_PORT/__reset" && echo ;;
	count) curl -s "http://127.0.0.1:$PROXY_PORT/__requests" && echo ;;
	tail) tail -1 "$PROXY_LOG" | python3 -m json.tool ;;
	models)
		python3 -c "
import json
for line in open('$PROXY_LOG'):
    e = json.loads(line)
    b = e.get('body') or {}
    print(f\"{e['seq']:>3} {e['method']:<5} {e['path']:<24} model={b.get('model','-')}\")
"
		;;
	*) red "usage: qa-env.sh proxy start|stop|reset|count|tail|models" ;;
	esac
}

# Distinguishes "this environment is broken" from "Cline is broken". Run this
# before reporting any launch or crash problem as a product bug.
cmd_doctor() {
	echo "== display =="
	if DISPLAY=:1 timeout 10 ffmpeg -loglevel error -f x11grab -video_size 320x200 -i :1 \
		-frames:v 1 -y /tmp/qa-doctor.png 2>/dev/null; then
		green "X display :1 is capturable"
	else
		red "cannot capture DISPLAY=:1 — the virtual display is unavailable"
	fi

	echo "== build artifacts =="
	[ -f "$REPO/apps/vscode/dist/extension.js" ] &&
		green "dist/extension.js present" ||
		red "dist/extension.js MISSING — run: cd $REPO/apps/vscode && bun run build:webview && bun esbuild.mjs"
	[ -f "$REPO/apps/vscode/webview-ui/build/index.html" ] &&
		green "webview build present" ||
		red "webview build MISSING — run: cd $REPO/apps/vscode && bun run build:webview"

	echo "== instances =="
	cmd_status

	echo "== vanilla VS Code control test =="
	echo "Launching VS Code with NO Cline extension. If this also fails, the environment"
	echo "is at fault and nothing you are seeing is a Cline bug."
	rm -rf /tmp/qa-doctor-ud
	setsid env DISPLAY=:1 code --no-sandbox --disable-workspace-trust --disable-dev-shm-usage \
		--user-data-dir=/tmp/qa-doctor-ud /tmp </dev/null >/tmp/qa-doctor-code.log 2>&1 &
	disown 2>/dev/null || true
	sleep 25
	if pgrep -f -- "--user-data-dir=/tmp/qa-doctor-ud" >/dev/null; then
		green "vanilla VS Code started — the environment can run VS Code"
		pkill -TERM -f -- "--user-data-dir=/tmp/qa-doctor-ud"
	else
		red "vanilla VS Code ALSO fails to start"
		red "=> ENVIRONMENT FAILURE. Report it as such; do not file it against Cline."
	fi
}

case "${1:-}" in
start)
	shift
	cmd_start "$@"
	;;
stop)
	shift
	cmd_stop "$@"
	;;
recover)
	shift
	cmd_recover "$@"
	;;
status) cmd_status ;;
state)
	shift
	cmd_state "$@"
	;;
proxy)
	shift
	cmd_proxy "$@"
	;;
doctor) cmd_doctor ;;
*)
	sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'
	exit 2
	;;
esac
