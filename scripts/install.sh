#!/bin/bash
# Cline Installation Script
# Usage: curl -fsSL https://raw.githubusercontent.com/cline/cline/main/scripts/install.sh | bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
INSTALL_DIR="${CLINE_INSTALL_DIR:-$HOME/.cline/cli}"
GITHUB_REPO="cline/cline"
RELEASE_TAG="${CLINE_VERSION:-latest}"

# Detect OS and architecture
detect_platform() {
    local os=$(uname -s | tr '[:upper:]' '[:lower:]')
    local arch=$(uname -m)
    
    case "$os" in
        darwin)
            case "$arch" in
                x86_64) echo "darwin-x64" ;;
                arm64) echo "darwin-arm64" ;;
                *) echo "unsupported" ;;
            esac
            ;;
        linux)
            case "$arch" in
                x86_64) echo "linux-x64" ;;
                *) echo "unsupported" ;;
            esac
            ;;
        *)
            echo "unsupported"
            ;;
    esac
}

# Print colored message
print_message() {
    local color=$1
    shift
    echo -e "${color}$@${NC}"
}

# Print error and exit
error_exit() {
    print_message "$RED" "Error: $1" >&2
    exit 1
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check prerequisites
check_prerequisites() {
    print_message "$BLUE" "Checking prerequisites..."
    
    if ! command_exists curl; then
        error_exit "curl is required but not installed. Please install curl and try again."
    fi
    
    if ! command_exists tar; then
        error_exit "tar is required but not installed. Please install tar and try again."
    fi
    
    print_message "$GREEN" "✓ Prerequisites satisfied"
}

# Get download URL for the release
get_download_url() {
    local platform=$1
    
    if [ "$RELEASE_TAG" = "latest" ]; then
        # For latest, find the most recent release with -cli suffix
        print_message "$BLUE" "Fetching latest CLI release..." >&2
        
        local releases_data=$(curl -fsSL "https://api.github.com/repos/$GITHUB_REPO/releases")
        
        # Extract the first tag ending in -cli
        local cli_tag=$(echo "$releases_data" | grep -o '"tag_name": "[^"]*-cli"' | head -1 | cut -d'"' -f4)
        
        if [ -z "$cli_tag" ]; then
            error_exit "No CLI releases found. Please specify a version: CLINE_VERSION=vX.X.X-cli"
        fi
        
        print_message "$BLUE" "Found CLI release: $cli_tag" >&2
        
        # Fetch the specific release to get download URLs
        local release_data=$(curl -fsSL "https://api.github.com/repos/$GITHUB_REPO/releases/tags/$cli_tag")
        local download_url=$(echo "$release_data" | grep -o "\"browser_download_url\": \"[^\"]*${platform}[^\"]*\.tar\.gz\"" | head -1 | cut -d'"' -f4)
        
        if [ -z "$download_url" ]; then
            error_exit "Could not find $platform package in release $cli_tag"
        fi
    else
        # For specific version, use the provided tag
        print_message "$BLUE" "Fetching release $RELEASE_TAG..." >&2
        
        local release_data=$(curl -fsSL "https://api.github.com/repos/$GITHUB_REPO/releases/tags/$RELEASE_TAG")
        local download_url=$(echo "$release_data" | grep -o "\"browser_download_url\": \"[^\"]*${platform}[^\"]*\.tar\.gz\"" | head -1 | cut -d'"' -f4)
        
        if [ -z "$download_url" ]; then
            error_exit "Could not find $platform package in release $RELEASE_TAG"
        fi
    fi
    
    echo "$download_url"
}

# Download and extract Cline
install_cline() {
    local platform=$1
    local download_url=$2
    
    print_message "$BLUE" "Installing Cline to $INSTALL_DIR..."
    
    # Create temporary directory
    local tmp_dir=$(mktemp -d)
    trap "rm -rf $tmp_dir" EXIT
    
    # Download package
    print_message "$BLUE" "Downloading Cline..."
    local package_file="$tmp_dir/cline.tar.gz"
    
    if ! curl -fsSL -o "$package_file" "$download_url"; then
        error_exit "Failed to download Cline package"
    fi
    
    # Remove existing installation
    if [ -d "$INSTALL_DIR" ]; then
        print_message "$YELLOW" "Removing existing installation..."
        rm -rf "$INSTALL_DIR"
    fi
    
    # Create installation directory
    mkdir -p "$INSTALL_DIR"
    
    # Extract package
    print_message "$BLUE" "Extracting package..."
    if ! tar -xzf "$package_file" -C "$INSTALL_DIR" --strip-components=0; then
        error_exit "Failed to extract package"
    fi
    
    # Make binaries executable
    chmod +x "$INSTALL_DIR/bin/"*
    
    # Copy platform-specific native modules to node_modules
    if [ -d "$INSTALL_DIR/binaries/$platform/node_modules" ]; then
        print_message "$BLUE" "Installing platform-specific native modules..."
        if ! cp -r "$INSTALL_DIR/binaries/$platform/node_modules/"* "$INSTALL_DIR/node_modules/"; then
            error_exit "Failed to install platform-specific native modules"
        fi
        print_message "$GREEN" "✓ Native modules installed"
    fi
    print_message "$GREEN" "✓ Cline installed successfully"
}

# Configure PATH
configure_path() {
    local bin_dir="$INSTALL_DIR/bin"
    
    # Check if already in PATH
    if [[ ":$PATH:" == *":$bin_dir:"* ]]; then
        print_message "$GREEN" "✓ $bin_dir already in PATH"
        return
    fi
    
    # Detect shell and possible config files
    local current_shell=$(basename "${SHELL:-bash}")
    local config_files=""
    local XDG_CONFIG_HOME=${XDG_CONFIG_HOME:-$HOME/.config}
    
    case $current_shell in
        zsh)
            config_files="$HOME/.zshrc $HOME/.zshenv $XDG_CONFIG_HOME/zsh/.zshrc"
            ;;
        bash)
            config_files="$HOME/.bashrc $HOME/.bash_profile $HOME/.profile"
            ;;
        fish)
            config_files="$HOME/.config/fish/config.fish"
            ;;
        *)
            config_files="$HOME/.profile"
            ;;
    esac
    
    # Find the first existing config file
    local config_file=""
    for file in $config_files; do
        if [ -f "$file" ]; then
            config_file="$file"
            break
        fi
    done
    
    # If no config file exists, create the default one
    if [ -z "$config_file" ]; then
        case $current_shell in
            zsh) config_file="$HOME/.zshrc" ;;
            bash) config_file="$HOME/.bashrc" ;;
            fish) config_file="$HOME/.config/fish/config.fish" ;;
            *) config_file="$HOME/.profile" ;;
        esac
        print_message "$BLUE" "Creating $config_file..."
        touch "$config_file"
    fi
    
    # Check if PATH export already exists
    local path_command="export PATH=\"$bin_dir:\$PATH\""
    if grep -Fq "$bin_dir" "$config_file" 2>/dev/null; then
        print_message "$GREEN" "✓ PATH already configured in $config_file"
        return
    fi
    
    # Add to PATH
    print_message "$BLUE" "Configuring PATH in $config_file..."
    cat >> "$config_file" << EOF

