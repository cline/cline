#!/usr/bin/env bash
set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
ORANGE='\033[38;2;255;140;0m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m' # No Color

# Configuration
INSTALL_DIR="${CLINE_INSTALL_DIR:-$HOME/.cline/cli}"
GITHUB_REPO="cline/cline"
requested_version="${CLINE_VERSION:-}"
FORCE_INSTALL="${FORCE_INSTALL:-false}"

# Detect OS and architecture
os=$(uname -s | tr '[:upper:]' '[:lower:]')
arch=$(uname -m)

# Normalize architecture names
if [[ "$arch" == "aarch64" ]]; then
    arch="arm64"
elif [[ "$arch" == "x86_64" ]]; then
    arch="x64"
fi

# Determine platform string
case "$os" in
    darwin)
        [[ "$arch" == "x64" || "$arch" == "arm64" ]] || {
            echo -e "${RED}${BOLD}ERROR${NC} ${RED}Unsupported architecture: $arch${NC}" >&2
            exit 1
        }
        platform="darwin-$arch"
        ;;
    linux)
        [[ "$arch" == "x64" || "$arch" == "arm64" ]] || {
            echo -e "${RED}${BOLD}ERROR${NC} ${RED}Unsupported architecture: $arch${NC}" >&2
            exit 1
        }
        platform="linux-$arch"
        ;;
    *)
        echo -e "${RED}${BOLD}ERROR${NC} ${RED}Unsupported OS: $os${NC}" >&2
        exit 1
        ;;
esac

# Print colored message
print_message() {
    local color=$1
    shift
    echo -e "${color}$@${NC}"
}

# Print step
print_step() {
    local message=$1
    echo -e "${CYAN}→${NC} ${DIM}$message${NC}"
}

# Print success
print_ok() {
    local message=$1
    echo -e "${GREEN}✓${NC} $message"
}

# Print error
print_error() {
    local message=$1
    echo -e "${RED}✗${NC} ${RED}$message${NC}" >&2
}

# Check prerequisites
check_prerequisites() {
    print_step "Checking prerequisites"
    
    for cmd in curl tar; do
        if ! command -v "$cmd" >/dev/null 2>&1; then
            print_error "$cmd is required but not installed"
            exit 1
        fi
    done
    
    print_ok "Prerequisites satisfied"
}


# Check GitHub API rate limit status and return details
check_rate_limit() {
    local rate_limit_response=$(curl -s "https://api.github.com/rate_limit" 2>/dev/null)
    
    if [ -z "$rate_limit_response" ]; then
        return 1  # Can't determine rate limit status
    fi
    
    if command -v jq >/dev/null 2>&1; then
        local remaining=$(echo "$rate_limit_response" | jq -r '.rate.remaining' 2>/dev/null)
        
        if [ "$remaining" = "0" ]; then
            return 0  # Rate limited
        fi
    fi
    
    return 1  # Not rate limited
}

