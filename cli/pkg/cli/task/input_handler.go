package task

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/charmbracelet/huh"
	"github.com/cline/cli/pkg/cli/global"
	"github.com/cline/cli/pkg/cli/types"
)

// InputHandler manages interactive user input during follow mode
type InputHandler struct {
	manager     *Manager
	coordinator *StreamCoordinator
	cancelFunc  context.CancelFunc
	mu          sync.RWMutex
	isRunning   bool
	pollTicker  *time.Ticker
}

// NewInputHandler creates a new input handler
func NewInputHandler(manager *Manager, coordinator *StreamCoordinator, cancelFunc context.CancelFunc) *InputHandler {
	return &InputHandler{
		manager:     manager,
		coordinator: coordinator,
		cancelFunc:  cancelFunc,
		isRunning:   false,
		pollTicker:  time.NewTicker(500 * time.Millisecond),
	}
}

// Start begins monitoring for input opportunities
func (ih *InputHandler) Start(ctx context.Context, errChan chan error) {
	ih.mu.Lock()
	ih.isRunning = true
	ih.mu.Unlock()

	defer func() {
		ih.mu.Lock()
		ih.isRunning = false
		ih.mu.Unlock()
		ih.pollTicker.Stop()
	}()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ih.pollTicker.C:
			// First check if approval is needed
			needsApproval, approvalMsg, err := ih.manager.CheckNeedsApproval(ctx)
			if err != nil {
				if global.Config.Verbose {
					fmt.Printf("\nDebug: CheckNeedsApproval error: %v\n", err)
				}
				continue
			}

			if needsApproval {
				ih.coordinator.SetInputAllowed(true)

				// Show approval prompt
				approved, feedback, err := ih.promptForApproval(ctx, approvalMsg)
				if err != nil {
					// Check if the error is due to interrupt (Ctrl+C) or context cancellation
					if err == huh.ErrUserAborted || ctx.Err() != nil {
						// User pressed Ctrl+C, cancel the context and exit cleanly
						ih.cancelFunc()
						return
					}
					if global.Config.Verbose {
						fmt.Printf("\nDebug: Approval prompt error: %v\n", err)
					}
					continue
				}

				ih.coordinator.SetInputAllowed(false)

				// Send approval response
				approveStr := "false"
				if approved {
					approveStr = "true"
				}

				if err := ih.manager.SendMessage(ctx, feedback, nil, nil, approveStr); err != nil {
					fmt.Printf("\nError sending approval: %v\n", err)
					continue
				}

				if global.Config.Verbose {
					fmt.Printf("\nDebug: Approval sent (approved=%s, feedback=%q)\n", approveStr, feedback)
				}

				// Give the system a moment to process before re-polling
				time.Sleep(1 * time.Second)
				continue
			}

			// Check if we can send a regular message
			sendDisabled, err := ih.manager.CheckSendDisabled(ctx)
			if err != nil {
				if global.Config.Verbose {
					fmt.Printf("\nDebug: CheckSendDisabled error: %v\n", err)
				}
				continue
			}

			// If send is enabled (not disabled), show prompt
			if !sendDisabled {
				ih.coordinator.SetInputAllowed(true)

				// Show prompt and get input
				message, shouldSend, err := ih.promptForInput(ctx)
				if err != nil {
					// Check if the error is due to interrupt (Ctrl+C) or context cancellation
					if err == huh.ErrUserAborted || ctx.Err() != nil {
						// User pressed Ctrl+C, cancel the context and exit cleanly
						ih.cancelFunc()
						return
					}
					if global.Config.Verbose {
						fmt.Printf("\nDebug: Input prompt error: %v\n", err)
					}
					continue
				}

				ih.coordinator.SetInputAllowed(false)

				if shouldSend {
					// Handle special commands
					if handled := ih.handleSpecialCommand(ctx, message); handled {
						continue
					}

					// Send the message
					if err := ih.manager.SendMessage(ctx, message, nil, nil, ""); err != nil {
						fmt.Printf("\nError sending message: %v\n", err)
						continue
					}

					if global.Config.Verbose {
						fmt.Printf("\nDebug: Message sent successfully\n")
					}

					// Give the system a moment to process before re-polling
					time.Sleep(1 * time.Second)
				}
			} else {
				ih.coordinator.SetInputAllowed(false)
			}
		}
	}
}

// promptForInput displays an interactive prompt and waits for user input
func (ih *InputHandler) promptForInput(ctx context.Context) (string, bool, error) {
	var message string

	// Create multiline text area form using huh
	form := huh.NewForm(
		huh.NewGroup(
			huh.NewText().
				Title("Cline is ready for your message").
				Placeholder("Type your message... (alt+enter for new line, enter to submit)").
				Lines(5).
				Value(&message),
		),
	)

	// Run the form
	err := form.Run()
	if err != nil {
		return "", false, err
	}

	// Trim whitespace
	message = strings.TrimSpace(message)

	// If empty, user just wants to keep watching
	if message == "" {
		return "", false, nil
	}

	return message, true, nil
}

// promptForApproval displays an approval prompt for tool/command requests
// Returns (approved, message, error)
// Note: The approval details are already shown by segment streamer / state stream
func (ih *InputHandler) promptForApproval(ctx context.Context, msg *types.ClineMessage) (bool, string, error) {
	// Show selection menu (approval details already displayed by other handlers)
	fmt.Println()
	var choice string
	form := huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[string]().
				Title("Let Cline use this tool?").
				Options(
					huh.NewOption("Yes", "yes"),
					huh.NewOption("Yes with feedback", "yes_feedback"),
					huh.NewOption("No", "no"),
					huh.NewOption("No with feedback", "no_feedback"),
				).
				Value(&choice),
		),
	)

	err := form.Run()
	if err != nil {
		return false, "", err
	}

	// Check if feedback is needed
	needsFeedback := choice == "yes_feedback" || choice == "no_feedback"
	approved := choice == "yes" || choice == "yes_feedback"

	var feedback string
	if needsFeedback {
		// Show multiline text area for feedback
		feedbackForm := huh.NewForm(
			huh.NewGroup(
				huh.NewText().
					Title("Your feedback").
					Placeholder("Type your message... (alt+enter for new line, enter to submit)").
					Lines(5).
					Value(&feedback),
			),
		)

		err := feedbackForm.Run()
		if err != nil {
			return false, "", err
		}

		feedback = strings.TrimSpace(feedback)
	}

	return approved, feedback, nil
}

// handleSpecialCommand processes special commands like /cancel, /exit
func (ih *InputHandler) handleSpecialCommand(ctx context.Context, message string) bool {
	switch strings.ToLower(strings.TrimSpace(message)) {
	case "/cancel":
		fmt.Println("\nCancelling task...")
		if err := ih.manager.CancelTask(ctx); err != nil {
			fmt.Printf("Error cancelling task: %v\n", err)
		} else {
			fmt.Println("Task cancelled successfully")
		}
		return true
	case "/exit", "/quit":
		fmt.Println("\nExiting follow mode...")
		// This will be handled by context cancellation
		return true
	default:
		return false
	}
}

// Stop stops the input handler
func (ih *InputHandler) Stop() {
	ih.mu.Lock()
	defer ih.mu.Unlock()
	if ih.pollTicker != nil {
		ih.pollTicker.Stop()
	}
	ih.isRunning = false
}

// IsRunning returns whether the input handler is currently running
func (ih *InputHandler) IsRunning() bool {
	ih.mu.RLock()
	defer ih.mu.RUnlock()
	return ih.isRunning
}
