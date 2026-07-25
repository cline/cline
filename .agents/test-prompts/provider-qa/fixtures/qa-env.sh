#!/usr/bin/env bash
# Provider QA environment harness.
#
#   qa-env.sh doctor
#   qa-env.sh start <slug> [--keys F] [--select P] [--fresh]
#   qa-env.sh stop <slug>
#   qa-env.sh status
#   qa-env.sh recover
#   qa-env.sh state <slug>
#   qa-env.sh proxy start|stop|reset|models|tail|status
#
# Exactly one VS Code instance is allowed at a time: two instances sharing a
# profile hand off to each other and you end up testing a window you never
# configured.

set -uo pipefail

ROOT=${QA_ROOT:-/tmp/cline-qa}
EXT_DEV_PATH=${QA_EXT_DEV_PATH:-/workspace/apps/vscode}
FIXTURES=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PROXY_DIR="$ROOT/proxy"
PROXY_PID="$PROXY_DIR/proxy.pid"
PROXY_LOG="$PROXY_DIR/server.log"
PROXY_REQUESTS="$PROXY_DIR/requests.log"
PROXY_PORT=${QA_PROXY_PORT:-8788}
DISPLAY_NUM=${QA_DISPLAY:-:1}

mkdir -p "$ROOT" "$PROXY_DIR"

log()  { printf '%s\n' "$*"; }
fail() { printf 'ENVIRONMENT FAILURE: %s\n' "$*" >&2; }

slug_dir()      { echo "$ROOT/$1"; }
slug_data()     { echo "$ROOT/$1/data"; }
slug_userdata() { echo "$ROOT/$1/user-data"; }
slug_extdir()   { echo "$ROOT/$1/extensions"; }
slug_ws()       { echo "$ROOT/$1/workspace"; }

# Main (non-child) VS Code processes launched by this harness.
main_pids() {
  local filter=${1:-}
  local pid cmd
  while read -r pid cmd; do
    [[ -z $pid ]] && continue
    case "$cmd" in
      *--type=*) continue ;;                      # renderer / utility / zygote
      *--extensionDevelopmentPath=*) ;;
      *) continue ;;
    esac
    if [[ -n $filter && $cmd != *"$filter"* ]]; then continue; fi
    printf '%s\t%s\n' "$pid" "$cmd"
  done < <(ps -eo pid=,args= 2>/dev/null)
}

instance_slugs() {
  local pid cmd ud
  while IFS=$'\t' read -r pid cmd; do
    [[ -z $pid ]] && continue
    ud=$(sed -n 's/.*--user-data-dir[= ]\([^ ]*\).*/\1/p' <<<"$cmd")
    [[ -z $ud ]] && ud="(default-profile)"
    printf '%s\t%s\t%s\n' "$pid" "$(basename "$(dirname "$ud")")" "$ud"
  done < <(main_pids)
}

# ---------------------------------------------------------------- doctor