# Show detailed rate limit error
show_rate_limit_error() {
    local rate_limit_response=$(curl -s "https://api.github.com/rate_limit" 2>/dev/null)
    
    if command -v jq >/dev/null 2>&1; then
        local remaining=$(echo "$rate_limit_response" | jq -r '.rate.remaining' 2>/dev/null)
        local limit=$(echo "$rate_limit_response" | jq -r '.rate.limit' 2>/dev/null)
        local reset=$(echo "$rate_limit_response" | jq -r '.rate.reset' 2>/dev/null)
        local used=$(echo "$rate_limit_response" | jq -r '.rate.used' 2>/dev/null)
        
        print_error "GitHub API rate limit exceeded"
        echo ""
        echo -e "${YELLOW}Rate Limit Status:${NC}"
        echo -e "  ${CYAN}Used:${NC}      ${BOLD}$used${NC} / $limit requests"
        echo -e "  ${CYAN}Remaining:${NC} ${RED}${BOLD}$remaining${NC}"
        echo -e "  ${CYAN}Resets at:${NC} ${BOLD}$(date -r $reset 2>/dev/null || date -d @$reset 2>/dev/null)${NC}"
        echo ""
        
        # Calculate time until reset
        local now=$(date +%s)
        local seconds_until_reset=$((reset - now))
        local minutes_until_reset=$((seconds_until_reset / 60))
        
        if [ $seconds_until_reset -gt 0 ]; then
            echo -e "${YELLOW}Your rate limit will reset in ${BOLD}~$minutes_until_reset minutes${NC}"
            echo ""
        fi
        
        echo -e "${CYAN}Options:${NC}"
        echo -e "  ${DIM}1.${NC} Wait for the rate limit to reset"
        echo -e "  ${DIM}2.${NC} Use a GitHub Personal Access Token for 5,000 requests/hour:"
        echo ""
        echo -e "     ${GREEN}GITHUB_TOKEN=your_token bash scripts/install.sh${NC}"
        echo ""
        echo -e "     ${DIM}Create a token at: https://github.com/settings/tokens${NC}"
        echo ""
    else
        print_error "GitHub API rate limit exceeded"
        echo ""
        echo -e "${YELLOW}You've used all 60 requests. Please wait ~1 hour or use a GitHub token.${NC}"
        echo ""
    fi
}

