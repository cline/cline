#!/usr/bin/env bash
# Runs one headless QA case and captures the evidence a case report needs.
#
# The workspace is reset from its git baseline first, so `git diff` afterwards is
# the authoritative record of what the tools actually did — never the UI's
# rendered diff.
#
#   run-case.sh --instance cli --id D3-baseline --provider openai-compatible \
#               --model fault/tool-edit --prompt "..."
#
# Evidence lands in $QA_ROOT/results/<id>/.

set -uo pipefail

FIXTURES="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
QA_ROOT="${QA_ROOT:-/tmp/cline-qa}"

instance="cli"
case_id=""
provider=""
model=""
prompt=""
timeout_s="${QA_RUN_TIMEOUT:-300}"

while [ $# -gt 0 ]; do
  case "$1" in
    --instance) instance="$2"; shift 2 ;;
    --id)       case_id="$2"; shift 2 ;;
    --provider) provider="$2"; shift 2 ;;
    --model)    model="$2"; shift 2 ;;
    --prompt)   prompt="$2"; shift 2 ;;
    --timeout)  timeout_s="$2"; shift 2 ;;
    *) printf 'unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
done

[ -n "$case_id" ] || { printf -- '--id is required\n' >&2; exit 2; }
[ -n "$prompt" ]  || { printf -- '--prompt is required\n' >&2; exit 2; }

ROOT="$QA_ROOT/$instance"
W="$ROOT/workspace"
OUT="$QA_ROOT/results/$case_id"
[ -d "$W" ] || { printf 'no workspace at %s (run qa-env.sh prepare %s)\n' "$W" "$instance" >&2; exit 1; }

rm -rf "$OUT"
mkdir -p "$OUT"

# 1. reset the workspace to its committed baseline
git -C "$W" checkout -- . 2>/dev/null
git -C "$W" clean -fdq 2>/dev/null

# 2. point the instance at the provider/model under test
if [ -n "$provider" ]; then
  bash "$FIXTURES/qa-env.sh" select "$instance" "$provider" "$model" > "$OUT/select.txt" 2>&1 || {
    cat "$OUT/select.txt"; exit 1; }
fi
bash "$FIXTURES/qa-env.sh" state "$instance" > "$OUT/state-before.txt" 2>&1

# 3. clear the recorded wire traffic
bash "$FIXTURES/qa-env.sh" proxy reset >/dev/null 2>&1

# 4. send the prompt
printf '%s' "$prompt" > "$OUT/prompt.txt"
start=$(date +%s)
QA_RUN_TIMEOUT="$timeout_s" bash "$FIXTURES/qa-env.sh" run "$instance" "$prompt" \
  > "$OUT/transcript.txt" 2>&1
run_exit=$?
end=$(date +%s)
printf '%s\n' "$run_exit" > "$OUT/exit-code.txt"

# 5. the authoritative record of what happened to the files
git -C "$W" diff > "$OUT/git-diff.txt" 2>&1
git -C "$W" status --short > "$OUT/git-status.txt" 2>&1

# byte-exact view of every tracked-or-new text file that changed
{
  while IFS= read -r line; do
    file="${line:3}"
    [ -f "$W/$file" ] || continue
    printf '===== cat -A %s =====\n' "$file"
    cat -A "$W/$file"
    printf '\n'
  done < <(git -C "$W" status --short)
} > "$OUT/cat-A.txt" 2>&1

# 6. what Cline actually put on the wire
bash "$FIXTURES/qa-env.sh" proxy tail > "$OUT/proxy.txt" 2>&1

cat > "$OUT/summary.txt" <<EOF
case:      $case_id
instance:  $instance
provider:  ${provider:-(unchanged)}
model:     ${model:-(unchanged)}
exit:      $run_exit
duration:  $((end - start))s
workspace: $W
EOF

printf '\n===== %s =====\n' "$case_id"
cat "$OUT/summary.txt"
printf '\n----- git diff -----\n'
if [ -s "$OUT/git-diff.txt" ]; then cat "$OUT/git-diff.txt"; else printf '(no tracked-file changes)\n'; fi
printf '\n----- git status -----\n'
if [ -s "$OUT/git-status.txt" ]; then cat "$OUT/git-status.txt"; else printf '(clean)\n'; fi
printf '\n----- transcript (tail) -----\n'
tail -30 "$OUT/transcript.txt"
printf '\nevidence: %s\n' "$OUT"
