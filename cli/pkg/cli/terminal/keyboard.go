package terminal

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"github.com/cline/cli/pkg/cli/display"
	"github.com/cline/cli/pkg/cli/global"
)

// KeyboardProtocol manages enhanced keyboard protocol support for detecting
// modified keys like shift+enter across all major terminals.
type KeyboardProtocol struct {
	enabled bool
	mu      sync.Mutex
}

var globalProtocol = &KeyboardProtocol{}

// EnableEnhancedKeyboard enables enhanced keyboard protocols to support
// shift+enter and other modified keys across all major terminals:
// - VS Code integrated terminal
// - iTerm2
// - Terminal.app
// - Ghostty
// - Kitty
// - WezTerm
// - Alacritty
// - foot
// - xterm
//
// This function is safe to call multiple times and handles cleanup automatically.
// It enables both modifyOtherKeys (xterm protocol) and Kitty keyboard protocol
// for maximum compatibility.
func EnableEnhancedKeyboard() {
	globalProtocol.mu.Lock()
	defer globalProtocol.mu.Unlock()

	if globalProtocol.enabled {
		return // Already enabled
	}

	// Check if we're in a TTY (not piped/redirected)
	if !isatty(os.Stdin.Fd()) {
		return
	}

	// Enable modifyOtherKeys mode 2
	// This tells xterm-compatible terminals (VS Code, iTerm2, Terminal.app, etc.)
	// to send escape sequences for modified keys including shift+enter
	// Format: CSI > 4 ; 2 m
	// - Mode 2 enables for ALL keys including well-known ones
	fmt.Print("\x1b[>4;2m")

	// Also enable Kitty keyboard protocol for terminals that support it
	// This is a more modern protocol supported by Kitty, Ghostty, WezTerm, foot, etc.
	// Format: CSI = <flags> u where flags=1 means "disambiguate escape codes"
	// This makes shift+enter distinguishable from plain enter
	fmt.Print("\x1b[=1u")

	globalProtocol.enabled = true
}

// DisableEnhancedKeyboard restores the terminal to its default keyboard mode.
// This should be called on program exit to be a good citizen.
func DisableEnhancedKeyboard() {
	globalProtocol.mu.Lock()
	defer globalProtocol.mu.Unlock()

	if !globalProtocol.enabled {
		return
	}

	// Disable modifyOtherKeys (restore to mode 0)
	fmt.Print("\x1b[>4;0m")

	// Disable Kitty keyboard protocol
	fmt.Print("\x1b[<u")

	globalProtocol.enabled = false
}

// isatty checks if a file descriptor is a terminal
func isatty(fd uintptr) bool {
	// Use the standard library's terminal package
	// This works across all platforms (Unix, Windows, etc.)
	fileInfo, err := os.Stdin.Stat()
	if err != nil {
		return false
	}
	return (fileInfo.Mode() & os.ModeCharDevice) != 0
}

// SetupKeyboard detects the current terminal and configures keybindings if needed.
// Runs in background and doesn't block. Prints status when configs are modified.
func SetupKeyboard() {
	go func() {
		renderer := display.NewRenderer(global.Config.OutputFormat)
		setupKeyboardInternal(renderer)
	}()
}

// SetupKeyboardSync is the synchronous version used by doctor command.
// Blocks until complete and prints status for all terminals.
func SetupKeyboardSync() {
	renderer := display.NewRenderer(global.Config.OutputFormat)
	setupKeyboardInternal(renderer)
}