# Get download URL and version
get_release_info() {
    if [ -z "$requested_version" ]; then
        print_step "Fetching latest CLI release"
        
        # Build auth header if token provided
        local auth_header=""
        if [ -n "${GITHUB_TOKEN:-}" ]; then
            auth_header="-H \"Authorization: Bearer $GITHUB_TOKEN\""
        fi
        
        # Use jq if available for more reliable parsing
        if command -v jq >/dev/null 2>&1; then
            local response=$(eval curl -fsSL $auth_header "https://api.github.com/repos/$GITHUB_REPO/releases" 2>&1)
            local curl_exit=$?
            
            # If curl failed, diagnose why
            if [ $curl_exit -ne 0 ]; then
                # Check if it's a rate limit issue
                if check_rate_limit; then
                    show_rate_limit_error
                    exit 1
                fi
                
                # Check if it's a network issue
                if ! curl -s --connect-timeout 5 "https://api.github.com" >/dev/null 2>&1; then
                    print_error "Could not connect to GitHub"
                    echo ""
                    echo -e "${YELLOW}Please check your internet connection and try again.${NC}"
                    echo ""
                    exit 1
                fi
                
                # Generic error
                print_error "Failed to fetch releases from GitHub"
                echo ""
                echo -e "${DIM}Error: $response${NC}"
                echo ""
                exit 1
            fi
            
            # Check if response is valid JSON
            if ! echo "$response" | jq empty 2>/dev/null; then
                print_error "Invalid response from GitHub API"
                echo ""
                echo -e "${DIM}Response preview:${NC}"
                echo "$response" | head -5
                echo ""
                
                # Double-check rate limit
                if check_rate_limit; then
                    show_rate_limit_error
                fi
                exit 1
            fi
            
            # Parse release info
            local release_info=$(echo "$response" | \
                jq -r '.[] | select(.tag_name | endswith("-cli")) | .tag_name + "|" + (.assets[] | select(.name | contains("'"$platform"'") and endswith(".tar.gz")) | .browser_download_url) | select(length > 0)' 2>/dev/null | head -1)
            
            if [ -z "$release_info" ]; then
                # No matching release found - show what's available
                local latest_cli_tag=$(echo "$response" | jq -r '.[] | select(.tag_name | endswith("-cli")) | .tag_name' 2>/dev/null | head -1)
                
                if [ -z "$latest_cli_tag" ]; then
                    print_error "No CLI releases found"
                    echo ""
                    echo -e "${DIM}Visit: https://github.com/$GITHUB_REPO/releases${NC}"
                    echo ""
                    exit 1
                fi
                
                print_error "No release found for platform: $platform"
                echo ""
                echo -e "${YELLOW}Latest CLI release: ${BOLD}$latest_cli_tag${NC}"
                echo ""
                echo -e "${CYAN}Available platforms:${NC}"
                echo "$response" | jq -r '.[] | select(.tag_name | endswith("-cli")) | .assets[].name' 2>/dev/null | grep "\.tar\.gz$" | head -5 | sed 's/^/  /'
                echo ""
                echo -e "${DIM}Visit: https://github.com/$GITHUB_REPO/releases/tag/$latest_cli_tag${NC}"
                echo ""
                exit 1
            fi
            
            cli_tag=$(echo "$release_info" | cut -d'|' -f1)
            download_url=$(echo "$release_info" | cut -d'|' -f2)
        else
            # Fallback: fetch specific release by tag (similar error handling)
            local releases_data=$(eval curl -fsSL $auth_header "https://api.github.com/repos/$GITHUB_REPO/releases" 2>&1)
            local curl_exit=$?
            
            if [ $curl_exit -ne 0 ]; then
                if check_rate_limit; then
                    show_rate_limit_error
                    exit 1
                fi
                
                print_error "Failed to fetch releases from GitHub"
                exit 1
            fi
            
            # Extract the first tag ending in -cli
            cli_tag=$(echo "$releases_data" | grep -o '"tag_name": "[^"]*-cli"' | head -1 | cut -d'"' -f4)
            
            if [ -z "$cli_tag" ]; then
                print_error "No CLI releases found"
                exit 1
            fi
            
            # Fetch the specific release to get assets
            local release_data=$(eval curl -fsSL $auth_header "https://api.github.com/repos/$GITHUB_REPO/releases/tags/$cli_tag")
            
            # Extract download URL from the specific release
            download_url=$(echo "$release_data" | grep -o "\"browser_download_url\": \"[^\"]*${platform}[^\"]*\.tar\.gz\"" | head -1 | cut -d'"' -f4)
        fi
        
        print_ok "Found version ${MAGENTA}${BOLD}$cli_tag${NC}"
    else
        # Similar logic for specific version...
        print_step "Fetching version ${MAGENTA}$requested_version${NC}"
        cli_tag="$requested_version"
        
        local auth_header=""
        if [ -n "${GITHUB_TOKEN:-}" ]; then
            auth_header="-H \"Authorization: Bearer $GITHUB_TOKEN\""
        fi
        
        if command -v jq >/dev/null 2>&1; then
            download_url=$(eval curl -fsSL $auth_header "https://api.github.com/repos/$GITHUB_REPO/releases/tags/$requested_version" | \
                jq -r '.assets[] | select(.name | contains("'"$platform"'") and endswith(".tar.gz")) | .browser_download_url' | head -1)
        else
            local release_data=$(eval curl -fsSL $auth_header "https://api.github.com/repos/$GITHUB_REPO/releases/tags/$requested_version")
            download_url=$(echo "$release_data" | grep -o "\"browser_download_url\": \"[^\"]*${platform}[^\"]*\.tar\.gz\"" | head -1 | cut -d'"' -f4)
        fi
    fi
    
    if [ -z "$download_url" ]; then
        print_error "Could not find $platform package in release $cli_tag"
        echo -e "${DIM}Visit: https://github.com/$GITHUB_REPO/releases/tag/$cli_tag${NC}"
        exit 1
    fi
}

