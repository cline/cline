#!/usr/bin/env bash
# install-cline-macm4.sh
# Idempotent installer for the Cline macm4 fork (VSIX pulled fresh from GCS).
# Supports Cursor, VS Code, or both.
#
# Usage:
#   ./scripts/install-cline-macm4.sh
#   TARGET=cursor  ./scripts/install-cline-macm4.sh   # non-interactive
#   TARGET=vscode  ./scripts/install-cline-macm4.sh
#   TARGET=both    ./scripts/install-cline-macm4.sh

set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Colours
# ─────────────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

ok()     { echo -e "  ${GREEN}✓${NC}  $*"; }
info()   { echo -e "  ${CYAN}→${NC}  ${DIM}$*${NC}"; }
warn()   { echo -e "  ${YELLOW}⚠${NC}   $*"; }
fail()   { echo -e "  ${RED}✗${NC}  ${RED}$*${NC}"; }
header() {
    local msg="$1"
    local width=62
    echo ""
    echo -e "${MAGENTA}${BOLD}$(printf '%.0s─' $(seq 1 $width))${NC}"
    printf "${MAGENTA}${BOLD}  %-$((width - 4))s  ${NC}\n" "$msg"
    echo -e "${MAGENTA}${BOLD}$(printf '%.0s─' $(seq 1 $width))${NC}"
    echo ""
}
divider() { echo -e "${DIM}$(printf '%.0s─' $(seq 1 62))${NC}"; }

# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────
GCS_BUCKET="cline-repo"
GCS_OBJECT="cline-macm4/cline-macm4-latest.vsix"
GCS_URI="gs://${GCS_BUCKET}/${GCS_OBJECT}"
VSIX_DEST="/tmp/cline-macm4-latest.vsix"

FORK_PUBLISHER="martinfr-certifyos"
FORK_EXT_ID="${FORK_PUBLISHER}.claude-dev"
UPSTREAM_EXT_ID="saoudrizwan.claude-dev"

CURSOR_APP="/Applications/Cursor.app"
CURSOR_CLI="${CURSOR_APP}/Contents/Resources/app/bin/cursor"
CURSOR_EXT_DIR="${HOME}/.cursor/extensions"

VSCODE_APP="/Applications/Visual Studio Code.app"
VSCODE_CLI="${VSCODE_APP}/Contents/Resources/app/bin/code"
VSCODE_EXT_DIR="${HOME}/.vscode/extensions"

# ─────────────────────────────────────────────────────────────────────────────
# IDE detection helpers
# ─────────────────────────────────────────────────────────────────────────────
cursor_present() { [[ -d "$CURSOR_APP" && -x "$CURSOR_CLI" ]]; }
vscode_present()  { [[ -d "$VSCODE_APP"  && -x "$VSCODE_CLI"  ]]; }

cline_in_dir() {
    local ext_dir="$1"
    [[ -d "$ext_dir" ]] || { echo ""; return; }
    ls "$ext_dir" 2>/dev/null \
        | grep -E "^(saoudrizwan|martinfr-certifyos)\.claude-dev-" \
        | head -1 || true
}
cline_in_cursor() { cline_in_dir "$CURSOR_EXT_DIR"; }
cline_in_vscode()  { cline_in_dir "$VSCODE_EXT_DIR"; }

# ─────────────────────────────────────────────────────────────────────────────
# Banner
# ─────────────────────────────────────────────────────────────────────────────
header "Cline macm4 Installer"
echo -e "  Source  :  ${CYAN}${GCS_URI}${NC}"
echo -e "  Fork ID :  ${MAGENTA}${FORK_EXT_ID}${NC}"
echo -e "  VSIX    :  ${DIM}${VSIX_DEST}${NC}"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# PRE-FLIGHT — run every check, collect ALL failures, report once
# ─────────────────────────────────────────────────────────────────────────────
header "Pre-flight checks"

PREFLIGHT_PASS=true
PREFLIGHT_ERRORS=()   # human-readable error messages
PREFLIGHT_FIXES=()    # matching remediation hints

add_error() {
    PREFLIGHT_ERRORS+=("$1")
    PREFLIGHT_FIXES+=("$2")
    PREFLIGHT_PASS=false
}

# ── 1. gcloud CLI present ────────────────────────────────────────────────────
if command -v gcloud &>/dev/null; then
    GCLOUD_VER=$(gcloud --version 2>/dev/null | head -1)
    ok "gcloud CLI found   (${DIM}${GCLOUD_VER}${NC})"