func setupKeyboardInternal(renderer *display.Renderer) {
	terminalName := DetectTerminal()

	switch terminalName {
	case "vscode":
		// VS Code and Cursor use the same TERM_PROGRAM value
		modified, path := SetupVSCodeKeybindings()
		if modified {
			fmt.Printf("%s VS Code %s\n", renderer.Dim("Configured shift+enter for"), renderer.Dim("terminal"))
			fmt.Printf("%s %s\n", renderer.Dim("  →"), path)
		} else if path != "" {
			fmt.Printf("%s\n", renderer.Dim("✓ VS Code shift+enter already configured"))
			fmt.Printf("%s %s\n", renderer.Dim("  →"), path)
		}

		modified, path = SetupCursorKeybindings()
		if modified {
			fmt.Printf("%s Cursor %s\n", renderer.Dim("Configured shift+enter for"), renderer.Dim("terminal"))
			fmt.Printf("%s %s\n", renderer.Dim("  →"), path)
		} else if path != "" {
			fmt.Printf("%s\n", renderer.Dim("✓ Cursor shift+enter already configured"))
			fmt.Printf("%s %s\n", renderer.Dim("  →"), path)
		}

	case "ghostty":
		modified, path := SetupGhosttyKeybindings()
		if modified {
			fmt.Printf("%s Ghostty %s\n", renderer.Dim("Configured shift+enter for"), renderer.Dim("terminal"))
			fmt.Printf("%s %s\n", renderer.Dim("  →"), path)
			fmt.Printf("%s\n", renderer.Dim("  Fully restart Ghostty (quit all windows) for changes to take effect"))
		} else if path != "" {
			fmt.Printf("%s\n", renderer.Dim("✓ Ghostty shift+enter already configured"))
			fmt.Printf("%s %s\n", renderer.Dim("  →"), path)
		}

	case "wezterm":
		modified, path := SetupWezTermKeybindings()
		if modified {
			fmt.Printf("%s WezTerm %s\n", renderer.Dim("Configured shift+enter for"), renderer.Dim("terminal"))
			fmt.Printf("%s %s\n", renderer.Dim("  →"), path)
		} else if path != "" {
			fmt.Printf("%s\n", renderer.Dim("✓ WezTerm shift+enter already configured"))
			fmt.Printf("%s %s\n", renderer.Dim("  →"), path)
		}

	case "alacritty":
		modified, path := SetupAlacrittyKeybindings()
		if modified {
			fmt.Printf("%s Alacritty %s\n", renderer.Dim("Configured shift+enter for"), renderer.Dim("terminal"))
			fmt.Printf("%s %s\n", renderer.Dim("  →"), path)
		} else if path != "" {
			fmt.Printf("%s\n", renderer.Dim("✓ Alacritty shift+enter already configured"))
			fmt.Printf("%s %s\n", renderer.Dim("  →"), path)
		}

	case "kitty":
		modified, path := SetupKittyKeybindings()
		if modified {
			fmt.Printf("%s Kitty %s\n", renderer.Dim("Configured shift+enter for"), renderer.Dim("terminal"))
			fmt.Printf("%s %s\n", renderer.Dim("  →"), path)
		} else if path != "" {
			fmt.Printf("%s\n", renderer.Dim("✓ Kitty shift+enter already configured"))
			fmt.Printf("%s %s\n", renderer.Dim("  →"), path)
		}

	case "iterm2":
		fmt.Printf("%s\n", renderer.Dim("✓ iTerm2 shift+enter works by default (maps to alt+enter)"))

	case "terminal.app":
		fmt.Printf("%s\n", renderer.Dim("⚠ Terminal.app requires manual configuration"))
		fmt.Printf("%s\n", renderer.Dim("  See: Terminal → Preferences → Profiles → Keyboard"))

	case "unknown":
		fmt.Printf("%s\n", renderer.Dim("ℹ Terminal not detected - use alt+enter or ctrl+j for newlines"))
	}
}

// getVSCodeConfigPath returns the platform-specific path to VS Code's User directory
func getVSCodeConfigPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}

	switch runtime.GOOS {
	case "darwin":
		return filepath.Join(home, "Library", "Application Support", "Code", "User"), nil
	case "windows":
		appData := os.Getenv("APPDATA")
		if appData == "" {
			appData = filepath.Join(home, "AppData", "Roaming")
		}
		return filepath.Join(appData, "Code", "User"), nil
	default: // linux, freebsd, etc.
		return filepath.Join(home, ".config", "Code", "User"), nil
	}
}

// getCursorConfigPath returns the platform-specific path to Cursor's User directory
func getCursorConfigPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}

	switch runtime.GOOS {
	case "darwin":
		return filepath.Join(home, "Library", "Application Support", "Cursor", "User"), nil
	case "windows":
		appData := os.Getenv("APPDATA")
		if appData == "" {
			appData = filepath.Join(home, "AppData", "Roaming")
		}
		return filepath.Join(appData, "Cursor", "User"), nil
	default: // linux, freebsd, etc.
		return filepath.Join(home, ".config", "Cursor", "User"), nil
	}
}