# Check if already installed with same version
check_existing_installation() {
    # Skip check if force install
    if [ "$FORCE_INSTALL" = "true" ]; then
        print_message "$YELLOW" "Force reinstalling..."
        echo ""
        return
    fi
    
    if [ -d "$INSTALL_DIR/bin" ] && [ -f "$INSTALL_DIR/bin/cline" ]; then
        # Extract version from cline binary
        local installed_version=$("$INSTALL_DIR/bin/cline" version 2>/dev/null | head -1 | grep -o 'v[0-9]\+\.[0-9]\+\.[0-9]\+' || echo "")
        
        # Compare versions (remove -cli suffix for comparison)
        local cli_tag_version=$(echo "$cli_tag" | sed 's/-cli$//')
        
        if [ -n "$installed_version" ] && [ "$installed_version" = "$cli_tag_version" ]; then
            echo ""
            print_ok "Cline ${MAGENTA}${BOLD}$installed_version${NC} already installed"
            echo ""
            print_message "$DIM" "Installation directory: $INSTALL_DIR"
            print_message "$DIM" "To reinstall, run: ${MAGENTA}rm -rf $INSTALL_DIR && <install command>${NC}"
            print_message "$DIM" "Or use: ${MAGENTA}FORCE_INSTALL=true${NC} to force reinstall"
            echo ""
            exit 0
        elif [ -n "$installed_version" ]; then
            print_message "$YELLOW" "Upgrading from ${MAGENTA}$installed_version${YELLOW} to ${MAGENTA}${BOLD}$cli_tag_version${NC}"
            echo ""
        fi
    fi
}

# Download and install
install_cline() {
    print_step "Installing Cline"
    
    # Create temporary directory
    local tmp_dir=$(mktemp -d)
    trap "rm -rf $tmp_dir" EXIT
    
    # Download with progress bar
    echo -e "${MAGENTA}${BOLD}"
    local package_file="$tmp_dir/cline.tar.gz"

    if ! curl -#fSL -o "$package_file" "$download_url"; then
        echo -e "${NC}"
        print_error "Failed to download package"
        echo -e "${DIM}URL: $download_url${NC}"
        exit 1
    fi
    echo -e "${NC}"

    # Verify download
    if [ ! -f "$package_file" ]; then
        print_error "Download failed: file not found"
        exit 1
    fi
    
    local file_size=$(stat -f%z "$package_file" 2>/dev/null || stat -c%s "$package_file" 2>/dev/null)
    print_ok "Downloaded $(numfmt --to=iec $file_size 2>/dev/null || echo "$file_size bytes")"
    
    # Remove existing installation
    if [ -d "$INSTALL_DIR" ]; then
        rm -rf "$INSTALL_DIR"
    fi
    
    # Create installation directory
    mkdir -p "$INSTALL_DIR"
    
    # Extract package
    print_step "Extracting package"
    if ! tar -xzf "$package_file" -C "$INSTALL_DIR" --strip-components=0; then
        print_error "Failed to extract package"
        exit 1
    fi
    
    # Make binaries executable
    if [ -d "$INSTALL_DIR/bin" ]; then
        chmod +x "$INSTALL_DIR/bin/"* 2>/dev/null || true
    else
        print_error "No bin directory found"
        echo -e "${DIM}Contents of $INSTALL_DIR:${NC}"
        ls -la "$INSTALL_DIR"
        exit 1
    fi
    
    # Copy platform-specific native modules
    if [ -d "$INSTALL_DIR/binaries/$platform/node_modules" ]; then
        if cp -r "$INSTALL_DIR/binaries/$platform/node_modules/"* "$INSTALL_DIR/node_modules/" 2>/dev/null; then
            print_ok "Native modules installed"
        fi
    fi
    
    print_ok "Cline installed to ${MAGENTA}${BOLD}$INSTALL_DIR${NC}"
}