else
    fail "gcloud CLI not found"
    add_error \
        "gcloud CLI is not installed or not on PATH" \
        "Install from https://cloud.google.com/sdk/docs/install then re-run this script"
fi

# ── 2. gcloud authenticated ──────────────────────────────────────────────────
if command -v gcloud &>/dev/null; then
    ACTIVE_ACCOUNT=$(gcloud auth list --filter="status:ACTIVE" --format="value(account)" 2>/dev/null | head -1 || true)
    if [[ -n "$ACTIVE_ACCOUNT" ]]; then
        ok "gcloud authenticated  (${DIM}${ACTIVE_ACCOUNT}${NC})"
    else
        fail "gcloud has no active authenticated account"
        add_error \
            "No active gcloud credentials found" \
            "Run:  gcloud auth login"
    fi
fi

# ── 3. GCP project configured ────────────────────────────────────────────────
if command -v gcloud &>/dev/null; then
    ACTIVE_PROJECT=$(gcloud config get-value project 2>/dev/null | tr -d '[:space:]' || true)
    if [[ -n "$ACTIVE_PROJECT" && "$ACTIVE_PROJECT" != "(unset)" ]]; then
        ok "GCP project set       (${DIM}${ACTIVE_PROJECT}${NC})"
    else
        fail "GCP project not configured"
        add_error \
            "No GCP project is set in gcloud config" \
            "Run:  gcloud config set project certifyos-development"
    fi
fi

# ── 4. GCS bucket readable + object exists ───────────────────────────────────
if command -v gcloud &>/dev/null && [[ -n "${ACTIVE_ACCOUNT:-}" ]] && [[ -n "${ACTIVE_PROJECT:-}" ]] && [[ "$ACTIVE_PROJECT" != "(unset)" ]]; then
    if gcloud storage objects describe "$GCS_URI" --format="value(name)" &>/dev/null; then
        REMOTE_SIZE=$(gcloud storage objects describe "$GCS_URI" --format="value(size)" 2>/dev/null || echo "?")
        ok "GCS object accessible (${DIM}${GCS_URI}${NC}, ${REMOTE_SIZE} bytes)"
    else
        fail "Cannot access GCS object  ${GCS_URI}"
        add_error \
            "GCS object not accessible: ${GCS_URI}" \
            "Ensure you have 'Storage Object Viewer' on gs://${GCS_BUCKET} — ask the macm4 team, or run: gcloud auth application-default login"
    fi
else
    warn "Skipping GCS object check (auth/project issues above must be fixed first)"
fi

# ── 5. At least one IDE present ──────────────────────────────────────────────
HAS_CURSOR=false
HAS_VSCODE=false
cursor_present && HAS_CURSOR=true || true
vscode_present  && HAS_VSCODE=true  || true

if $HAS_CURSOR; then
    ok "Cursor found          (${DIM}${CURSOR_APP}${NC})"
else
    warn "Cursor not found      (${DIM}${CURSOR_APP}${NC})"
fi

if $HAS_VSCODE; then
    ok "VS Code found         (${DIM}${VSCODE_APP}${NC})"
else
    warn "VS Code not found     (${DIM}${VSCODE_APP}${NC})"
fi

if ! $HAS_CURSOR && ! $HAS_VSCODE; then
    add_error \
        "Neither Cursor nor VS Code found in /Applications" \
        "Install Cursor (https://cursor.sh) or VS Code (https://code.visualstudio.com) and try again"
fi

# ── 6. Report existing Cline installs (informational) ────────────────────────
CURSOR_EXISTING=$(cline_in_cursor)
VSCODE_EXISTING=$(cline_in_vscode)

if [[ -n "$CURSOR_EXISTING" ]]; then
    warn "Cursor has Cline already  (${DIM}${CURSOR_EXISTING}${NC})  — will be replaced"
fi
if [[ -n "$VSCODE_EXISTING" ]]; then
    warn "VS Code has Cline already (${DIM}${VSCODE_EXISTING}${NC})  — will be replaced"
fi

# ── 7. /tmp writable ─────────────────────────────────────────────────────────
if touch /tmp/.cline-macm4-write-test 2>/dev/null && rm /tmp/.cline-macm4-write-test; then
    ok "/tmp is writable"
else
    fail "/tmp is not writable"
    add_error \
        "/tmp directory is not writable" \
        "Check disk permissions or set TMPDIR to a writable location and update VSIX_DEST in this script"
fi

