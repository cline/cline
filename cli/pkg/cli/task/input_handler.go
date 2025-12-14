package task

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/cline/cli/pkg/cli/global"
	"github.com/cline/cli/pkg/cli/output"
	"github.com/cline/cli/pkg/cli/types"
)

// InputHandler manages interactive user input during follow mode
type InputHandler struct {
	manager          *Manager
	coordinator      *StreamCoordinator
	cancelFunc       context.CancelFunc
	mu               sync.RWMutex
	isRunning        bool
	pollTicker       *time.Ticker
	program          *tea.Program
	programRunning   bool
	programDoneChan  chan struct{} // Signals when program actually exits
	resultChan       chan output.InputSubmitMsg
	cancelChan       chan struct{}
	feedbackApproval bool                // Track if we're in feedback after approval
	feedbackApproved bool                // Track the approval decision
	approvalMessage  *types.ClineMessage // Store the approval message for determining action
	ctx              context.Context     // Context for restart callback
}

// NewInputHandler creates a new input handler
func NewInputHandler(manager *Manager, coordinator *StreamCoordinator, cancelFunc context.CancelFunc) *InputHandler {
	return &InputHandler{
		manager:      manager,
		coordinator:  coordinator,
		cancelFunc:   cancelFunc,
		isRunning:    false,
		pollTicker:   time.NewTicker(500 * time.Millisecond),
		resultChan:   make(chan output.InputSubmitMsg, 1),
		cancelChan:   make(chan struct{}, 1),
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
		if ih.program != nil {
			ih.program.Quit()
		}
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
					output.Printf("\nDebug: CheckNeedsApproval error: %v\n", err)
				}
				continue
			}

			if needsApproval {
				ih.coordinator.SetInputAllowed(true)

				// Show approval prompt
				approved, feedback, err := ih.promptForApproval(ctx, approvalMsg)

				if err != nil {
					// Check if the error is due to interrupt (Ctrl+C) or context cancellation
					if errors.Is(err, context.Canceled) || ctx.Err() != nil {
						// User pressed Ctrl+C - cancel context to exit FollowConversation
						ih.cancelFunc()
						return
					}
					if global.Config.Verbose {
						output.Printf("\nDebug: Approval prompt error: %v\n", err)
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
					output.Printf("\nError sending approval: %v\n", err)
					continue
				}

				if global.Config.Verbose {
					output.Printf("\nDebug: Approval sent (approved=%s, feedback=%q)\n", approveStr, feedback)
				}

				// Give the system a moment to process before re-polling
				time.Sleep(1 * time.Second)
				continue
			}

			// Check if we can send a regular message
			err = ih.manager.CheckSendEnabled(ctx)
			if err != nil {
				// Handle specific error cases
				if errors.Is(err, ErrNoActiveTask) {
					// No active task - don't show input prompt
					ih.coordinator.SetInputAllowed(false)
					continue
				}
				if errors.Is(err, ErrTaskBusy) {
					// Task is busy - don't show input prompt
					ih.coordinator.SetInputAllowed(false)
					continue
				}
				// Unexpected error
				if global.Config.Verbose {
					output.Printf("\nDebug: CheckSendEnabled error: %v\n", err)
				}
				continue
			}

			// If we reach here, we can send a message
			ih.coordinator.SetInputAllowed(true)

			// Show prompt and get input
			message, shouldSend, err := ih.promptForInput(ctx)

			if err != nil {
				// Check if the error is due to interrupt (Ctrl+C) or context cancellation
				if errors.Is(err, context.Canceled) || ctx.Err() != nil {
					// User pressed Ctrl+C - cancel context to exit FollowConversation
					ih.cancelFunc()
					return
				}
				if global.Config.Verbose {
					output.Printf("\nDebug: Input prompt error: %v\n", err)
				}
				continue
			}

			ih.coordinator.SetInputAllowed(false)

			if shouldSend {
				// Check for mode switch commands first
				newMode, remainingMessage, isModeSwitch := ih.parseModeSwitch(message)
				if isModeSwitch {
					// Create styles for mode switch messages (respect global color profile)
					actStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("39")).Bold(true)
					planStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("3")).Bold(true)

					if remainingMessage != "" {
						// Switching with a message - behavior differs by mode
						if newMode == "act" {
							// Act mode: can send mode + message in one call
							if err := ih.manager.SetMode(ctx, newMode, &remainingMessage, nil, nil); err != nil {
								output.Printf("\nError switching to act mode with message: %v\n", err)
								continue
							}
							output.Printf("\n%s\n", actStyle.Render("Switched to act mode"))
						} else {
							// Plan mode: must switch first, then send message separately
							if err := ih.manager.SetMode(ctx, newMode, nil, nil, nil); err != nil {
								output.Printf("\nError switching to plan mode: %v\n", err)
								continue
							}
							output.Printf("\n%s\n", planStyle.Render("Switched to plan mode"))

							// Now send the message separately
							time.Sleep(500 * time.Millisecond) // Give mode switch time to process
							if err := ih.manager.SendMessage(ctx, remainingMessage, nil, nil, ""); err != nil {
								output.Printf("\nError sending message after mode switch: %v\n", err)
								continue
							}
						}
					} else {
						// Just switch mode, no message
						if err := ih.manager.SetMode(ctx, newMode, nil, nil, nil); err != nil {
							output.Printf("\nError switching to %s mode: %v\n", newMode, err)
							continue
						}
						// Color based on mode
						if newMode == "act" {
							output.Printf("\n%s\n", actStyle.Render("Switched to act mode"))
						} else {
							output.Printf("\n%s\n", planStyle.Render("Switched to plan mode"))
						}
					}

					// Mode switch handled, continue to next poll
					time.Sleep(1 * time.Second)
					continue
				}

				// Handle special commands
				if handled := ih.handleSpecialCommand(ctx, message); handled {
					continue
				}

				// Send the message
				if err := ih.manager.SendMessage(ctx, message, nil, nil, ""); err != nil {
					output.Printf("\nError sending message: %v\n", err)
					continue
				}

				if global.Config.Verbose {
					output.Printf("\nDebug: Message sent successfully\n")
				}

				// Give the system a moment to process before re-polling
				time.Sleep(1 * time.Second)
			}
		}
	}
}

