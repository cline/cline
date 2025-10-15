package terminal

import (
	"strings"

	tea "github.com/charmbracelet/bubbletea"
)

// ParseEnhancedKeyMsg attempts to parse enhanced keyboard protocol sequences
// that bubbletea doesn't natively support yet.
//
// This handles:
// - modifyOtherKeys: ESC [ 27 ; 2 ; 13 ~ (shift+enter)
// - Kitty protocol: ESC [ 13 : 2 u (shift+enter)
//
// Returns true if the message was enhanced and handled.
func ParseEnhancedKeyMsg(msg tea.Msg) (tea.KeyMsg, bool) {
	keyMsg, ok := msg.(tea.KeyMsg)
	if !ok {
		return tea.KeyMsg{}, false
	}

	// Check if this is an unknown CSI sequence that might be shift+enter
	msgStr := keyMsg.String()

	// modifyOtherKeys format: CSI 27;2;13~
	// This appears as an unknown sequence in bubbletea
	// The pattern is: ESC [ 27 ; <modifier> ; <keycode> ~
	// For shift+enter: ESC [ 27 ; 2 ; 13 ~
	if strings.Contains(msgStr, "27;2;13") ||
	   strings.Contains(msgStr, "27 ; 2 ; 13") {
		return tea.KeyMsg{
			Type: tea.KeyEnter,
			Alt:  false,
			// We'll use a custom marker by setting runes to signal shift
			// Since bubbletea doesn't have a built-in shift modifier,
			// we'll return this as if it matches "shift+enter" string
		}, true
	}

	// Kitty protocol format: CSI <unicode> : <modifiers> u
	// For shift+enter: ESC [ 13 : 2 u
	// Modifier bits: 1=shift, 2=alt, 4=ctrl, 8=super, 16=hyper, 32=meta
	if strings.Contains(msgStr, "13:2u") ||
	   strings.Contains(msgStr, "13 : 2") {
		return tea.KeyMsg{
			Type: tea.KeyEnter,
			Alt:  false,
		}, true
	}

	return tea.KeyMsg{}, false
}

// IsShiftEnter checks if a key message represents shift+enter.
// This works with both native bubbletea support (if available) and
// our custom enhanced keyboard protocol parsing.
func IsShiftEnter(msg tea.Msg) bool {
	keyMsg, ok := msg.(tea.KeyMsg)
	if !ok {
		return false
	}

	// Check if bubbletea natively detected shift+enter
	// (this would work if shift+enter is in their sequences map)
	if keyMsg.String() == "shift+enter" {
		return true
	}

	// Check if we parsed it from enhanced protocol
	_, enhanced := ParseEnhancedKeyMsg(msg)
	return enhanced
}
