#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat <<'HELP'
Cline runtime installer (no Node, Bun, or administrator access required)
Usage: install.sh --release <desktop-tag> [options]
  --version <version>       Shorthand for --release desktop-v<version>
  --target <triple>         Download for another machine (e.g. an SSH host)
  --install-dir <directory> Default: ~/.cline/bin
  --binary <path>           Install a local binary without downloading
  --no-modify-path          Leave shell configuration untouched
  -h, --help                Show this help
HELP
}
fail() { printf 'Cline install: %s\n' "$*" >&2; exit 1; }
release=''
target=''
install_dir="$HOME/.cline/bin"
binary=''
modify_path=true
explicit_directory=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help) usage; exit 0 ;;
        --no-modify-path) modify_path=false; shift ;;
        --release|--version|--target|--install-dir|--binary)
            [[ $# -ge 2 && -n "$2" && "$2" != --* ]] || fail "$1 requires a value"
            case "$1" in
                --release) release="$2" ;;
                --version) release="desktop-v${2#v}" ;;
                --target) target="$2" ;;
                --install-dir) install_dir="$2"; explicit_directory=true ;;
                --binary) binary="$2" ;;
            esac
            shift 2 ;;
        *) fail "unknown option: $1" ;;
    esac
done
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
        *) fail 'use install.ps1 on Windows' ;;
    esac
fi
case "$target" in
    universal-apple-darwin|x86_64-unknown-linux-gnu|aarch64-unknown-linux-gnu) ;;
    *) fail "unsupported target: $target" ;;
esac
if [[ -z "$binary" ]]; then
    [[ "$release" =~ ^desktop-(v[0-9]+\.[0-9]+\.[0-9]+(-beta\.[0-9]+)?|nightly-[0-9]+)$ ]] || fail 'provide an exact desktop release tag with --release or --version'
    command -v curl >/dev/null || fail 'curl is required'
fi
# Reuse a compatible terminal installation, including a package-manager
# wrapper. Never modify package-owned files or silently add a second CLI.
if [[ "$explicit_directory" == false ]]; then
    existing=$(command -v cline || true)
    if [[ -n "$existing" && "$existing" != "$install_dir/cline" ]]; then
        if [[ -n "$binary" ]]; then
            expected_build=$("$binary" --runtime-build-id 2>/dev/null) || fail 'local binary cannot report its SDK identity'
        else
            expected_build=$(curl --fail --location --silent --show-error --connect-timeout 15 --max-time 30 --proto '=https' --proto-redir '=https' "https://github.com/cline/cline/releases/download/$release/cline-runtime-$target.build-id")
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
# Serialize installs in this directory across desktop/SSH clients. Never
# expose a partial download. Shared installs replace the previous runtime.
lock="$install_dir/.install-lock"
for ((attempt=0; ; attempt++)); do
    if mkdir "$lock" 2>/dev/null; then break; fi
    [[ $attempt -lt 240 ]] || fail "another installer holds $lock; remove it if that installer has exited"
    sleep 0.5
done
temporary=''
cleanup() { [[ -z "$temporary" ]] || rm -rf "$temporary"; rmdir "$lock"; }
trap cleanup EXIT
cached=false
if [[ -z "$binary" && -f "$install_dir/cline" && -f "$install_dir/cline.sha256" && -f "$install_dir/release" ]]; then
    if [[ "$(cat "$install_dir/release")" == "$release/$target" && "$(hash_file "$install_dir/cline")" == "$(cat "$install_dir/cline.sha256")" ]]; then cached=true; fi
fi
if [[ "$cached" == false ]]; then
    temporary=$(mktemp -d "$install_dir/.download.XXXXXX")
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
    mv -f "$temporary/cline" "$install_dir/cline"
    mv -f "$temporary/cline.sha256" "$install_dir/cline.sha256"
    mv -f "$temporary/release" "$install_dir/release"
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
printf '%s\n' "$install_dir/cline"
