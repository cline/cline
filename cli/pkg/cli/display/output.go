package display

import (
	"fmt"

	tea "github.com/charmbracelet/bubbletea/v2"
)

// OutputWriter is the interface for writing output
type OutputWriter interface {
	Printf(format string, args ...interface{})
	Print(text string)
}

// Global output writer - defaults to stdout
var globalOutput OutputWriter = &StdoutWriter{}

// SetOutputWriter sets the global output writer
// Should be called once before any concurrent output operations
func SetOutputWriter(w OutputWriter) {
	globalOutput = w
}

// Printf writes formatted output using the global output writer
func Printf(format string, args ...interface{}) {
	globalOutput.Printf(format, args...)
}

// Print writes text using the global output writer
func Print(text string) {
	globalOutput.Print(text)
}

// StdoutWriter writes to stdout using fmt
type StdoutWriter struct{}

func (w *StdoutWriter) Printf(format string, args ...interface{}) {
	fmt.Printf(format, args...)
}

func (w *StdoutWriter) Print(text string) {
	fmt.Print(text)
}

// PrintMsg is a message type that triggers tea.Printf output
type PrintMsg string

// BubbleTeaWriter writes using tea.Printf for coordination with BubbleTea UI
type BubbleTeaWriter struct {
	program *tea.Program
}

func NewBubbleTeaWriter(program *tea.Program) *BubbleTeaWriter {
	return &BubbleTeaWriter{program: program}
}

func (w *BubbleTeaWriter) Printf(format string, args ...interface{}) {
	if w.program != nil {
		text := fmt.Sprintf(format, args...)
		w.program.Send(PrintMsg(text))
	} else {
		// Fallback if program is nil
		fmt.Printf(format, args...)
	}
}

func (w *BubbleTeaWriter) Print(text string) {
	if w.program != nil {
		w.program.Send(PrintMsg(text))
	} else {
		fmt.Print(text)
	}
}