// DetectTerminal identifies which terminal emulator is currently running
func DetectTerminal() string {
	// Check TERM_PROGRAM (works for most terminals)
	termProgram := os.Getenv("TERM_PROGRAM")
	switch termProgram {
	case "vscode":
		return "vscode" // Also covers Cursor (uses same value)
	case "WezTerm":
		return "wezterm"
	case "ghostty":
		return "ghostty"
	case "iTerm.app":
		return "iterm2"
	case "Apple_Terminal":
		return "terminal.app"
	}

	// Kitty doesn't set TERM_PROGRAM, check KITTY_WINDOW_ID
	if os.Getenv("KITTY_WINDOW_ID") != "" {
		return "kitty"
	}

	// Alacritty doesn't set TERM_PROGRAM, check ALACRITTY_SOCKET
	if os.Getenv("ALACRITTY_SOCKET") != "" {
		return "alacritty"
	}

	// Ghostty fallback (cross-platform - more reliable than TERM_PROGRAM)
	if os.Getenv("GHOSTTY_RESOURCES_DIR") != "" {
		return "ghostty"
	}

	// Alacritty fallback
	if os.Getenv("ALACRITTY_LOG") != "" {
		return "alacritty"
	}

	// Check TERM variable as last resort
	term := os.Getenv("TERM")
	if strings.Contains(term, "kitty") {
		return "kitty"
	}
	if term == "alacritty" {
		return "alacritty"
	}
	if term == "xterm-ghostty" {
		return "ghostty"
	}

	return "unknown"
}

// VSCodeKeybinding represents a VS Code keyboard shortcut
type VSCodeKeybinding struct {
	Key     string                 `json:"key"`
	Command string                 `json:"command"`
	Args    map[string]interface{} `json:"args,omitempty"`
	When    string                 `json:"when,omitempty"`
}

// SetupVSCodeKeybindings adds shift+enter support to VS Code's integrated terminal
// by modifying the user's keybindings.json file.
// Returns (wasModified, configPath) to allow caller to log the change.
func SetupVSCodeKeybindings() (bool, string) {
	// Get platform-specific VS Code config path
	configDir, err := getVSCodeConfigPath()
	if err != nil {
		return false, ""
	}

	keybindingsPath := filepath.Join(configDir, "keybindings.json")

	// Check if VS Code is installed (keybindings file or parent dir exists)
	if _, err := os.Stat(filepath.Dir(keybindingsPath)); os.IsNotExist(err) {
		// VS Code not installed, skip silently
		return false, ""
	}

	// Read existing keybindings
	var keybindings []VSCodeKeybinding

	data, err := os.ReadFile(keybindingsPath)
	if err != nil {
		if !os.IsNotExist(err) {
			return false, ""
		}
		// File doesn't exist, start with empty array
		keybindings = []VSCodeKeybinding{}
	} else {
		// Parse existing keybindings
		if err := json.Unmarshal(data, &keybindings); err != nil {
			// If parse fails, don't modify the file
			return false, ""
		}
	}

	// Check if shift+enter binding already exists
	for _, kb := range keybindings {
		if kb.Key == "shift+enter" && kb.Command == "workbench.action.terminal.sendSequence" {
			// Already configured
			return false, keybindingsPath
		}
	}

	// Add shift+enter keybinding
	newBinding := VSCodeKeybinding{
		Key:     "shift+enter",
		Command: "workbench.action.terminal.sendSequence",
		Args: map[string]interface{}{
			"text": "\u001b\n", // ESC + newline (alt+enter sequence)
		},
		When: "terminalFocus",
	}

	keybindings = append(keybindings, newBinding)

	// Create backup
	if data != nil {
		backupPath := keybindingsPath + ".backup"
		_ = os.WriteFile(backupPath, data, 0644)
	}

	// Write updated keybindings
	updatedData, err := json.MarshalIndent(keybindings, "", "  ")
	if err != nil {
		return false, ""
	}

	// Ensure parent directory exists
	if err := os.MkdirAll(filepath.Dir(keybindingsPath), 0755); err != nil {
		return false, ""
	}

	if err := os.WriteFile(keybindingsPath, updatedData, 0644); err != nil {
		return false, ""
	}

	return true, keybindingsPath
}

