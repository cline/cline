#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat <<'HELP'
Cline runtime installer (no Node, Bun, or administrator access required)
Usage: install.sh --release <desktop-tag> [options]
Default command: ~/.local/bin/cline (versioned standalone releases)
  --version <version>       Shorthand for --release desktop-v<version>
  --target <triple>         Download for another machine (e.g. an SSH host)
  --install-dir <directory> Explicit runtime cache directory
  --binary <path>           Install a local binary without downloading
  --managed                Use versioned releases with a stable command entry
  --replace-existing       Install standalone alongside an external CLI; never uninstall
  --no-modify-path          Leave shell configuration untouched
  -h, --help                Show this help
HELP
}
fail() { printf 'Cline install: %s\n' "$*" >&2; exit 1; }
release=''
target=''
install_dir="$HOME/.local/bin"
managed=true
managed_option=false
replace_existing=false
binary=''
modify_path=true
explicit_directory=false
explicit_target=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help) usage; exit 0 ;;
        --managed) managed_option=true; shift ;;
        --replace-existing) replace_existing=true; shift ;;
        --no-modify-path) modify_path=false; shift ;;
        --release|--version|--target|--install-dir|--binary)
            [[ $# -ge 2 && -n "$2" && "$2" != --* ]] || fail "$1 requires a value"
            case "$1" in
                --release) release="$2" ;;
                --version) release="desktop-v${2#v}" ;;
                --target) target="$2"; explicit_target=true ;;
                --install-dir) install_dir="$2"; explicit_directory=true ;;
                --binary) binary="$2" ;;
            esac
            shift 2 ;;
        *) fail "unknown option: $1" ;;
    esac
