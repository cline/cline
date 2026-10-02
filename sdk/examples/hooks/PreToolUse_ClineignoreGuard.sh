#!/usr/bin/env bash
# Cline Hook: PreToolUse (.clineignore guard)
# Blocks file reads, edits, and shell commands whose paths match
# gitignore-style patterns listed in <workspace>/.clineignore.
#
# Works with both file-hook payload shapes:
#   - VS Code extension hooks (.clinerules/hooks/PreToolUse):
#     .preToolUse.toolName + .preToolUse.parameters (values JSON-stringified)
#   - CLI / SDK file hooks (.cline/hooks/PreToolUse.sh):
#     .tool_call.name + .tool_call.input
#
# Install (VS Code extension — name must be exactly "PreToolUse"):
#   mkdir -p .clinerules/hooks
#   cp PreToolUse_ClineignoreGuard.sh .clinerules/hooks/PreToolUse
#   chmod +x .clinerules/hooks/PreToolUse
#   ...and check "Enable Hooks" in Cline's feature settings.
#
# Install (CLI):
#   mkdir -p .cline/hooks
#   cp PreToolUse_ClineignoreGuard.sh .cline/hooks/PreToolUse.sh
#   chmod +x .cline/hooks/PreToolUse.sh
#
# Then list the files to protect in a .clineignore file at your workspace
# root using .gitignore syntax (directories, globs, and ! negations work).
#
# Requires: jq, git (used only as a pattern matcher; the workspace does not
# need to be a git repository).

set -eu

input=$(cat)

tool=$(echo "$input" | jq -r '.tool_call.name // .preToolUse.toolName // ""')

# Only guard tools that read or write files or run shell commands.
case "$tool" in
  read_files|editor|apply_patch|run_commands) ;;
  *) echo '{"cancel": false}'; exit 0 ;;
esac

root=$(echo "$input" | jq -r '.workspaceRoots[0] // empty')
[ -n "$root" ] || root="$PWD"
ignore_file="$root/.clineignore"
if [ ! -f "$ignore_file" ]; then
  echo '{"cancel": false}'
  exit 0
fi

# Normalize the tool input: prefer the rich CLI shape, fall back to the
# extension's stringified parameters (dejson re-parses those values).
jq_prelude='
  def dejson: if type == "string" then (fromjson? // .) else . end;
  ((.tool_call.input // .preToolUse.parameters // {}) | dejson) as $in |'

# Collect every candidate path from the tool input.
case "$tool" in
  apply_patch)
    # apply_patch carries its paths inside the patch body headers.
    paths=$(echo "$input" | jq -r "$jq_prelude"'
        if ($in | type) == "string" then $in
        elif ($in | type) == "object" then ($in.input // "" | dejson)
        else "" end | strings' \
      | sed -n \
          -e 's/^\*\*\* Add File: //p' \
          -e 's/^\*\*\* Update File: //p' \
          -e 's/^\*\*\* Delete File: //p' \
          -e 's/^\*\*\* Move to: //p')
    ;;
  run_commands)
    # Conservative shell guard: treat every token of every command as a
    # candidate path. Catches straightforward access like `cat .env`
    # without attempting full shell parsing.
    paths=$(echo "$input" | jq -r "$jq_prelude"'
        (if ($in | type) == "string" then [$in]
         elif ($in | type) == "array" then $in
         elif ($in | type) == "object" then
           [($in.commands // $in.command // $in.cmd // empty) | dejson] | flatten
         else [] end)
        | .[]
        | if type == "object"
          then ((.command // empty), ((.args // []) | dejson | .[]?))
          else . end
        | strings' \
      | tr -s '[:space:];|&()<>' '\n' \
      | sed -e "s/^[\"']*//" -e "s/[\"']*\$//" \
      | grep -v '^-' | grep -v '^$' || true)
    ;;
  *)
    # read_files / editor accept a few input shapes:
    # {files: [{path}]}, {path}, plain strings, string arrays, aliases...
    paths=$(echo "$input" | jq -r "$jq_prelude"'
        (if ($in | type) == "string" then [$in]
         elif ($in | type) == "array" then $in
         elif ($in | type) == "object" then
           [$in.path?, $in.file_path?, $in.filePath?]
           + (($in.files // []) | dejson | if type == "array" then . else [.] end)
           + (($in.paths // []) | dejson | if type == "array" then . else [.] end)
           + (($in.file_paths // []) | dejson | if type == "array" then . else [.] end)
         else [] end)
        | .[]
        | dejson
        | if type == "object" then (.path // .file_path // .filePath // empty) else . end
        | strings')
    ;;
esac

# Lexically collapse ".", "..", and empty segments of an absolute path, so
# noncanonical forms like ./.clineignore or secrets/../.env cannot slip
# past the checks below.
normalize_abs() {
  local out="" seg rest="$1/"
  while [ -n "$rest" ]; do
    seg="${rest%%/*}"
    rest="${rest#*/}"
    case "$seg" in
      ""|".") ;;
      "..") out="${out%/*}" ;;
      *) out="$out/$seg" ;;
    esac
  done
  printf '%s\n' "${out:-/}"
}

# Make paths canonical and workspace-relative. Paths that resolve outside
# the workspace are not covered by .clineignore, so they pass through.
root=$(normalize_abs "$root")
rel_paths=""
while IFS= read -r p; do
  [ -n "$p" ] || continue
  case "$p" in
    /*) ;;
    *) p="$root/$p" ;;
  esac
  p=$(normalize_abs "$p")
  case "$p" in
    "$root"/*) rel_paths+="${p#"$root"/}"$'\n' ;;
  esac
done <<< "$paths"

if [ -z "$rel_paths" ]; then
  echo '{"cancel": false}'
  exit 0
fi

# The guard is only as strong as the ignore file itself: protect
# .clineignore from modification so the agent cannot un-ignore files.
if [ "$tool" != "read_files" ] && printf '%s' "$rel_paths" | grep -qx '\.clineignore'; then
  jq -n --arg tool "$tool" \
    '{cancel: true, errorMessage: "Blocked \($tool): modifying .clineignore is not allowed. Update it yourself if a file should be un-ignored."}'
  exit 0
fi

# Evaluate the paths against .clineignore with real gitignore semantics via
# `git check-ignore`. Running it inside an empty scratch repo scopes the
# check to .clineignore alone -- the workspace's own .gitignore files are
# never consulted, and this works even outside a git repository.
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
git init -q "$scratch"

blocked=$(printf '%s' "$rel_paths" \
  | git -C "$scratch" -c core.excludesFile="$ignore_file" check-ignore --stdin --no-index 2>/dev/null \
  | paste -sd, -)

if [ -n "$blocked" ]; then
  jq -n --arg tool "$tool" --arg files "$blocked" \
    '{cancel: true, errorMessage: "Blocked \($tool): \($files) matched a .clineignore pattern, so Cline may not access it. Update .clineignore if access should be allowed."}'
else
  echo '{"cancel": false}'
fi