cmd_doctor() {
  local problems=0 warnings=0

  log "== qa-env doctor =="
  log "fixtures : $FIXTURES"
  log "root     : $ROOT"

  for bin in code node bun python3 ps; do
    if command -v "$bin" >/dev/null 2>&1; then
      log "ok   bin $bin -> $(command -v $bin)"
    else
      fail "missing required binary: $bin"; problems=$((problems+1))
    fi
  done

  if DISPLAY=$DISPLAY_NUM xdpyinfo >/dev/null 2>&1; then
    log "ok   X display $DISPLAY_NUM is live"
  else
    fail "X display $DISPLAY_NUM not reachable (xdpyinfo failed)"; problems=$((problems+1))
  fi

  if [[ -f "$EXT_DEV_PATH/dist/extension.js" ]]; then
    log "ok   extension bundle $(stat -c '%s bytes, mtime %y' "$EXT_DEV_PATH/dist/extension.js")"
  else
    fail "extension bundle missing: $EXT_DEV_PATH/dist/extension.js (run: cd apps/vscode && bun esbuild.mjs)"
    problems=$((problems+1))
  fi

  if [[ -f "$EXT_DEV_PATH/webview-ui/build/index.html" ]]; then
    log "ok   webview build present"
  else
    fail "webview build missing (run: cd apps/vscode && bun run build:webview)"; problems=$((problems+1))
  fi

  if [[ -x "$EXT_DEV_PATH/dist-standalone/ripgrep-binaries/linux-x64/rg" ]] || compgen -G "$EXT_DEV_PATH/bin/rg*" >/dev/null; then
    log "ok   bundled ripgrep present"
  else
    log "warn bundled ripgrep missing (bun run download-ripgrep); VS Code's own rg is normally used anyway"
    warnings=$((warnings+1))
  fi

  if [[ -w /tmp ]]; then log "ok   /tmp writable"; else fail "/tmp not writable"; problems=$((problems+1)); fi

  local avail
  avail=$(df -Pk /tmp | awk 'NR==2{print int($4/1024)}')
  if [[ ${avail:-0} -lt 512 ]]; then
    log "warn only ${avail}MB free on /tmp"; warnings=$((warnings+1))
  else
    log "ok   ${avail}MB free on /tmp"
  fi

  if cmd_proxy_status >/dev/null 2>&1; then
    log "ok   fault proxy reachable on port $PROXY_PORT"
  else
    log "info fault proxy not running (start with: qa-env.sh proxy start)"
  fi

  local n
  n=$(instance_slugs | wc -l)
  log "info VS Code dev instances currently running: $n"

  log ""
  if [[ $problems -gt 0 ]]; then
    log "RESULT: ENVIRONMENT FAILURE ($problems problem(s), $warnings warning(s))"
    return 1
  fi
  log "RESULT: ENVIRONMENT OK ($warnings warning(s))"
  return 0
}

# ---------------------------------------------------------------- proxy

cmd_proxy_status() {
  local body
  body=$(curl -fsS --max-time 3 "http://127.0.0.1:$PROXY_PORT/__qa/health" 2>/dev/null) || return 1
  echo "proxy up: $body"
  return 0
}

cmd_proxy_start() {
  if cmd_proxy_status >/dev/null 2>&1; then
    log "proxy already running on $PROXY_PORT"
    cmd_proxy_status
    return 0
  fi
  mkdir -p "$PROXY_DIR"
  QA_PROXY_DIR="$PROXY_DIR" QA_PROXY_PORT="$PROXY_PORT" \
    nohup node "$FIXTURES/fault-proxy.mjs" >>"$PROXY_LOG" 2>&1 &
  echo $! >"$PROXY_PID"
  for _ in $(seq 1 40); do
    sleep 0.25
    if cmd_proxy_status >/dev/null 2>&1; then
      log "proxy started (pid $(cat "$PROXY_PID"))"
      cmd_proxy_status
      return 0
    fi
  done
  fail "proxy failed to start; see $PROXY_LOG"
  tail -20 "$PROXY_LOG" 2>/dev/null
  return 1
}

cmd_proxy_stop() {
  if [[ -f $PROXY_PID ]]; then
    local p; p=$(cat "$PROXY_PID")
    if kill -0 "$p" 2>/dev/null; then kill -TERM "$p" 2>/dev/null; log "proxy stopped (pid $p)"; fi
    rm -f "$PROXY_PID"
  else
    log "no proxy pidfile"
  fi
}

cmd_proxy_reset() {
  : >"$PROXY_REQUESTS"
  log "proxy request log cleared: $PROXY_REQUESTS"
}

cmd_proxy_models() {
  if [[ ! -s $PROXY_REQUESTS ]]; then
    log "(no requests logged since last reset)"
    return 0
  fi
  node -e '
    const fs=require("fs");
    const lines=fs.readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean);
    lines.forEach((l,i)=>{
      let e; try{e=JSON.parse(l)}catch{ return console.log(`${String(i+1).padStart(3)}  <unparseable log line>`) }
      const model=e.model==null?"":`  model=${e.model}`;
      console.log(`${String(i+1).padStart(3)}  ${e.ts}  ${e.method} ${e.path}${model}`);
    });
    const last=[...lines].reverse().map(l=>{try{return JSON.parse(l)}catch{return null}}).find(e=>e&&e.path&&e.path.includes("chat/completions"));
    console.log("");
    console.log(last?`LAST CHAT COMPLETION MODEL: ${last.model}`:"LAST CHAT COMPLETION MODEL: (none)");
  ' "$PROXY_REQUESTS"
}

