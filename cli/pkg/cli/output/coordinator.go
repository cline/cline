package output

import (
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

// SuspendInputMsg tells the input model to suspend and hide
type SuspendInputMsg struct{}

// ResumeInputMsg tells the input model to resume and show
type ResumeInputMsg struct{}

// OutputCoordinator manages terminal output and coordinates with interactive input
type OutputCoordinator struct {
	mu              sync.Mutex
	program         *tea.Program
	inputVisible    atomic.Bool
	inputModel      *InputModel      // Reference to current input model for state restoration
	restartCallback func(*InputModel) // Callback to restart the program with preserved state
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

// SetInputModel sets the current input model reference for state preservation
func (oc *OutputCoordinator) SetInputModel(model *InputModel) {
	oc.mu.Lock()
	defer oc.mu.Unlock()
	oc.inputModel = model
}

// SetRestartCallback sets the callback for restarting the program
func (oc *OutputCoordinator) SetRestartCallback(callback func(*InputModel)) {
	oc.mu.Lock()
	defer oc.mu.Unlock()
	oc.restartCallback = callback
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
	prog := oc.program
	model := oc.inputModel
	restart := oc.restartCallback
	visible := oc.inputVisible.Load()
	oc.mu.Unlock()

	if visible && prog != nil && restart != nil && model != nil {
		// Kill/restart approach: completely stop the program, print, restart with state

		// 1. Save the current input state (text, cursor position, etc.)
		savedModel := model.Clone()

		// 2. Manually clear the form from terminal BEFORE quitting
		clearCodes := model.ClearScreen()
		if clearCodes != "" {
			fmt.Print(clearCodes)
		}

		// 3. Quit the program
		prog.Send(Quit())

		// Small delay to let program actually quit
		time.Sleep(20 * time.Millisecond)

		// 4. Print the output
		fmt.Printf(format, args...)

		// 5. Restart with preserved state
		restart(savedModel)
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

// SetInputModel sets the input model on the global coordinator
func SetInputModel(model *InputModel) {
	GetCoordinator().SetInputModel(model)
}

// SetRestartCallback sets the restart callback on the global coordinator
func SetRestartCallback(callback func(*InputModel)) {
	GetCoordinator().SetRestartCallback(callback)
}

// Quit returns a Bubble Tea quit message
func Quit() tea.Msg {
	return tea.Quit()
}