# Configure PATH
configure_path() {
    local bin_dir="$INSTALL_DIR/bin"
    local XDG_CONFIG_HOME=${XDG_CONFIG_HOME:-$HOME/.config}
    
    print_step "Configuring PATH"
    
    # Detect shell and config files
    local current_shell=$(basename "${SHELL:-bash}")
    local config_files=""
    
    case $current_shell in
        fish)
            config_files="$HOME/.config/fish/config.fish"
            ;;
        zsh)
            config_files="$HOME/.zshrc $HOME/.zshenv $XDG_CONFIG_HOME/zsh/.zshrc"
            ;;
        bash)
            config_files="$HOME/.bashrc $HOME/.bash_profile $HOME/.profile $XDG_CONFIG_HOME/bash/.bashrc"
            ;;
        ash|sh)
            config_files="$HOME/.profile /etc/profile"
            ;;
        *)
            config_files="$HOME/.profile"
            ;;
    esac
    
    # Find first existing config file
    local config_file=""
    for file in $config_files; do
        if [ -f "$file" ]; then
            config_file="$file"
            break
        fi
    done
    
    # Create default if none exists
    if [ -z "$config_file" ]; then
        case $current_shell in
            fish) 
                config_file="$HOME/.config/fish/config.fish"
                mkdir -p "$(dirname "$config_file")"
                ;;
            zsh) 
                config_file="$HOME/.zshrc" 
                ;;
            *) 
                config_file="$HOME/.bashrc" 
                ;;
        esac
        touch "$config_file"
    fi
    
    # Add to config if not already present
    if ! grep -q "$bin_dir" "$config_file" 2>/dev/null; then
        case $current_shell in
            fish)
                echo -e "\n# Cline CLI\nfish_add_path $bin_dir" >> "$config_file"
                ;;
            *)
                echo -e "\n# Cline CLI\nexport PATH=\"$bin_dir:\$PATH\"" >> "$config_file"
                ;;
        esac
        
        print_ok "Added to PATH in ${CYAN}$(basename $config_file)${NC}"
    else
        print_ok "Already in PATH"
    fi
    
    # Add to GitHub Actions PATH if applicable
    if [ -n "${GITHUB_ACTIONS-}" ] && [ "${GITHUB_ACTIONS}" == "true" ]; then
        echo "$bin_dir" >> "$GITHUB_PATH"
    fi
}

# Verify installation
verify_installation() {
    print_step "Verifying installation"
    
    local cline_bin="$INSTALL_DIR/bin/cline"
    
    if [ ! -f "$cline_bin" ]; then
        print_error "Binary not found at $cline_bin"
        exit 1
    fi
    
    if [ ! -x "$cline_bin" ]; then
        chmod +x "$cline_bin"
    fi
    
    print_ok "Installation verified"
}