cmd_proxy_tail() {
  if [[ ! -s $PROXY_REQUESTS ]]; then log "(no requests logged since last reset)"; return 0; fi
  node -e '
    const fs=require("fs");
    const lines=fs.readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean);
    const e=JSON.parse(lines[lines.length-1]);
    console.log(`ts     : ${e.ts}`);
    console.log(`request: ${e.method} ${e.path}`);
    console.log(`model  : ${e.model}`);
    console.log("headers:");
    for (const [k,v] of Object.entries(e.headers||{})) {
      const val = /authorization|api-key/i.test(k) ? String(v).slice(0,12)+"…(masked)" : v;
      console.log(`  ${k}: ${val}`);
    }
    console.log("body   :");
    try { console.log(JSON.stringify(JSON.parse(e.body),null,2)); } catch { console.log(e.body); }
  ' "$PROXY_REQUESTS"
}

cmd_proxy() {
  case "${1:-status}" in
    start)  cmd_proxy_start ;;
    stop)   cmd_proxy_stop ;;
    reset)  cmd_proxy_reset ;;
    models) cmd_proxy_models ;;
    tail)   cmd_proxy_tail ;;
    status) cmd_proxy_status || { log "proxy down"; return 1; } ;;
    log)    tail -40 "$PROXY_LOG" ;;
    *) fail "unknown proxy subcommand: $1"; return 2 ;;
  esac
}

# ---------------------------------------------------------------- status

cmd_status() {
  local rows n
  rows=$(instance_slugs)
  n=$(printf '%s' "$rows" | grep -c . )
  log "VS Code dev instances: $n"
  if [[ -n $rows ]]; then
    printf '%s\n' "$rows" | while IFS=$'\t' read -r pid slug ud; do
      log "  pid=$pid slug=$slug user-data-dir=$ud"
    done
  fi
  if [[ $n -gt 1 ]]; then
    fail "more than one instance is running — results would be untrustworthy. Run: qa-env.sh recover"
    return 1
  fi
  cmd_proxy_status >/dev/null 2>&1 && log "proxy: up" || log "proxy: down"
  return 0
}

# ---------------------------------------------------------------- start / stop

cmd_start() {
  local slug=${1:-} ; shift || true
  [[ -z $slug ]] && { fail "usage: qa-env.sh start <slug> [--keys F] [--select P] [--fresh]"; return 2; }

  local keys="" select="" fresh=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --keys)   keys=${2:-}; shift 2 ;;
      --select) select=${2:-}; shift 2 ;;
      --fresh)  fresh=1; shift ;;
      *) fail "unknown start option: $1"; return 2 ;;
    esac
  done

  local running
  running=$(instance_slugs | grep -c . )
  if [[ $running -gt 0 ]]; then
    fail "a VS Code dev instance is already running; stop it first (qa-env.sh status / stop <slug>)"
    instance_slugs
    return 1
  fi

  local dir data ud ed ws
  dir=$(slug_dir "$slug"); data=$(slug_data "$slug"); ud=$(slug_userdata "$slug")
  ed=$(slug_extdir "$slug"); ws=$(slug_ws "$slug")

  if [[ $fresh -eq 1 ]]; then
    log "start: --fresh, removing $dir"
    rm -rf "$dir"
  fi
  mkdir -p "$data" "$ud" "$ed" "$ws"
  [[ -f "$ws/README.md" ]] || printf '# QA workspace (%s)\n' "$slug" >"$ws/README.md"

  if [[ -n $keys ]]; then
    local applyArgs=(--keys "$keys" --dir "$data")
    [[ -n $select ]] && applyArgs+=(--select "$select")
    node "$FIXTURES/apply-keys.mjs" "${applyArgs[@]}" || return 1
  else
    log "start: no --keys given, reusing existing data dir $data"
  fi

  local launchLog="$dir/launch.log"
  log "start: slug=$slug"
  log "  CLINE_DATA_DIR=$data"
  log "  user-data-dir =$ud"
  log "  workspace     =$ws"

  DISPLAY=$DISPLAY_NUM \
  CLINE_DATA_DIR="$data" \
  ELECTRON_DISABLE_SECURITY_WARNINGS=1 \
  nohup code \
    --no-sandbox \
    --disable-gpu-sandbox \
    --disable-updates \
    --disable-workspace-trust \
    --skip-release-notes \
    --skip-welcome \
    --user-data-dir "$ud" \
    --extensions-dir "$ed" \
    --extensionDevelopmentPath="$EXT_DEV_PATH" \
    --new-window "$ws" \
    >>"$launchLog" 2>&1 &

  for _ in $(seq 1 60); do
    sleep 0.5
    if [[ $(main_pids "$ud" | grep -c .) -gt 0 ]]; then
      log "start: window process up after $(( SECONDS ))s"
      break
    fi
  done

  sleep 6
  cmd_status
  log "start: launch log $launchLog"
}

