#!/usr/bin/env bash
set -euo pipefail
curl -fsSL https://bun.sh/install|bash; printf '\nexport PATH=$HOME/.bun/bin:$HOME/go/bin:$PATH\n'>>~/.bashrc; go install github.com/zricethezav/gitleaks/v8@latest; ~/.bun/bin/bunx playwright install chromium
