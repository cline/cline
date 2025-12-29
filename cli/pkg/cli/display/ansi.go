package display

import (
	"fmt"
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
	fmt.Print("\r\033[K")
}

// ClearToEnd clears from cursor to end of screen
func ClearToEnd() {
	if !isTTY() {
		return
	}
	fmt.Print("\033[J")
}