wait_gone() {
  local ud=$1 tries=$2
  for _ in $(seq 1 "$tries"); do
    [[ $(main_pids "$ud" | grep -c .) -eq 0 ]] && return 0
    sleep 1
  done
  return 1
}

cmd_stop() {
  local slug=${1:-}
  [[ -z $slug ]] && { fail "usage: qa-env.sh stop <slug>"; return 2; }
  local ud; ud=$(slug_userdata "$slug")

  local pids
  pids=$(main_pids "$ud" | cut -f1)
  if [[ -z $pids ]]; then
    log "stop: no running instance for slug=$slug"
    return 0
  fi
  log "stop: TERM -> $(tr '\n' ' ' <<<"$pids")"
  # shellcheck disable=SC2086
  kill -TERM $pids 2>/dev/null
  if wait_gone "$ud" 25; then
    log "stop: instance for slug=$slug is gone"
  else
    fail "instance for slug=$slug did not exit after SIGTERM; run: qa-env.sh recover"
    return 1
  fi
  # Children (renderers, extension host) normally follow the main process out.
  sleep 1
  return 0
}

cmd_recover() {
  log "recover: escalating shutdown of all harness VS Code processes"
  local pids
  pids=$(main_pids | cut -f1)
  if [[ -n $pids ]]; then
    # shellcheck disable=SC2086
    kill -TERM $pids 2>/dev/null
    sleep 8
  fi
  pids=$(main_pids | cut -f1)
  if [[ -n $pids ]]; then
    log "recover: still alive after TERM, sending HUP"
    # shellcheck disable=SC2086
    kill -HUP $pids 2>/dev/null
    sleep 5
  fi
  pids=$(main_pids | cut -f1)
  if [[ -n $pids ]]; then
    log "recover: last resort, sending KILL to $(tr '\n' ' ' <<<"$pids")"
    # shellcheck disable=SC2086
    kill -KILL $pids 2>/dev/null
    sleep 3
  fi
  # Stale single-instance sockets keep a fresh launch from taking the window.
  find "$ROOT" -maxdepth 3 -name "*.sock" -delete 2>/dev/null
  find "$ROOT" -maxdepth 4 -path "*locks*" -type f -delete 2>/dev/null
  log "recover: done"
  cmd_status
}

# ---------------------------------------------------------------- state

