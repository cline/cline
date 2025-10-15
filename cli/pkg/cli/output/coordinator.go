package output

import (
	"fmt"
	"sync"
	"sync/atomic"

	tea "github.com/charmbracelet/bubbletea"
)

// SuspendInputMsg tells the input model to suspend and hide
type SuspendInputMsg struct{}

// ResumeInputMsg tells the input model to resume and show
type ResumeInputMsg struct{}

// OutputCoordinator manages terminal output and coordinates with interactive input
type OutputCoordinator struct {
	mu           sync.Mutex
	program      *tea.Program
	inputVisible atomic.Bool
}

var (
	globalCoordinator *OutputCoordinator
	coordinatorMu     sync.Mutex
)

// GetCoordinator returns the global output coordinator instance
func GetCoordinator() *OutputCoordinator {
	coordinatorMu.Lock()
	defer coordinatorMu.Unlock()

	if globalCoordinator == nil {
		globalCoordinator = &OutputCoordinator{}
	}
	return globalCoordinator
}

// SetProgram sets the bubbletea program for input coordination
func (oc *OutputCoordinator) SetProgram(program *tea.Program) {
	oc.mu.Lock()
	defer oc.mu.Unlock()
	oc.program = program
}

// SetInputVisible sets whether input is currently visible
func (oc *OutputCoordinator) SetInputVisible(visible bool) {
	oc.inputVisible.Store(visible)
}

// IsInputVisible returns whether input is currently visible
func (oc *OutputCoordinator) IsInputVisible() bool {
	return oc.inputVisible.Load()
}

// Printf prints formatted output, suspending input if necessary
func (oc *OutputCoordinator) Printf(format string, args ...interface{}) {
	oc.mu.Lock()
	defer oc.mu.Unlock()

	if oc.inputVisible.Load() && oc.program != nil {
		// Suspend input, print, then resume
		oc.program.Send(SuspendInputMsg{})
		fmt.Printf(format, args...)
		oc.program.Send(ResumeInputMsg{})
	} else {
		// No input showing, just print normally
		fmt.Printf(format, args...)
	}
}

// Println prints a line with newline, suspending input if necessary
func (oc *OutputCoordinator) Println(args ...interface{}) {
	oc.Printf("%s\n", fmt.Sprint(args...))
}

// Print prints output, suspending input if necessary
func (oc *OutputCoordinator) Print(args ...interface{}) {
	oc.Printf("%s", fmt.Sprint(args...))
}

// Package-level convenience functions

// Printf prints formatted output via the global coordinator
func Printf(format string, args ...interface{}) {
	GetCoordinator().Printf(format, args...)
}

// Println prints a line with newline via the global coordinator
func Println(args ...interface{}) {
	GetCoordinator().Println(args...)
}

// Print prints output via the global coordinator
func Print(args ...interface{}) {
	GetCoordinator().Print(args...)
}

// SetProgram sets the bubbletea program on the global coordinator
func SetProgram(program *tea.Program) {
	GetCoordinator().SetProgram(program)
}

// SetInputVisible sets input visibility on the global coordinator
func SetInputVisible(visible bool) {
	GetCoordinator().SetInputVisible(visible)
}

// IsInputVisible checks input visibility on the global coordinator
func IsInputVisible() bool {
	return GetCoordinator().IsInputVisible()
}
