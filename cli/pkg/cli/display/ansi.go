package display

import (
	"os"

	"golang.org/x/term"
)

func isTTY() bool {
	return term.IsTerminal(int(os.Stdout.Fd()))
}

func ClearLine() {
	if !isTTY() {
		return
	}
	Print("\r\033[K")
}

// ClearToEnd clears from cursor to end of screen
func ClearToEnd() {
	if !isTTY() {
		return
	}
	Print("\033[J")
}