# ── Results ───────────────────────────────────────────────────────────────────
echo ""
if ! $PREFLIGHT_PASS; then
    divider
    echo -e "  ${RED}${BOLD}Pre-flight FAILED — fix the issues below before continuing:${NC}"
    echo ""
    local_idx=0
    for msg in "${PREFLIGHT_ERRORS[@]}"; do
        echo -e "  ${RED}✗${NC}  ${RED}${msg}${NC}"
        echo -e "     ${DIM}Fix: ${PREFLIGHT_FIXES[$local_idx]}${NC}"
        echo ""
        (( local_idx++ )) || true
    done
    divider
    echo ""
    exit 1
fi

ok "All pre-flight checks passed — ready to install"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# Choose target IDE(s)
# ─────────────────────────────────────────────────────────────────────────────
TARGET="${TARGET:-}"

if [[ -z "$TARGET" ]]; then
    echo -e "  ${BOLD}Where should Cline macm4 be installed?${NC}"
    echo ""

    OPTIONS=()
    if $HAS_CURSOR && $HAS_VSCODE; then
        echo -e "    ${CYAN}1${NC})  Cursor only"
        echo -e "    ${CYAN}2${NC})  VS Code only"
        echo -e "    ${CYAN}3${NC})  Both (Cursor + VS Code)"
        OPTIONS=(cursor vscode both)
    elif $HAS_CURSOR; then
        echo -e "    ${CYAN}1${NC})  Cursor"
        OPTIONS=(cursor)
    else
        echo -e "    ${CYAN}1${NC})  VS Code"
        OPTIONS=(vscode)
    fi
    echo ""

    while true; do
        read -rp "$(echo -e "  ${BOLD}Choice [1-${#OPTIONS[@]}]: ${NC}")" choice
        if [[ "$choice" =~ ^[0-9]+$ ]] && (( choice >= 1 && choice <= ${#OPTIONS[@]} )); then
            TARGET="${OPTIONS[$((choice - 1))]}"
            break
        fi
        echo -e "  ${RED}Invalid — enter a number between 1 and ${#OPTIONS[@]}.${NC}"
    done
fi

case "$TARGET" in
    cursor) DO_CURSOR=true;  DO_VSCODE=false ;;
    vscode) DO_CURSOR=false; DO_VSCODE=true  ;;
    both)   DO_CURSOR=true;  DO_VSCODE=true  ;;
    *)      echo -e "  ${RED}Unknown TARGET '${TARGET}'. Use: cursor | vscode | both${NC}" >&2; exit 1 ;;
esac

echo ""
echo -e "  Target : ${MAGENTA}${BOLD}${TARGET}${NC}"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# Confirm
# ─────────────────────────────────────────────────────────────────────────────
read -rp "$(echo -e "  ${BOLD}Proceed? [y/N]: ${NC}")" confirm
confirm_lc=$(echo "$confirm" | tr '[:upper:]' '[:lower:]')
[[ "$confirm_lc" == "y" ]] || { echo "  Aborted."; echo ""; exit 0; }
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# Step 1 — Download fresh VSIX from GCS
# ─────────────────────────────────────────────────────────────────────────────
header "Step 1 of 3 — Download from GCS"
info "Source : ${GCS_URI}"
info "Dest   : ${VSIX_DEST}"
echo ""

# Always download fresh — remove stale copy from any previous run
[[ -f "$VSIX_DEST" ]] && rm -f "$VSIX_DEST"

gcloud storage cp "$GCS_URI" "$VSIX_DEST"

VSIX_SIZE=$(du -sh "$VSIX_DEST" 2>/dev/null | cut -f1)
ok "Downloaded  ${VSIX_DEST}  (${VSIX_SIZE})"

# ─────────────────────────────────────────────────────────────────────────────
# Helper — remove + install for one IDE
# ─────────────────────────────────────────────────────────────────────────────
install_into_ide() {
    local ide_name="$1"
    local cli="$2"
    local ext_dir="$3"

    echo ""
    info "${ide_name}: removing any existing Cline installs..."

    # Via CLI (handles extension-host deactivation cleanly)
    for ext_id in "$FORK_EXT_ID" "$UPSTREAM_EXT_ID"; do
        if "$cli" --list-extensions 2>/dev/null | grep -qi "^${ext_id}$"; then
            info "${ide_name}: uninstalling ${ext_id} via CLI"
            "$cli" --uninstall-extension "$ext_id" &>/dev/null || true
        fi
    done

    # Belt-and-suspenders: nuke leftover directories (handles version-mismatch orphans)
    if [[ -d "$ext_dir" ]]; then
        while IFS= read -r dir; do
            [[ -z "$dir" ]] && continue
            info "${ide_name}: removing directory ${dir}"
            rm -rf "${ext_dir:?}/${dir}"
        done < <(ls "$ext_dir" 2>/dev/null \
            | grep -E "^(saoudrizwan|martinfr-certifyos)\.claude-dev-" || true)
    fi

    info "${ide_name}: installing ${VSIX_DEST}..."
    "$cli" --install-extension "$VSIX_DEST" --force
    ok "${ide_name}: Cline macm4 installed successfully"
}

# ─────────────────────────────────────────────────────────────────────────────
# Step 2 — Install
# ─────────────────────────────────────────────────────────────────────────────
header "Step 2 of 3 — Install"

INSTALLED_CURSOR=false
INSTALLED_VSCODE=false

if $DO_CURSOR; then
    install_into_ide "Cursor"  "$CURSOR_CLI"  "$CURSOR_EXT_DIR"  && INSTALLED_CURSOR=true
fi

if $DO_VSCODE; then
    install_into_ide "VS Code" "$VSCODE_CLI"  "$VSCODE_EXT_DIR"  && INSTALLED_VSCODE=true
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step 3 — Summary + next steps
# ─────────────────────────────────────────────────────────────────────────────
header "Step 3 of 3 — Summary"

echo -e "  VSIX pulled from : ${CYAN}${GCS_URI}${NC}"
echo ""
echo -e "  ${BOLD}Installation results:${NC}"
echo ""

if $DO_CURSOR; then
    $INSTALLED_CURSOR \
        && echo -e "    ${GREEN}✓${NC}  Cursor  — ${FORK_EXT_ID}" \
        || echo -e "    ${RED}✗${NC}  Cursor  — ${RED}FAILED${NC}"
fi
if $DO_VSCODE; then
    $INSTALLED_VSCODE \
        && echo -e "    ${GREEN}✓${NC}  VS Code — ${FORK_EXT_ID}" \
        || echo -e "    ${RED}✗${NC}  VS Code — ${RED}FAILED${NC}"
fi

echo ""
divider
echo -e "  ${BOLD}What to do next — wiring up Cline macm4${NC}"
divider
echo ""
echo -e "  ${CYAN}1.  Reload your IDE${NC}"
echo -e "      Close and reopen Cursor / VS Code, or use:"
echo -e "      ${DIM}Cmd+Shift+P → Developer: Reload Window${NC}"
echo ""
echo -e "  ${CYAN}2.  Open the Cline panel${NC}"
echo -e "      Click the Cline robot icon in the Activity Bar (left sidebar)."
echo -e "      Not visible? ${DIM}Cmd+Shift+P → \"Cline: Open in Sidebar\"${NC}"
echo ""
echo -e "  ${CYAN}3.  Configure your AI provider${NC}"
echo -e "      On first open you will be prompted for a provider + API key."
echo -e "      Use ${MAGENTA}Anthropic${NC} (claude-sonnet-4-5 or later) or the team"
echo -e "      OpenRouter key — ask in ${DIM}#macm4-engineering${NC} Slack channel."
echo ""
echo -e "  ${CYAN}4.  Verify macm4 workspace rules are loaded${NC}"
echo -e "      Open this repo in your IDE, then open Cline settings"
echo -e "      (gear icon in the Cline panel) and confirm:"
echo -e "      ${DIM}Custom Instructions → .clinerules/general.md${NC} is shown."
echo -e "      The rules in ${DIM}.clinerules/${NC} load automatically per-workspace."
echo ""
echo -e "  ${CYAN}5.  Check MCP servers (recommended)${NC}"
echo -e "      In Cline settings → MCP Servers, verify these show ${GREEN}Connected${NC}:"
echo -e "      ${DIM}• plugin-certifyos-ai-governance-gcs${NC}"
echo -e "      ${DIM}• plugin-certifyos-ai-governance-atlassian${NC}"
echo -e "      ${DIM}• plugin-certifyos-ai-governance-slack${NC}"
echo -e "      ${DIM}• plugin-certifyos-ai-governance-sonarqube${NC}"
echo -e "      ${DIM}• plugin-certifyos-ai-governance-gcp-observability${NC}"
echo ""
echo -e "  ${CYAN}6.  Run a smoke-test prompt${NC}"
echo -e "      Try: ${DIM}\"What branch am I on and what files have changed?\"${NC}"
echo -e "      Cline macm4 should answer using the repo context and clinerules."
echo ""
divider
echo -e "  Idempotent: re-running this script always pulls the latest"
echo -e "  VSIX from GCS and replaces the installed version cleanly."
divider
echo ""
