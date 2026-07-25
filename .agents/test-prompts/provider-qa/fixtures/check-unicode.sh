#!/usr/bin/env bash
# Byte-for-byte verdict for the D2 unicode case.
#
# Compares a produced file against the expected four-line payload, ignoring only
# a trailing newline (which the prompt does not pin down). Anything else — a
# truncation at the first quote, a lost newline, a double-escaped backslash,
# mangled non-ASCII, a tab turned into spaces — shows up as a difference.

set -uo pipefail

actual="${1:?usage: check-unicode.sh <file>}"

expected="$(mktemp)"
trap 'rm -f "$expected" "$expected.trim" "$actual.trim"' EXIT

printf 'line one with "double quotes" and '"'"'single quotes'"'"'\nline two with a backslash \\ and a brace }\nline three with an em dash \xe2\x80\x94 and an emoji \xf0\x9f\x9a\x80\n\tline four starts with a tab\n' > "$expected"

if [ ! -f "$actual" ]; then
  printf 'VERDICT: MISSING — %s does not exist\n' "$actual"
  exit 1
fi

printf '%s\n' "----- cat -A $actual -----"
cat -A "$actual"
printf '%s\n' "" "----- expected cat -A -----"
cat -A "$expected"

# strip a single trailing newline from both sides before comparing
printf '%s' "$(cat "$expected")" > "$expected.trim"
printf '%s' "$(cat "$actual")"   > "$actual.trim"

printf '%s\n' "" "----- verdict -----"
if cmp -s "$expected.trim" "$actual.trim"; then
  printf 'VERDICT: IDENTICAL byte for byte (%s bytes, trailing newline ignored)\n' "$(wc -c < "$actual.trim")"
  exit 0
fi

printf 'VERDICT: DIFFERS\n'
cmp "$expected.trim" "$actual.trim" || true
printf '%s\n' "" "--- first differing bytes ---"
diff <(od -c "$expected.trim") <(od -c "$actual.trim") | head -20
exit 1
