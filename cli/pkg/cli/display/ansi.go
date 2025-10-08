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