done
if [[ "$explicit_directory" == true && "$managed_option" == false ]]; then managed=false; fi
case "$install_dir" in
    /*) ;;
    *) install_dir="$PWD/$install_dir" ;;
esac
if [[ -z "$target" ]]; then
    arch=$(uname -m)
    case "$arch" in arm64|aarch64) arch=aarch64 ;; x86_64) ;; *) fail "unsupported architecture: $arch" ;; esac
    case "$(uname -s)" in
        Darwin) target=universal-apple-darwin ;;
        Linux)
            if [[ -f /etc/alpine-release ]] || { command -v ldd >/dev/null && ldd --version 2>&1 | grep -qi musl; }; then
                fail 'Linux runtime requires glibc; musl/Alpine is not supported'
            fi
            target="$arch-unknown-linux-gnu" ;;
        *) fail 'this installer supports macOS and Linux only' ;;
    esac
fi
case "$target" in
    universal-apple-darwin|x86_64-unknown-linux-gnu|aarch64-unknown-linux-gnu) ;;
    *) fail "unsupported target: $target" ;;
esac
if [[ -n "$release" || -z "$binary" ]]; then
    [[ "$release" =~ ^desktop-(v[0-9]+\.[0-9]+\.[0-9]+(-beta\.[0-9]+)?|nightly-[0-9]+)$ ]] || fail 'provide an exact desktop release tag with --release or --version'
fi
[[ -n "$binary" ]] || command -v curl >/dev/null || fail 'curl is required'
# Reuse a compatible terminal installation, including a package-manager
# wrapper. Never modify package-owned files or silently add a second CLI.
if [[ "$explicit_directory" == false ]]; then
    existing=$(command -v cline || true)
    if [[ -n "$existing" && "$existing" != "$install_dir/cline" ]]; then
        # Resolve links only to identify package ownership; never delete their files.
        owned="$existing"
        for ((links=0; links<40; links++)); do
            [[ -L "$owned" ]] || break
            link=$(readlink "$owned")
            case "$link" in /*) owned="$link" ;; *) owned="$(dirname "$owned")/$link" ;; esac
        done
        manager=''
        case "$owned" in
            */Cellar/cline/*) manager=brew ;;
            */node_modules/cline/*) manager=npm ;;
        esac
        [[ "$owned" != "$HOME/.bun/"* ]] || manager=bun
        if [[ -n "$manager" ]]; then
            case "$manager" in
                brew) removal=(brew uninstall cline) ;;
                npm) removal=(npm uninstall -g cline) ;;
                bun) removal=(bun remove -g cline) ;;
            esac
            printf 'Existing %s installation: %s. To remove it: %s\n' "$manager" "$existing" "${removal[*]}" >&2
            if [[ "$replace_existing" == false && -t 2 && -r /dev/tty ]]; then
                printf 'Remove this installation and install the standalone CLI? [y/N] ' >&2
                answer=''; read -r answer </dev/tty || true
                case "$answer" in
                    y|Y|yes|YES)
                        "${removal[@]}" >&2 || fail 'package-manager uninstall failed'
                        [[ ! -e "$existing" ]] || fail 'the original CLI still exists; remove it with its owning package manager before retrying'
                        replace_existing=true ;;
                esac
            fi
        else
            printf 'Existing CLI: %s. Remove it manually or use --replace-existing to select standalone.\n' "$existing" >&2
        fi
    fi
    if [[ -n "$existing" && "$existing" != "$install_dir/cline" && "$replace_existing" == false ]]; then
        if [[ -n "$binary" ]]; then
            expected_build=$("$binary" --runtime-build-id 2>/dev/null) || fail 'local binary cannot report its SDK identity'
        else
            expected_build=$(curl --fail --location --silent --show-error --connect-timeout 15 --max-time 30 --proto '=https' --proto-redir '=https' "https://github.com/cline/cline/releases/download/$release/cline-runtime-$target.build-id")
        fi
        installed_target=$(CLINE_NO_AUTO_UPDATE=1 "$existing" --runtime-target 2>/dev/null) || fail 'installed CLI cannot report its target'
        if [[ "$installed_target" != "$target" ]]; then
            [[ "$explicit_target" == false && "$target" == universal-apple-darwin && "$installed_target" == *-apple-darwin ]] || fail "existing CLI target $installed_target does not match requested $target; use --install-dir for a different machine"
        fi
        installed_build=$(CLINE_NO_AUTO_UPDATE=1 "$existing" --runtime-build-id 2>/dev/null) || fail "update or remove the existing CLI at $existing before installing; no second copy was installed"
        [[ -n "$expected_build" && "$installed_build" == "$expected_build" ]] || fail "the existing CLI at $existing has an incompatible SDK build; update or remove it before installing"
        installed_path=$(CLINE_NO_AUTO_UPDATE=1 "$existing" --runtime-path 2>/dev/null) || fail 'installed CLI could not report its native executable'
        [[ -f "$installed_path" ]] || fail 'installed CLI reported an invalid native executable'
        printf '%s\n' "$installed_path"
        exit 0
    fi
fi
hash_file() {
    if command -v sha256sum >/dev/null; then sha256sum "$1" | awk '{print $1}';
    elif command -v shasum >/dev/null; then shasum -a 256 "$1" | awk '{print $1}';
    else fail 'sha256sum or shasum is required'; fi
}
mkdir -p "$install_dir"
lock_dir="$install_dir"
if [[ "$managed" == true ]]; then
    releases="$HOME/.cline/packages/standalone/releases"
    mkdir -p "$releases"
    lock_dir="$releases"
fi
# Serialize installs in this directory across desktop/SSH clients. Never
# expose a partial download. Shared installs replace the previous runtime.
lock="$lock_dir/.install-lock"
owner="$$ $(TZ=UTC ps -p $$ -o lstart=)"
owner_is_stale() {
    local record="$1" pid="${1%% *}" start
    if [[ "$pid" =~ ^[0-9]+$ ]]; then
        start=$(TZ=UTC ps -p "$pid" -o lstart= 2>/dev/null | awk '{$1=$1; print}')
        [[ "$(printf '%s\n' "$record" | awk '{$1=$1; print}')" != "$pid $start" ]]
    else
        [[ -n "$2" ]]
    fi
}
# Recovery claims use the same owner protocol as the main lock. A dead claim
# is recovered through its own child claim, so interruption at any depth never
# leaves an unrecoverable directory or permits removing a live contender.
recover_lock() (
    local path="$1" expected="$2" current aged destination
    cd "$path" 2>/dev/null || exit 0
    aged=$(find . -prune -mmin +1 2>/dev/null || true)
    current=$(cat owner 2>/dev/null || true)
    [[ "$current" == "$expected" ]] && owner_is_stale "$current" "$aged" || exit 0
    if ! mkdir reclaim 2>/dev/null; then
        recover_lock "$path/reclaim" "$(cat reclaim/owner 2>/dev/null || true)"
        mkdir reclaim 2>/dev/null || exit 0
    fi
    printf '%s\n' "$owner" > reclaim/owner
    trap 'if [[ "$path" -ef . && "$(cat reclaim/owner 2>/dev/null || true)" == "$owner" ]]; then rm -rf reclaim; fi' EXIT
    current=$(cat owner 2>/dev/null || true)
    if [[ "$current" == "$expected" && "$path" -ef . ]] && owner_is_stale "$current" "$aged"; then
        destination="${path}.abandoned.$$"
        if mv "$path" "$destination" 2>/dev/null; then rm -rf "$destination"; fi
    fi
)
for ((attempt=0; ; attempt++)); do
    if mkdir "$lock" 2>/dev/null; then printf '%s\n' "$owner" > "$lock/owner"; break; fi
    previous=$(cat "$lock/owner" 2>/dev/null || true)
    aged=$(find "$lock" -prune -mmin +1 2>/dev/null || true)
    if owner_is_stale "$previous" "$aged"; then recover_lock "$lock" "$previous"; fi
    [[ $attempt -lt 240 ]] || fail "another installer holds $lock"
    sleep 0.5
done
temporary=''
cleanup() { [[ -z "$temporary" ]] || rm -rf "$temporary"; [[ "$(cat "$lock/owner" 2>/dev/null || true)" != "$owner" ]] || rm -rf "$lock"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# A managed entry is always our symlink. Never replace an unrelated command.
if [[ "$managed" == true && ( -e "$install_dir/cline" || -L "$install_dir/cline" ) ]]; then
    [[ -L "$install_dir/cline" ]] || fail "refusing to replace unrelated file $install_dir/cline"
    case "$(readlink "$install_dir/cline")" in
        "$HOME/.cline/packages/standalone/releases/"*/cline) ;;
        *) fail "refusing to replace unrelated link $install_dir/cline" ;;
    esac
