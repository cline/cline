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

# Print warning
print_warning() {
    local message=$1
    echo -e "${YELLOW}⚠${NC} ${YELLOW}$message${NC}"
}

# Print error
print_error() {
    local message=$1
    echo -e "${RED}✗${NC} ${RED}$message${NC}" >&2
}

# Smart centered box printer
print_box() {
    local text=$1
    local color=$2
    local preferred_width=${3:-48}

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
    local term_width=80
    if [ ${#widths[@]} -gt 0 ]; then
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

        if [ "$min_width" -lt "$preferred_width" ]; then
            term_width=$min_width
        else
            term_width=$max_width
        fi
    fi

    if ! [[ "$term_width" =~ ^[0-9]+$ ]] || [ "$term_width" -lt 20 ]; then
        term_width=80
    fi

    # Calculate content width
    local content_width=0
    while IFS= read -r line; do
        local clean_line=$(echo "$line" | sed 's/\x1b\[[0-9;]*m//g')
        local line_length=${#clean_line}
        if [ $line_length -gt $content_width ]; then
            content_width=$line_length
        fi
    done <<< "$text"

    local max_box_width=$((term_width - 4))
    local text_padding_size=2
    if [ $max_box_width -lt 30 ]; then
        text_padding_size=1
    fi

    local box_width=$preferred_width
    if [ $box_width -gt $max_box_width ]; then
        box_width=$max_box_width
    fi

    local min_width=$((content_width + (text_padding_size * 2) + 2))
    if [ $box_width -lt $min_width ]; then
        box_width=$min_width
        if [ $box_width -gt $max_box_width ]; then
            box_width=$max_box_width
        fi
    fi

    if [ $box_width -lt 10 ]; then
        box_width=10
    fi

    local box_padding=$(( (term_width - box_width) / 2 ))
    if [ $box_padding -lt 1 ]; then
        box_padding=1
    fi

    # Build horizontal line
    local horizontal_line="═"
    for ((i=1; i<box_width-2; i++)); do
        horizontal_line+="═"
    done

    local include_empty_lines=true
    if [ $box_width -lt 25 ]; then
        include_empty_lines=false
    fi

    # Print top border
    printf "%${box_padding}s" ""
    echo -e "${color}╔${horizontal_line}╗${NC}"

    if [ "$include_empty_lines" = true ]; then
        printf "%${box_padding}s" ""
        printf "${color}║"
        printf "%$((box_width-2))s" ""
        printf "║${NC}\n"
    fi

    # Print content lines
    while IFS= read -r line; do
        local clean_line=$(echo "$line" | sed 's/\x1b\[[0-9;]*m//g')
        local line_length=${#clean_line}

        local left_text_padding=$(( (box_width - 2 - line_length) / 2 ))
        local right_text_padding=$((box_width - 2 - line_length - left_text_padding))

        printf "%${box_padding}s" ""
        printf "${color}║"
        printf "%${left_text_padding}s" ""
        printf "%s" "$line"
        printf "%${right_text_padding}s" ""
        printf "║${NC}\n"
    done <<< "$text"

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

# Check if Cline is installed
check_installation() {
    if [ ! -d "$INSTALL_DIR" ]; then
        print_error "Cline CLI is not installed at $INSTALL_DIR"
        echo ""
        print_message "$DIM" "If Cline is installed elsewhere, set CLINE_INSTALL_DIR:"
        print_message "$DIM" "  ${CYAN}CLINE_INSTALL_DIR=/path/to/cline bash scripts/uninstall-cli.sh${NC}"
        echo ""
        exit 1
    fi

    # Check if cline binary exists
    if [ -f "$INSTALL_DIR/bin/cline" ]; then
        local installed_version=$("$INSTALL_DIR/bin/cline" version 2>/dev/null | head -1 | grep -o 'v[0-9]\+\.[0-9]\+\.[0-9]\+' || echo "unknown")
        print_ok "Found Cline ${MAGENTA}${BOLD}$installed_version${NC} at ${CYAN}$INSTALL_DIR${NC}"
    else
        print_warning "Installation directory exists but binary not found"
    fi
}

# Remove installation directory
remove_installation() {
    print_step "Removing installation directory"

    if [ -d "$INSTALL_DIR" ]; then
        rm -rf "$INSTALL_DIR"
        print_ok "Removed ${CYAN}$INSTALL_DIR${NC}"
    else
        print_message "$DIM" "Installation directory already removed"
    fi
}

# Remove PATH configuration
remove_from_path() {
    local bin_dir="$INSTALL_DIR/bin"
    local XDG_CONFIG_HOME=${XDG_CONFIG_HOME:-$HOME/.config}

    print_step "Cleaning up PATH configuration"

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

    local removed=false

    # Remove from each config file
    for config_file in $config_files; do
        if [ -f "$config_file" ]; then
            # Check if our PATH entry exists
            if grep -q "$bin_dir" "$config_file" 2>/dev/null; then
                # Create backup
                cp "$config_file" "$config_file.cline-backup"

                # Remove lines containing the bin_dir
                case $current_shell in
                    fish)
                        # Remove fish_add_path line and preceding comment
                        sed -i.tmp '/# Cline CLI/d; /fish_add_path.*cline\/cli\/bin/d' "$config_file"
                        ;;
                    *)
                        # Remove export PATH line and preceding comment
                        sed -i.tmp '/# Cline CLI/d; /export PATH=.*cline\/cli\/bin/d' "$config_file"
                        ;;
                esac

                rm -f "$config_file.tmp"
                print_ok "Removed from ${CYAN}$(basename $config_file)${NC} (backup: ${CYAN}$(basename $config_file).cline-backup${NC})"
                removed=true
            fi
        fi
    done

    if [ "$removed" = false ]; then
        print_message "$DIM" "No PATH entries found"
    fi
}


# Print final message
print_completion() {
    echo ""
    print_box "Uninstall complete" "$GREEN$BOLD" 48
    echo ""
    print_message "$NC" "Cline CLI has been removed from your system."
    echo ""
    print_message "$DIM" "To finish cleanup, run:"
    echo ""
    print_message "$YELLOW" "${BOLD}    exec \$SHELL"
    echo ""
    print_message "$DIM" "(or just open a new terminal window)"
    echo ""
    print_message "$DIM" "To reinstall Cline, visit:"
    print_message "$DIM" "  ${CYAN}https://github.com/cline/cline/releases${NC}"
    echo ""
}

# Main uninstall flow
main() {
    echo ""
    print_box "CLINE UNINSTALLER" "$MAGENTA$BOLD" 48
    echo ""

    check_installation
    echo ""
    remove_installation
    remove_from_path
    print_completion
}

# Run main function
main "$@"
