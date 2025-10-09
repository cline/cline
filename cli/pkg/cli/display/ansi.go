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

func MoveUp(n int) {
	if !isTTY() || n <= 0 {
		return
	}
	fmt.Printf("\033[%dA", n)
}

func ClearLines(n int) {
	if !isTTY() || n <= 0 {
		return
	}
	for i := 0; i < n; i++ {
		MoveUp(1)
		ClearLine()
	}
}

// ClearToEnd clears from cursor to end of screen
func ClearToEnd() {
	if !isTTY() {
		return
	}
	fmt.Print("\033[J")
}

// ClearCurrentAndBelow clears N lines starting from current position
func ClearCurrentAndBelow(n int) {
	if !isTTY() || n <= 0 {
		return
	}
	
	// Clear n lines:
	// - Clear current line
	// - Move down and clear (n-1) more lines
	// - Move back up to start
	for i := 0; i < n; i++ {
		fmt.Print("\033[K") // Clear from cursor to end of line
		if i < n-1 {
			fmt.Print("\033[1B\r") // Move down 1 line and to start
		}
	}
	
	// Move back up to the first line we cleared
	if n > 1 {
		fmt.Printf("\033[%dA", n-1)
	}
}

// SaveCursor saves the current cursor position
func SaveCursor() {
	if !isTTY() {
		return
	}
	fmt.Print("\033[s")
}

// RestoreCursor restores the cursor to the saved position
func RestoreCursor() {
	if !isTTY() {
		return
	}
	fmt.Print("\033[u")
}
