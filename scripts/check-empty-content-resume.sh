#!/usr/bin/env bash
set -euo pipefail

ORIGINAL_SESSION_ID="${1:-1782516724676_1khe9}"
HANDOFF_SESSION_ID="${2:-1782756486027_0ed5b}"
DATA_DIR="${CLINE_DATA_DIR:-$HOME/.cline/data}"
SESSION_DIR="${CLINE_SESSION_DATA_DIR:-$DATA_DIR/sessions}"
DB_DIR="${CLINE_DB_DATA_DIR:-$DATA_DIR/db}"
DISCOVERY_PATH="${CLINE_HUB_DISCOVERY_PATH:-$DATA_DIR/locks/hub/production.json}"
OUT_DIR="${TMPDIR:-/tmp}/cline-empty-content-resume-check"
mkdir -p "$OUT_DIR"

say() { printf '\n== %s ==\n' "$*"; }
run() { printf '+ %q' "$1"; shift; printf ' %q' "$@"; printf '\n'; "$@"; }

say "Cline CLI + storage diagnostics"
echo "cline: $(command -v cline || echo '<not found>')"
echo "CLINE_DATA_DIR: $DATA_DIR"
echo "CLINE_SESSION_DATA_DIR: $SESSION_DIR"
echo "CLINE_DB_DATA_DIR: $DB_DIR"
echo "CLINE_HUB_DISCOVERY_PATH: $DISCOVERY_PATH"
echo "original session: $ORIGINAL_SESSION_ID"
echo "handoff session:  $HANDOFF_SESSION_ID"

say "Hub discovery / port"
if [[ -f "$DISCOVERY_PATH" ]]; then
  echo "discovery file exists: $DISCOVERY_PATH"
  cat "$DISCOVERY_PATH" || true
else
  echo "no discovery file at $DISCOVERY_PATH"
fi
if command -v lsof >/dev/null 2>&1; then
  echo "processes listening on default hub port 25463:"
  lsof -nP -iTCP:25463 -sTCP:LISTEN || true
fi

say "Check history JSON for the sessions"
HISTORY_JSON="$OUT_DIR/history.json"
if cline --json history >"$HISTORY_JSON" 2>"$OUT_DIR/history.err"; then
  echo "wrote $HISTORY_JSON"
  node - "$HISTORY_JSON" "$ORIGINAL_SESSION_ID" "$HANDOFF_SESSION_ID" <<'NODE'
const fs = require('fs');
const [path, original, handoff] = process.argv.slice(2);
const rows = JSON.parse(fs.readFileSync(path, 'utf8'));
for (const id of [original, handoff]) {
  const row = rows.find((r) => r.sessionId === id || r.id === id || r.taskId === id);
  console.log(`\n${id}: ${row ? 'FOUND' : 'not found in first history page'}`);
  if (row) console.log(JSON.stringify(row, null, 2));
}
console.log(`\nrows returned: ${Array.isArray(rows) ? rows.length : 'non-array'}`);
NODE
else
  echo "cline --json history failed; stderr:"
  cat "$OUT_DIR/history.err" || true
  echo
  echo "If this shows EADDRINUSE, run one of:"
  echo "  cline doctor fix"
  echo "  cline hub stop"
  echo "Then rerun this script."
fi

say "Export session HTML backups if possible"
for id in "$ORIGINAL_SESSION_ID" "$HANDOFF_SESSION_ID"; do
  target="$OUT_DIR/$id.html"
  if cline history export "$id" --output "$target" >"$OUT_DIR/export-$id.out" 2>"$OUT_DIR/export-$id.err"; then
    echo "exported $id -> $target"
  else
    echo "could not export $id:"
    cat "$OUT_DIR/export-$id.err" || true
  fi
done

say "Search local Cline storage for EMPTY CONTENT in these sessions"
for id in "$ORIGINAL_SESSION_ID" "$HANDOFF_SESSION_ID"; do
  echo "-- $id"
  find "$DATA_DIR" -path '*/node_modules' -prune -o -type f \( -name "*$id*" -o -name 'messages.json' -o -name '*.json' \) -print 2>/dev/null \
    | head -200 \
    | xargs grep -n "ERROR: EMPTY CONTENT\|$id" 2>/dev/null || true
done

say "Resume commands"
cat <<CMDS
Interactive resume from the original useful work session:
  cline --id $ORIGINAL_SESSION_ID

Interactive resume from the handoff/resume session:
  cline --id $HANDOFF_SESSION_ID

Important: in this CLI checkout, resume is '--id <session-id>', not a separate 'resume' subcommand.
Passing a prompt with --id is ignored for resume here because main.ts forces interactive mode when --id is set.

If the CLI fails with EADDRINUSE on 127.0.0.1:25463:
  cline doctor fix
  # or
  cline hub stop

Then retry:
  cline --id $ORIGINAL_SESSION_ID
CMDS

say "Output directory"
echo "$OUT_DIR"