# Smart centered box printer
# Smart centered box printer
print_box() {
    local text=$1
    local color=$2
    local preferred_width=${3:-48}  # Default preferred box width of 48
    
    # Try multiple methods to get terminal width
    local term_width_tput=$(tput cols 2>/dev/null || echo 0)
    local term_width_stty=$(stty size 2>/dev/null | cut -d' ' -f2 || echo 0)
    local term_width_env=${COLUMNS:-0}
    
    # Build array of valid widths
    local widths=()
    [ "$term_width_tput" -gt 0 ] 2>/dev/null && widths+=($term_width_tput)
    [ "$term_width_stty" -gt 0 ] 2>/dev/null && widths+=($term_width_stty)
    [ "$term_width_env" -gt 0 ] 2>/dev/null && widths+=($term_width_env)
    
    # Smart selection logic
    local term_width=80  # fallback
    if [ ${#widths[@]} -gt 0 ]; then
        # Find min and max
        local min_width=${widths[0]}
        local max_width=${widths[0]}
        for width in "${widths[@]}"; do
            if [ "$width" -lt "$min_width" ]; then
                min_width=$width
            fi
            if [ "$width" -gt "$max_width" ]; then
                max_width=$width
            fi
        done
        
        # If any width is less than preferred (48), use the smallest (most conservative)
        # Otherwise, use the largest (give more space)
        if [ "$min_width" -lt "$preferred_width" ]; then
            term_width=$min_width
        else
            term_width=$max_width
        fi
    fi
    
    # Ensure we have a valid number and reasonable minimum
    if ! [[ "$term_width" =~ ^[0-9]+$ ]] || [ "$term_width" -lt 20 ]; then
        term_width=80
    fi
    
    # Calculate content width (length of longest line in text)
    local content_width=0
    while IFS= read -r line; do
        # Strip ANSI color codes for accurate length measurement
        local clean_line=$(echo "$line" | sed 's/\x1b\[[0-9;]*m//g')
        local line_length=${#clean_line}
        if [ $line_length -gt $content_width ]; then
            content_width=$line_length
        fi
    done <<< "$text"
    
    # Calculate max possible box width (terminal width - 4 chars total padding minimum)
    local max_box_width=$((term_width - 4))
    
    # Determine internal text padding based on box width
    # For narrow boxes (< 30), use 1 space padding; otherwise 2 spaces
    local text_padding_size=2
    if [ $max_box_width -lt 30 ]; then
        text_padding_size=1
    fi
    
    # Start with preferred width, but respect terminal constraints
    local box_width=$preferred_width
    if [ $box_width -gt $max_box_width ]; then
        box_width=$max_box_width
    fi
    
    # Ensure box is at least wide enough for content (with adaptive padding)
    local min_width=$((content_width + (text_padding_size * 2) + 2))  # content + padding + borders
    if [ $box_width -lt $min_width ]; then
        box_width=$min_width
        # If even min_width exceeds terminal, shrink to fit
        if [ $box_width -gt $max_box_width ]; then
            box_width=$max_box_width
        fi
    fi
    
    # Absolute minimum box width
    if [ $box_width -lt 10 ]; then
        box_width=10
    fi
    
    # Calculate horizontal padding to center the box in terminal
    local box_padding=$(( (term_width - box_width) / 2 ))
    if [ $box_padding -lt 1 ]; then
        box_padding=1  # Ensure at least 1 character padding
    fi
    
    # Build horizontal line
    local horizontal_line="═"
    for ((i=1; i<box_width-2; i++)); do
        horizontal_line+="═"
    done
    
    # Decide whether to include empty lines based on box height constraints
    local include_empty_lines=true
    if [ $box_width -lt 25 ]; then
        include_empty_lines=false  # Skip empty lines for very narrow boxes
    fi
    
    # Print top border
    printf "%${box_padding}s" ""
    echo -e "${color}╔${horizontal_line}╗${NC}"
    
    # Print empty line (optional)
    if [ "$include_empty_lines" = true ]; then
        printf "%${box_padding}s" ""
        printf "${color}║"
        printf "%$((box_width-2))s" ""
        printf "║${NC}\n"
    fi
    
    # Print content lines (centered)
    while IFS= read -r line; do
        # Strip ANSI codes for length calculation
        local clean_line=$(echo "$line" | sed 's/\x1b\[[0-9;]*m//g')
        local line_length=${#clean_line}
        
        # Calculate padding with adaptive spacing
        local left_text_padding=$(( (box_width - 2 - line_length) / 2 ))
        local right_text_padding=$((box_width - 2 - line_length - left_text_padding))
        
        printf "%${box_padding}s" ""
        printf "${color}║"
        printf "%${left_text_padding}s" ""
        printf "%s" "$line"
        printf "%${right_text_padding}s" ""
        printf "║${NC}\n"
    done <<< "$text"
    
    # Print empty line (optional)
    if [ "$include_empty_lines" = true ]; then
        printf "%${box_padding}s" ""
        printf "${color}║"
        printf "%$((box_width-2))s" ""
        printf "║${NC}\n"
    fi
    
    # Print bottom border
    printf "%${box_padding}s" ""
    echo -e "${color}╚${horizontal_line}╝${NC}"
}

# Print success message
print_success() {
    echo ""
    print_box "Installation complete" "$GREEN$BOLD" 48
    echo ""
    print_message "$NC" "Run this to start using ${MAGENTA}${BOLD}cline${NC} immediately:"
    echo ""
    print_message "$YELLOW" "${BOLD}    exec \$SHELL"
    echo ""
    print_message "$DIM" "(or just open a new terminal window)"
    echo ""
}

# Main installation flow
main() {
    echo ""
    print_box "CLINE IS COOKING" "$MAGENTA$BOLD" 48
    echo ""
    print_ok "Platform: ${MAGENTA}${BOLD}$platform${NC}"    
    check_prerequisites
    get_release_info
    check_existing_installation
    install_cline
    configure_path
    verify_installation
    print_success
}

# Run main function
main "$@"