// determineAutoApprovalAction determines which auto-approval action to enable based on the ask type
func determineAutoApprovalAction(msg *types.ClineMessage) (string, error) {
	switch types.AskType(msg.Ask) {
	case types.AskTypeTool:
		// Parse tool message to determine if it's a read or edit operation
		var toolMsg types.ToolMessage
		if err := json.Unmarshal([]byte(msg.Text), &toolMsg); err != nil {
			return "", fmt.Errorf("failed to parse tool message: %w", err)
		}

		// Determine action based on tool type
		switch types.ToolType(toolMsg.Tool) {
		case types.ToolTypeReadFile,
			types.ToolTypeListFilesTopLevel,
			types.ToolTypeListFilesRecursive,
			types.ToolTypeListCodeDefinitionNames,
			types.ToolTypeSearchFiles,
			types.ToolTypeWebFetch,
			types.ToolTypeWebSearch:
			return "read_files", nil
		case types.ToolTypeEditedExistingFile,
			types.ToolTypeNewFileCreated:
			return "edit_files", nil
		case types.ToolTypeFileDeleted:
			return "apply_patch", nil
		default:
			return "", fmt.Errorf("unsupported tool type: %s", toolMsg.Tool)
		}

	case types.AskTypeCommand:
		return "execute_all_commands", nil

	case types.AskTypeBrowserActionLaunch:
		return "use_browser", nil

	case types.AskTypeUseMcpServer:
		return "use_mcp", nil

	default:
		return "", fmt.Errorf("unsupported ask type: %s", msg.Ask)
	}
}

// promptForInput displays an interactive prompt and waits for user input
func (ih *InputHandler) promptForInput(ctx context.Context) (string, bool, error) {
	currentMode := ih.manager.GetCurrentMode()

	model := output.NewInputModel(
		output.InputTypeMessage,
		"Cline is ready for your message...",
		"/plan or /act to switch modes\nctrl+e to open editor",
		currentMode,
	)

	return ih.runInputProgram(ctx, model)
}