cmd_state() {
  local slug=${1:-}
  [[ -z $slug ]] && { fail "usage: qa-env.sh state <slug>"; return 2; }
  local data; data=$(slug_data "$slug")
  QA_SLUG="$slug" QA_DATA="$data" node -e '
    const fs=require("fs"), path=require("path"), os=require("os");
    const slug=process.env.QA_SLUG, data=process.env.QA_DATA;
    const homeData=path.join(os.homedir(),".cline","data");

    function show(label, p, transform) {
      console.log("=== "+label);
      console.log("    path: "+p);
      if (!fs.existsSync(p)) { console.log("    MISSING"); console.log(""); return null; }
      let raw; try { raw=fs.readFileSync(p,"utf8"); } catch(e){ console.log("    UNREADABLE "+e.message); return null; }
      let json; try { json=JSON.parse(raw); } catch(e){ console.log("    INVALID JSON: "+e.message); console.log(raw.slice(0,2000)); console.log(""); return null; }
      const out = transform ? transform(json) : json;
      console.log(JSON.stringify(out,null,2).split("\n").map(l=>"    "+l).join("\n"));
      console.log("");
      return json;
    }

    const mask=(v)=> typeof v==="string" && v.length>10 ? v.slice(0,6)+"…("+v.length+")" : v;
    function maskProviders(j){
      const c=JSON.parse(JSON.stringify(j));
      for (const e of Object.values(c.providers||{})) {
        if (e?.settings?.apiKey) e.settings.apiKey=mask(e.settings.apiKey);
        if (e?.settings?.auth?.accessToken) e.settings.auth.accessToken=mask(e.settings.auth.accessToken);
        if (e?.settings?.aws?.secretKey) e.settings.aws.secretKey=mask(e.settings.aws.secretKey);
      }
      return c;
    }

    console.log("############ QA STATE  slug="+slug);
    console.log("############ isolated CLINE_DATA_DIR = "+data);
    console.log("");

    const prov = show("ISOLATED providers.json  (SDK provider store, honours CLINE_DATA_DIR)",
      path.join(data,"settings","providers.json"), maskProviders);

    show("ISOLATED models.json (per-model overrides)", path.join(data,"settings","models.json"));

    show("ISOLATED globalState.json (legacy store inside the isolated dir)", path.join(data,"globalState.json"));

    const PROV_KEYS=/Provider$|ModelId$|ModelInfo$|ModelSelector$|BaseUrl$|planActSeparateModelsSetting|^mode$|welcomeViewCompleted/;
    show("HOME globalState.json — provider/model keys only  (legacy store, ignores CLINE_DATA_DIR)",
      path.join(homeData,"globalState.json"),
      (j)=>Object.fromEntries(Object.entries(j).filter(([k])=>PROV_KEYS.test(k))));

    show("HOME secrets.json — key names only",
      path.join(homeData,"secrets.json"),
      (j)=>Object.fromEntries(Object.entries(j).map(([k,v])=>[k,mask(v)])));

    // One-line summary of the three values a case has to compare.
    console.log("=== SUMMARY");
    let home={}; try{ home=JSON.parse(fs.readFileSync(path.join(homeData,"globalState.json"),"utf8")); }catch{}
    const lastUsed=prov?.lastUsedProvider;
    console.log("    providers.json lastUsedProvider : "+(lastUsed??"(unset)"));
    console.log("    providers.json ."+(lastUsed??"?")+".model  : "+(prov?.providers?.[lastUsed]?.settings?.model??"(unset)"));
    console.log("    home actModeApiProvider         : "+(home.actModeApiProvider??"(unset)"));
    console.log("    home actModeApiModelId          : "+(home.actModeApiModelId??"(unset)"));
    console.log("    home planModeApiProvider        : "+(home.planModeApiProvider??"(unset)"));
    console.log("    home planModeApiModelId         : "+(home.planModeApiModelId??"(unset)"));
    console.log("    home planActSeparateModelsSetting: "+(home.planActSeparateModelsSetting??"(unset)"));
    console.log("    isolated globalState.json exists: "+fs.existsSync(path.join(data,"globalState.json")));
  '
}

# ---------------------------------------------------------------- dispatch

case "${1:-}" in
  doctor)  shift; cmd_doctor "$@" ;;
  start)   shift; cmd_start "$@" ;;
  stop)    shift; cmd_stop "$@" ;;
  status)  shift; cmd_status "$@" ;;
  recover) shift; cmd_recover "$@" ;;
  state)   shift; cmd_state "$@" ;;
  proxy)   shift; cmd_proxy "$@" ;;
  *)
    cat <<EOF
usage: qa-env.sh <command>

  doctor                 environment preflight
  start <slug> [opts]    launch the one allowed VS Code dev instance
                         opts: --keys <file> --select <provider> --fresh
  stop <slug>            graceful shutdown (SIGTERM)
  status                 list instances, assert exactly one
  recover                escalating shutdown + lock cleanup
  state <slug>           providers.json + legacy globalState (isolated and home)
  proxy start|stop|reset|models|tail|status|log
EOF
    exit 2 ;;
esac