fi
cached=false
state_dir="$install_dir"
if [[ "$managed" == true ]]; then
    if [[ -z "$binary" ]]; then
        for candidate in "$releases/$release-$target-"*; do
            [[ -f "$candidate/cline" && -f "$candidate/cline.sha256" && -f "$candidate/release" && -f "$candidate/cline.build-epoch" ]] || continue
            [[ "$(cat "$candidate/cline.build-epoch")" =~ ^[0-9]+$ ]] || continue
            if [[ "$(cat "$candidate/release")" == "$release/$target" && "$(hash_file "$candidate/cline")" == "$(cat "$candidate/cline.sha256")" ]]; then
                state_dir="$candidate"; cached=true; break
            fi
        done
    fi
elif [[ -z "$binary" && -f "$install_dir/cline" && -f "$install_dir/cline.sha256" && -f "$install_dir/release" && -f "$install_dir/cline.build-epoch" ]]; then
    if [[ "$(cat "$install_dir/release")" == "$release/$target" && "$(hash_file "$install_dir/cline")" == "$(cat "$install_dir/cline.sha256")" && "$(cat "$install_dir/cline.build-epoch")" =~ ^[0-9]+$ ]]; then cached=true; fi
fi
if [[ "$cached" == false ]]; then
    if [[ "$managed" == true ]]; then temporary=$(mktemp -d "$releases/.download.XXXXXX")
    else temporary=$(mktemp -d "$install_dir/.download.XXXXXX"); fi
    if [[ -n "$binary" ]]; then
        [[ -f "$binary" ]] || fail "binary not found: $binary"
        cp "$binary" "$temporary/cline"
    else
        asset="cline-runtime-$target"
        url="https://github.com/cline/cline/releases/download/$release/$asset"
        printf 'Installing Cline runtime %s (%s)…\n' "$release" "$target" >&2
        curl --fail --location --silent --show-error --connect-timeout 15 --max-time 180 --retry 2 --retry-max-time 180 --proto '=https' --proto-redir '=https' "$url.sha256" -o "$temporary/checksum"
        expected=$(awk '{print $1}' "$temporary/checksum")
        [[ "$expected" =~ ^[a-fA-F0-9]{64}$ ]] || fail 'invalid release checksum'
        curl --fail --location --silent --show-error --connect-timeout 15 --max-time 180 --retry 2 --retry-max-time 180 --proto '=https' --proto-redir '=https' "$url" -o "$temporary/cline"
        [[ "$(hash_file "$temporary/cline")" == "$expected" ]] || fail 'runtime checksum mismatch'
    fi
    chmod 755 "$temporary/cline"
    hash_file "$temporary/cline" > "$temporary/cline.sha256"
    printf '%s\n' "$release/$target" > "$temporary/release"
    expected_epoch=${CLINE_INSTALL_BUILD_EPOCH_MS:-}
    if [[ -z "$expected_epoch" ]]; then
        if [[ -n "$binary" ]]; then expected_epoch=$("$binary" --runtime-build-epoch 2>/dev/null || true)
        else expected_epoch=$(curl --fail --location --silent --show-error --connect-timeout 15 --max-time 30 --proto '=https' --proto-redir '=https' "$url.build-epoch"); fi
    fi
    [[ "$expected_epoch" =~ ^[0-9]+$ ]] || fail 'invalid runtime build epoch'
    printf '%s\n' "$expected_epoch" > "$temporary/cline.build-epoch"
    state_dir="$temporary"
fi
# Recheck under the activation lock, even when selecting a cached release.
expected_epoch=$(cat "$state_dir/cline.build-epoch")
installed_epoch=$(cat "$install_dir/cline.build-epoch" 2>/dev/null || true)
if [[ "$managed" == true && -L "$install_dir/cline" ]]; then
    installed_epoch=$(cat "$(dirname "$(readlink "$install_dir/cline")")/cline.build-epoch" 2>/dev/null || true)