# Cline CLI
$path_command
EOF
    
    print_message "$GREEN" "✓ PATH configured in $config_file"
    print_message "$YELLOW" "⚠ Please restart your shell or run: source $config_file"
}

# Verify installation
verify_installation() {
    print_message "$BLUE" "Verifying installation..."
    
    local cline_bin="$INSTALL_DIR/bin/cline"
    
    if [ ! -f "$cline_bin" ]; then
        error_exit "Installation verification failed: cline binary not found"
    fi
    
    if [ ! -x "$cline_bin" ]; then
        error_exit "Installation verification failed: cline binary not executable"
    fi
    
    # Check version (the binary now handles service management internally)
    local version_output=$("$cline_bin" version 2>&1 || true)
    if [ -z "$version_output" ]; then
        error_exit "Installation verification failed: could not get version"
    fi
    
    print_message "$GREEN" "✓ Installation verified"
}

# Print success message
print_success() {
    echo ""
    print_message "$GREEN" "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    print_message "$GREEN" "  Cline installed successfully! 🎉"
    print_message "$GREEN" "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    print_message "$BLUE" "Installation directory: $INSTALL_DIR"
    echo ""
    print_message "$YELLOW" "To get started:"
    print_message "$YELLOW" "  1. Restart your shell or run: source ~/.zshrc (or ~/.bashrc)"
    print_message "$YELLOW" "  2. Run: cline --help"
    print_message "$YELLOW" "  3. Sign in: cline auth login"
    echo ""
    print_message "$BLUE" "Documentation: https://docs.cline.bot"
    echo ""
}

# Main installation flow
main() {
    echo ""
    print_message "$BLUE" "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    print_message "$BLUE" "  Cline Installation Script"
    print_message "$BLUE" "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    
    # Detect platform
    local platform=$(detect_platform)
    if [ "$platform" = "unsupported" ]; then
        error_exit "Unsupported platform: $(uname -s) $(uname -m)"
    fi
    print_message "$GREEN" "✓ Detected platform: $platform"
    
    # Check prerequisites
    check_prerequisites
    
    # Get download URL
    local download_url=$(get_download_url "$platform")
    print_message "$GREEN" "✓ Found release: $download_url"
    
    # Install Cline
    install_cline "$platform" "$download_url"
    
    # Configure PATH
    configure_path
    
    # Verify installation
    verify_installation
    
    # Print success message
    print_success
}

# Run main function
main "$@"