// SetupCursorKeybindings adds shift+enter support to Cursor's integrated terminal
// by modifying the user's keybindings.json file.
// Cursor is a fork of VS Code, so it uses the same keybinding format.
// Returns (wasModified, configPath) to allow caller to log the change.
func SetupCursorKeybindings() (bool, string) {
	// Get platform-specific Cursor config path
	configDir, err := getCursorConfigPath()
	if err != nil {
		return false, ""
	}

	keybindingsPath := filepath.Join(configDir, "keybindings.json")

	// Check if Cursor is installed (keybindings file or parent dir exists)
	if _, err := os.Stat(filepath.Dir(keybindingsPath)); os.IsNotExist(err) {
		// Cursor not installed, skip silently
		return false, ""
	}

	// Read existing keybindings
	var keybindings []VSCodeKeybinding

	data, err := os.ReadFile(keybindingsPath)
	if err != nil {
		if !os.IsNotExist(err) {
			return false, ""
		}
		// File doesn't exist, start with empty array
		keybindings = []VSCodeKeybinding{}
	} else {
		// Parse existing keybindings
		if err := json.Unmarshal(data, &keybindings); err != nil {
			// If parse fails, don't modify the file
			return false, ""
		}
	}

	// Check if shift+enter binding already exists
	for _, kb := range keybindings {
		if kb.Key == "shift+enter" && kb.Command == "workbench.action.terminal.sendSequence" {
			// Already configured
			return false, keybindingsPath
		}
	}

	// Add shift+enter keybinding
	newBinding := VSCodeKeybinding{
		Key:     "shift+enter",
		Command: "workbench.action.terminal.sendSequence",
		Args: map[string]interface{}{
			"text": "\u001b\n", // ESC + newline (alt+enter sequence)
		},
		When: "terminalFocus",
	}

	keybindings = append(keybindings, newBinding)

	// Create backup
	if data != nil {
		backupPath := keybindingsPath + ".backup"
		_ = os.WriteFile(backupPath, data, 0644)
	}

	// Write updated keybindings
	updatedData, err := json.MarshalIndent(keybindings, "", "  ")
	if err != nil {
		return false, ""
	}

	// Ensure parent directory exists
	if err := os.MkdirAll(filepath.Dir(keybindingsPath), 0755); err != nil {
		return false, ""
	}

	if err := os.WriteFile(keybindingsPath, updatedData, 0644); err != nil {
		return false, ""
	}

	return true, keybindingsPath
}

// SetupGhosttyKeybindings adds shift+enter support to Ghostty terminal
// by appending to the user's config file.
// Returns (wasModified, configPath) to allow caller to log the change.
func SetupGhosttyKeybindings() (bool, string) {
	home, err := os.UserHomeDir()
	if err != nil {
		return false, ""
	}

	// Ghostty config location: ~/.config/ghostty/config
	configPath := filepath.Join(home, ".config", "ghostty", "config")

	// Check if config directory exists
	configDir := filepath.Dir(configPath)
	if _, err := os.Stat(configDir); os.IsNotExist(err) {
		// Ghostty not installed, skip silently
		return false, ""
	}

	// Read existing config if it exists
	var existingContent []byte
	if data, err := os.ReadFile(configPath); err == nil {
		existingContent = data
		// Check if shift+enter already configured
		if strings.Contains(string(data), "keybind = shift+enter") {
			return false, configPath
		}
	}

	// Keybinding to add - send newline character (0x0a)
	// Ghostty requires \x0a hex escape syntax, verified working
	keybinding := "keybind = shift+enter=text:\\x0a\n"

	// Append to config
	newContent := append(existingContent, []byte(keybinding)...)

	// Ensure directory exists
	if err := os.MkdirAll(configDir, 0755); err != nil {
		return false, ""
	}

	// Create backup if file exists
	if existingContent != nil {
		backupPath := configPath + ".backup"
		_ = os.WriteFile(backupPath, existingContent, 0644)
	}

	// Write updated config
	if err := os.WriteFile(configPath, newContent, 0644); err != nil {
		return false, ""
	}

	return true, configPath
}