fi
if [[ -x "$install_dir/cline" ]]; then
    actual_epoch=$(CLINE_NO_AUTO_UPDATE=1 "$install_dir/cline" --runtime-build-epoch 2>/dev/null || true)
    [[ ! "$actual_epoch" =~ ^[0-9]+$ ]] || installed_epoch="$actual_epoch"
fi
if [[ "$installed_epoch" =~ ^[0-9]+$ ]] && (( installed_epoch > expected_epoch )); then fail 'the installed CLI is newer; no downgrade was installed'; fi
if [[ "$managed" == true ]]; then
    # Host installs validate identity before the active command can change.
    expected_build=${CLINE_INSTALL_BUILD_ID:-}
    if [[ -z "$expected_build" ]]; then
        if [[ -n "$binary" ]]; then expected_build=$("$binary" --runtime-build-id)
        else expected_build=$(cat "$state_dir/build-id" 2>/dev/null || true)
            [[ -n "$expected_build" ]] || expected_build=$(curl --fail --location --silent --show-error --connect-timeout 15 --max-time 30 --proto '=https' --proto-redir '=https' "https://github.com/cline/cline/releases/download/$release/cline-runtime-$target.build-id")
        fi
    fi
    [[ -n "$expected_build" && "$(CLINE_NO_AUTO_UPDATE=1 "$state_dir/cline" --runtime-build-id)" == "$expected_build" ]] || fail 'downloaded runtime has an incompatible SDK build'
    actual_target=$(CLINE_NO_AUTO_UPDATE=1 "$state_dir/cline" --runtime-target)
    if [[ "$actual_target" != "$target" ]]; then
        [[ -n "$binary" && "$explicit_target" == false && "$target" == universal-apple-darwin && "$actual_target" == *-apple-darwin ]] || fail 'downloaded runtime target does not match requested target'
    fi
    [[ "$(CLINE_NO_AUTO_UPDATE=1 "$state_dir/cline" --runtime-build-epoch)" == "$expected_epoch" ]] || fail 'downloaded runtime build epoch does not match metadata'
    [[ -f "$state_dir/build-id" ]] || printf '%s\n' "$expected_build" > "$state_dir/build-id"
    selected="$releases/${release:-local}-$target-$(cat "$state_dir/cline.sha256")"
    if [[ "$cached" == false ]]; then
        if [[ -d "$selected" ]]; then
            [[ -f "$selected/cline" && "$(hash_file "$selected/cline")" == "$(cat "$state_dir/cline.sha256")" ]] || fail 'existing release directory is corrupt; remove it before retrying'
            # Repair interrupted metadata publication without changing running bytes.
            for file in cline.sha256 cline.build-epoch release build-id; do mv -f "$state_dir/$file" "$selected/$file"; done
        else mv "$temporary" "$selected"; temporary=''; fi
    fi
    # Stage the link beside the command, so activation is an atomic rename.
    link_dir=$(mktemp -d "$install_dir/.activate.XXXXXX")
    ln -s "$selected/cline" "$link_dir/cline"
    mv -f "$link_dir/cline" "$install_dir/cline"
    rmdir "$link_dir"
else
    if [[ "$cached" == false ]]; then
        for file in cline.sha256 cline.build-epoch release cline; do mv -f "$temporary/$file" "$install_dir/$file"; done
    fi
fi
if [[ "$modify_path" == true ]]; then
    # Quote paths, including spaces and apostrophes, as shell literals.
    quoted="'${install_dir//\'/\'\\\'\'}'"
    case "${SHELL##*/}" in
        zsh) config="${ZDOTDIR:-$HOME}/.zshrc"; line="export PATH=$quoted:\$PATH" ;;
        bash) config="$HOME/.bashrc"; [[ "$(uname -s)" != Darwin ]] || config="$HOME/.bash_profile"; line="export PATH=$quoted:\$PATH" ;;
        fish) config="${XDG_CONFIG_HOME:-$HOME/.config}/fish/config.fish"; line="fish_add_path $quoted" ;;
        *) printf 'Add %s to your PATH to use cline.\n' "$install_dir" >&2; config='' ;;
    esac
    if [[ -n "$config" ]]; then
        mkdir -p "$(dirname "$config")"
        touch "$config"
        if ! grep -Fxq "$line" "$config"; then printf '\n# Cline\n%s\n' "$line" >> "$config"; fi
        printf 'Open a new terminal to use cline.\n' >&2
    fi
fi
winner=''
[[ "$modify_path" == false ]] || winner=$(command -v cline || true)
if [[ -n "$winner" && "$winner" != "$install_dir/cline" ]]; then
    printf 'PATH currently selects %s. Open a new terminal and check command -v cline.\n' "$winner" >&2
fi
printf '%s\n' "$install_dir/cline"
