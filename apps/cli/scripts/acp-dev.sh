#!/bin/bash
# Launch the Cline CLI in ACP mode from source, for use as a Zed custom agent.
#
# Zed spawns agents without your interactive shell's PATH, so `bun` (installed
# via mise/asdf/nvm/homebrew) is usually not resolvable. This wrapper finds bun
# explicitly and execs it from the repo root.
#
# IMPORTANT: stdout is the JSON-RPC channel. Never echo to stdout here — any
# stray byte corrupts the ACP stream. Diagnostics go to stderr.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

# Prefer an explicit override, then PATH, then common version-manager locations.
if [ -n "${BUN_BIN:-}" ]; then
	bun_bin="$BUN_BIN"
elif command -v bun > /dev/null 2>&1; then
	bun_bin="$(command -v bun)"
else
	bun_bin=""
	for candidate in \
		"$HOME"/.local/share/mise/installs/bun/*/bin/bun \
		"$HOME"/.bun/bin/bun \
		/opt/homebrew/bin/bun \
		/usr/local/bin/bun; do
		if [ -x "$candidate" ]; then
			bun_bin="$candidate"
			break
		fi
	done
fi

if [ -z "$bun_bin" ]; then
	echo "acp-dev.sh: could not find the 'bun' executable; set BUN_BIN to its path" >&2
	exit 127
fi

cd "$REPO_ROOT"
exec "$bun_bin" --conditions=development --cwd apps/cli dev --acp "$@"
