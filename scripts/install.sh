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
INSTALL_DIR="${CLINE_INSTALL_DIR:-$HOME/.cline/standalone}"
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
    print_message "$RED" "Error: $1"
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
    local api_url
    
    if [ "$RELEASE_TAG" = "latest" ]; then
        api_url="https://api.github.com/repos/$GITHUB_REPO/releases/latest"
    else
        api_url="https://api.github.com/repos/$GITHUB_REPO/releases/tags/$RELEASE_TAG"
    fi
    
    print_message "$BLUE" "Fetching release information..."
    
    local release_data=$(curl -fsSL "$api_url")
    local download_url=$(echo "$release_data" | grep -o "\"browser_download_url\": \"[^\"]*${platform}[^\"]*\"" | head -1 | cut -d'"' -f4)
    
    if [ -z "$download_url" ]; then
        error_exit "Could not find download URL for platform: $platform"
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
    
    print_message "$GREEN" "✓ Cline installed successfully"
}

# Configure PATH
configure_path() {
    local bin_dir="$INSTALL_DIR/bin"
    local shell_rc=""
    
    # Detect shell configuration file
    if [ -n "$BASH_VERSION" ]; then
        if [ -f "$HOME/.bashrc" ]; then
            shell_rc="$HOME/.bashrc"
        elif [ -f "$HOME/.bash_profile" ]; then
            shell_rc="$HOME/.bash_profile"
        fi
    elif [ -n "$ZSH_VERSION" ]; then
        shell_rc="$HOME/.zshrc"
    fi
    
    if [ -z "$shell_rc" ]; then
        print_message "$YELLOW" "⚠ Could not detect shell configuration file"
        print_message "$YELLOW" "Please manually add the following to your shell configuration:"
        print_message "$YELLOW" "  export PATH=\"$bin_dir:\$PATH\""
        return
    fi
    
    # Check if PATH is already configured
    if grep -q "CLINE_INSTALL_DIR" "$shell_rc" 2>/dev/null; then
        print_message "$GREEN" "✓ PATH already configured in $shell_rc"
        return
    fi
    
    # Add to PATH
    print_message "$BLUE" "Configuring PATH in $shell_rc..."
    cat >> "$shell_rc" << EOF

# Cline CLI
export PATH="$bin_dir:\$PATH"
EOF
    
    print_message "$GREEN" "✓ PATH configured in $shell_rc"
    print_message "$YELLOW" "⚠ Please restart your shell or run: source $shell_rc"
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