// promptForApproval displays an approval prompt for tool/command requests
func (ih *InputHandler) promptForApproval(ctx context.Context, msg *types.ClineMessage) (bool, string, error) {
	// Store the approval message for later use in determining auto-approval action
	ih.approvalMessage = msg
	
	model := output.NewInputModel(
		output.InputTypeApproval,
		"Let Cline use this tool?",
		"",
		ih.manager.GetCurrentMode(),
	)

	message, shouldSend, err := ih.runInputProgram(ctx, model)
	if err != nil {
		return false, "", err
	}

	if !shouldSend {
		return false, "", nil
	}

	// The approval and feedback are handled via the model state
	return ih.feedbackApproved, message, nil
}

// runInputProgram runs the bubbletea program and waits for result
func (ih *InputHandler) runInputProgram(ctx context.Context, model output.InputModel) (string, bool, error) {
	ih.mu.Lock()

	// Create the program with custom update wrapper
	wrappedModel := &inputProgramWrapper{
		model:      &model,
		resultChan: ih.resultChan,
		cancelChan: ih.cancelChan,
		handler:    ih,
	}

	ih.program = tea.NewProgram(wrappedModel)
	ih.programDoneChan = make(chan struct{})
	ih.ctx = ctx

	// Set up coordinator references
	output.SetProgram(ih.program)
	output.SetInputModel(wrappedModel.model)
	output.SetRestartCallback(ih.restartProgram)
	output.SetInputVisible(true)
	ih.programRunning = true
	ih.mu.Unlock()

	// Run program in goroutine
	programErrChan := make(chan error, 1)
	go func() {
		if _, err := ih.program.Run(); err != nil {
			programErrChan <- err
		}
		// Signal that program is done
		close(ih.programDoneChan)
	}()

	// Wait for result, cancellation, or context done
	select {
	case <-ctx.Done():
		ih.mu.Lock()
		output.SetInputVisible(false)
		if ih.program != nil {
			ih.program.Quit()
		}
		ih.programRunning = false
		ih.mu.Unlock()
		return "", false, ctx.Err()

	case <-ih.cancelChan:
		ih.mu.Lock()
		output.SetInputVisible(false)
		ih.programRunning = false
		ih.mu.Unlock()
		return "", false, context.Canceled

	case err := <-programErrChan:
		ih.mu.Lock()
		output.SetInputVisible(false)
		ih.programRunning = false
		ih.mu.Unlock()
		return "", false, err

	case result := <-ih.resultChan:
		ih.mu.Lock()
		output.SetInputVisible(false)
		ih.programRunning = false
		ih.mu.Unlock()

		// Handle different input types
		switch result.InputType {
		case output.InputTypeMessage:
			if result.Value == "" {
				return "", false, nil
			}
			return result.Value, true, nil

		case output.InputTypeApproval:
			if result.NeedsFeedback {
				// Need to collect feedback - will be handled by model state change
				return "", false, nil
			}
			
			// Check if NoAskAgain was selected
			if result.NoAskAgain && result.Approved && ih.approvalMessage != nil {
				// Determine which auto-approval action to enable
				action, err := determineAutoApprovalAction(ih.approvalMessage)
				if err != nil {
					output.Printf("\nWarning: Could not determine auto-approval action: %v\n", err)
				} else {
					// Enable the auto-approval action
					if err := ih.manager.UpdateTaskAutoApprovalAction(ctx, action); err != nil {
						output.Printf("\nWarning: Could not update auto-approval: %v\n", err)
					} else {
						output.Printf("\nAuto-approval enabled for %s\n", action)
					}
				}
			}
			
			// Store approval state for when feedback comes back
			ih.feedbackApproval = false
			ih.feedbackApproved = result.Approved
			return "", true, nil

		case output.InputTypeFeedback:
			// This came from approval flow
			ih.feedbackApproval = true
			ih.feedbackApproved = result.Approved // Use the approval decision from the feedback
			return result.Value, true, nil
		}

		return "", false, nil
	}
}