// SetupWezTermKeybindings adds shift+enter support to WezTerm
// by appending to the user's .wezterm.lua file.
// Returns (wasModified, configPath)
func SetupWezTermKeybindings() (bool, string) {
	home, err := os.UserHomeDir()
	if err != nil {
		return false, ""
	}

	configPath := filepath.Join(home, ".wezterm.lua")

	// Check if WezTerm config exists
	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		// WezTerm not configured, skip silently
		return false, ""
	}

	// Read existing config
	data, err := os.ReadFile(configPath)
	if err != nil {
		return false, ""
	}

	// Check if shift+enter already configured
	if strings.Contains(string(data), "key = 'Enter'") && strings.Contains(string(data), "mods = 'SHIFT'") {
		return false, configPath
	}

	// Create backup
	backupPath := configPath + ".backup"
	_ = os.WriteFile(backupPath, data, 0644)

	// Keybinding to add (insert before final return statement)
	keybinding := `
-- Shift+Enter for newlines (added by Cline CLI)
config.keys = config.keys or {}
table.insert(config.keys, {
  key = 'Enter',
  mods = 'SHIFT',
  action = wezterm.action.SendString '\x1b\n',
})
`

	content := string(data)
	// Try to insert before the final return statement
	if strings.Contains(content, "return config") {
		content = strings.Replace(content, "return config", keybinding+"\nreturn config", 1)
	} else {
		// No return statement, append at end
		content += keybinding
	}

	// Write updated config
	if err := os.WriteFile(configPath, []byte(content), 0644); err != nil {
		return false, ""
	}

	return true, configPath
}

// SetupAlacrittyKeybindings adds shift+enter support to Alacritty
// by appending to the user's alacritty.yml file.
// Returns (wasModified, configPath)
func SetupAlacrittyKeybindings() (bool, string) {
	home, err := os.UserHomeDir()
	if err != nil {
		return false, ""
	}

	// Try both possible locations
	configPaths := []string{
		filepath.Join(home, ".config", "alacritty", "alacritty.yml"),
		filepath.Join(home, ".config", "alacritty", "alacritty.toml"),
		filepath.Join(home, ".alacritty.yml"),
	}

	var configPath string
	for _, path := range configPaths {
		if _, err := os.Stat(path); err == nil {
			configPath = path
			break
		}
	}

	if configPath == "" {
		// Alacritty not configured, skip silently
		return false, ""
	}

	// Read existing config
	data, err := os.ReadFile(configPath)
	if err != nil {
		return false, ""
	}

	// Check if shift+enter already configured
	if strings.Contains(string(data), "key: Return") && strings.Contains(string(data), "mods: Shift") {
		return false, configPath
	}

	// Create backup
	backupPath := configPath + ".backup"
	_ = os.WriteFile(backupPath, data, 0644)

	// Keybinding to add
	var keybinding string
	if strings.HasSuffix(configPath, ".yml") || strings.HasSuffix(configPath, ".yaml") {
		keybinding = `
# Shift+Enter for newlines (added by Cline CLI)
key_bindings:
  - { key: Return, mods: Shift, chars: "\x1b\n" }
`
	} else {
		// TOML format
		keybinding = `
# Shift+Enter for newlines (added by Cline CLI)
[[keyboard.bindings]]
key = "Return"
mods = "Shift"
chars = "\x1b\n"
`
	}

	// Append to config
	newContent := append(data, []byte(keybinding)...)

	// Write updated config
	if err := os.WriteFile(configPath, newContent, 0644); err != nil {
		return false, ""
	}

	return true, configPath
}

// SetupKittyKeybindings adds shift+enter support to Kitty terminal
// by appending to the user's kitty.conf file.
// Returns (wasModified, configPath)
func SetupKittyKeybindings() (bool, string) {
	home, err := os.UserHomeDir()
	if err != nil {
		return false, ""
	}

	configPath := filepath.Join(home, ".config", "kitty", "kitty.conf")

	// Check if config directory exists
	configDir := filepath.Dir(configPath)
	if _, err := os.Stat(configDir); os.IsNotExist(err) {
		// Kitty not installed, skip silently
		return false, ""
	}

	// Read existing config if it exists
	var existingContent []byte
	if data, err := os.ReadFile(configPath); err == nil {
		existingContent = data
		// Check if shift+enter already configured
		if strings.Contains(string(data), "map shift+enter") {
			return false, configPath
		}
	}

	// Keybinding to add
	keybinding := "# Shift+Enter for newlines (added by Cline CLI)\nmap shift+enter send_text all \\x1b\\n\n"

	// Append to config
	newContent := append(existingContent, []byte(keybinding)...)

	// Ensure directory exists
	if err := os.MkdirAll(configDir, 0755); err != nil {
		return false, ""
	}

	// Create backup if file exists
	if existingContent != nil {
		backupPath := configPath + ".backup"
		_ = os.WriteFile(backupPath, existingContent, 0644)
	}

	// Write updated config
	if err := os.WriteFile(configPath, newContent, 0644); err != nil {
		return false, ""
	}

	return true, configPath
}