// inputProgramWrapper wraps the InputModel to handle message routing
type inputProgramWrapper struct {
	model      *output.InputModel
	resultChan chan output.InputSubmitMsg
	cancelChan chan struct{}
	handler    *InputHandler
}

func (w *inputProgramWrapper) Init() tea.Cmd {
	return w.model.Init()
}

func (w *inputProgramWrapper) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case output.InputSubmitMsg:
		// Handle input submission - clear the screen before quitting
		w.resultChan <- msg
		clearCodes := w.model.ClearScreen()
		if clearCodes != "" {
			fmt.Print(clearCodes)
		}
		return w, tea.Quit

	case output.InputCancelMsg:
		// Handle cancellation - clear the screen before quitting
		w.cancelChan <- struct{}{}
		clearCodes := w.model.ClearScreen()
		if clearCodes != "" {
			fmt.Print(clearCodes)
		}
		return w, tea.Quit

	case output.ChangeInputTypeMsg:
		// Change input type (approval -> feedback)
		_, cmd := w.model.Update(msg)
		return w, cmd
	}

	// Forward to wrapped model
	_, cmd := w.model.Update(msg)
	return w, cmd
}

func (w *inputProgramWrapper) View() string {
	return w.model.View()
}

// parseModeSwitch checks if message starts with /act or /plan and extracts the mode and remaining message
func (ih *InputHandler) parseModeSwitch(message string) (string, string, bool) {
	trimmed := strings.TrimSpace(message)
	lower := strings.ToLower(trimmed)

	if strings.HasPrefix(lower, "/plan") {
		remaining := strings.TrimSpace(trimmed[5:])
		return "plan", remaining, true
	}

	if strings.HasPrefix(lower, "/act") {
		remaining := strings.TrimSpace(trimmed[4:])
		return "act", remaining, true
	}

	return "", message, false
}

// handleSpecialCommand processes special commands like /cancel, /exit
func (ih *InputHandler) handleSpecialCommand(ctx context.Context, message string) bool {
	switch strings.ToLower(strings.TrimSpace(message)) {
	case "/cancel":
		ih.manager.GetRenderer().RenderTaskCancelled()
		if err := ih.manager.CancelTask(ctx); err != nil {
			output.Printf("Error cancelling task: %v\n", err)
		} else {
			output.Println("Task cancelled successfully")
		}
		return true
	case "/exit", "/quit":
		output.Println("\nExiting follow mode...")
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
	if ih.program != nil && ih.programRunning {
		ih.program.Quit()
	}
	ih.isRunning = false
}

// IsRunning returns whether the input handler is currently running
func (ih *InputHandler) IsRunning() bool {
	ih.mu.RLock()
	defer ih.mu.RUnlock()
	return ih.isRunning
}

// restartProgram restarts the Bubble Tea program with preserved state
func (ih *InputHandler) restartProgram(savedModel *output.InputModel) {
	ih.mu.Lock()

	// Wait for old program to actually quit
	if ih.programDoneChan != nil {
		select {
		case <-ih.programDoneChan:
			// Program quit successfully
		case <-time.After(100 * time.Millisecond):
			// Timeout - continue anyway
		}
	}

	// Create new wrapper with the saved model
	wrappedModel := &inputProgramWrapper{
		model:      savedModel,
		resultChan: ih.resultChan,
		cancelChan: ih.cancelChan,
		handler:    ih,
	}

	// Start new program
	ih.program = tea.NewProgram(wrappedModel)
	ih.programDoneChan = make(chan struct{})

	// Update coordinator references
	output.SetProgram(ih.program)
	output.SetInputModel(savedModel)
	output.SetInputVisible(true)
	ih.programRunning = true
	ih.mu.Unlock()

	// Run in goroutine
	go func() {
		if _, err := ih.program.Run(); err != nil {
			// Log error if needed
			if global.Config.Verbose {
				output.Printf("\nDebug: Program restart error: %v\n", err)
			}
		}
		close(ih.programDoneChan)
	}()
}
