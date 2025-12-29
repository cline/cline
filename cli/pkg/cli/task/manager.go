package task

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/cline/cli/pkg/cli/display"
	"github.com/cline/cli/pkg/cli/global"
	"github.com/cline/cli/pkg/cli/handlers"
	"github.com/cline/cli/pkg/cli/slash"
	"github.com/cline/cli/pkg/cli/types"
	"github.com/cline/grpc-go/client"
	"github.com/cline/grpc-go/cline"
)

// Sentinel errors for CheckSendEnabled
var (
	ErrNoActiveTask = fmt.Errorf("no active task")
	ErrTaskBusy     = fmt.Errorf("task is currently busy")
)

// Manager handles task execution and message display
type Manager struct {
	mu               sync.RWMutex
	client           *client.ClineClient
	clientAddress    string
	state            *types.ConversationState
	renderer         *display.Renderer
	toolRenderer     *display.ToolRenderer
	systemRenderer   *display.SystemMessageRenderer
	streamingDisplay *display.StreamingDisplay
	handlerRegistry  *handlers.HandlerRegistry
	slashRegistry    *slash.Registry
	isStreamingMode  bool
	isInteractive    bool
	currentMode      string // "plan" or "act"
}

// NewManager creates a new task manager
func NewManager(client *client.ClineClient) *Manager {
	state := types.NewConversationState()
	renderer := display.NewRenderer(global.Config.OutputFormat)
	toolRenderer := display.NewToolRenderer(renderer.GetMdRenderer(), global.Config.OutputFormat)
	systemRenderer := display.NewSystemMessageRenderer(renderer, renderer.GetMdRenderer(), global.Config.OutputFormat)
	streamingDisplay := display.NewStreamingDisplay(state, renderer)

	// Create handler registry and register handlers
	registry := handlers.NewHandlerRegistry()
	registry.Register(handlers.NewAskHandler())
	registry.Register(handlers.NewSayHandler())

	return &Manager{
		client:           client,
		clientAddress:    "", // Will be set when client is provided
		state:            state,
		renderer:         renderer,
		toolRenderer:     toolRenderer,
		systemRenderer:   systemRenderer,
		streamingDisplay: streamingDisplay,
		handlerRegistry:  registry,
		slashRegistry:    slash.NewRegistry(),
		currentMode:      "plan", // Default mode
	}
}

// NewManagerForAddress creates a new task manager for a specific instance address
func NewManagerForAddress(ctx context.Context, address string) (*Manager, error) {
	client, err := global.GetClientForAddress(ctx, address)
	if err != nil {
		return nil, fmt.Errorf("failed to get client for address %s: %w", address, err)
	}

	manager := NewManager(client)
	manager.clientAddress = address

	// Fetch slash commands from backend (non-blocking, errors are logged)
	manager.fetchSlashCommands(ctx)

	return manager, nil
}

// NewManagerForDefault creates a new task manager using the default instance
func NewManagerForDefault(ctx context.Context) (*Manager, error) {
	client, err := global.GetDefaultClient(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get default client: %w", err)
	}

	manager := NewManager(client)

	// Get the default instance address
	if global.Clients != nil {
		manager.clientAddress = global.Clients.GetRegistry().GetDefaultInstance()
	}

	// Fetch slash commands from backend (non-blocking, errors are logged)
	manager.fetchSlashCommands(ctx)

	return manager, nil
}

// fetchSlashCommands fetches available slash commands from the backend
// This is non-blocking and errors are logged but don't prevent manager creation
func (m *Manager) fetchSlashCommands(ctx context.Context) {
	if err := m.slashRegistry.FetchFromBackend(ctx, m.client); err != nil {
		if global.Config.Verbose {
			m.renderer.RenderDebug("Failed to fetch slash commands: %v", err)
		}
		// Non-fatal: CLI-local commands are still available
	} else if global.Config.Verbose {
		m.renderer.RenderDebug("Loaded %d slash commands", len(m.slashRegistry.GetCommands()))
	}
}

// SwitchToInstance switches the manager to use a different Cline instance
func (m *Manager) SwitchToInstance(ctx context.Context, address string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Get client for the new address
	newClient, err := global.GetClientForAddress(ctx, address)
	if err != nil {
		return fmt.Errorf("failed to get client for address %s: %w", address, err)
	}

	// Update the client and address
	m.client = newClient
	m.clientAddress = address

	if global.Config.Verbose {
		m.renderer.RenderDebug("Switched to instance: %s", address)
	}

	return nil
}

// GetCurrentInstance returns the address of the current instance
func (m *Manager) GetCurrentInstance() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.clientAddress
}

// CreateTask creates a new task
func (m *Manager) CreateTask(ctx context.Context, prompt string, images, files []string, settingsFlags []string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if global.Config.Verbose {
		m.renderer.RenderDebug("Creating task: %s", prompt)
		if len(files) > 0 {
			m.renderer.RenderDebug("Files: %v", files)
		}
		if len(images) > 0 {
			m.renderer.RenderDebug("Images: %v", images)
		}
		if len(settingsFlags) > 0 {
			m.renderer.RenderDebug("Settings: %v", settingsFlags)
		}
	}

	// Check if there's an active task and cancel it first
	if err := m.cancelExistingTaskIfNeeded(ctx); err != nil {
		return "", fmt.Errorf("failed to cancel existing task: %w", err)
	}

	// Parse task settings if provided
	var taskSettings *cline.Settings
	if len(settingsFlags) > 0 {
		var err error
		taskSettings, _, err = ParseTaskSettings(settingsFlags)
		if err != nil {
			return "", fmt.Errorf("failed to parse task settings: %w", err)
		}
	}

	// Create task request
	req := &cline.NewTaskRequest{
		Text:         prompt,
		Images:       images,
		Files:        files,
		TaskSettings: taskSettings,
	}

	resp, err := m.client.Task.NewTask(ctx, req)
	if err != nil {
		return "", fmt.Errorf("failed to create task: %w", err)
	}

	taskID := resp.Value

	return taskID, nil
}

// cancelExistingTaskIfNeeded checks if there's an active task and cancels it
func (m *Manager) cancelExistingTaskIfNeeded(ctx context.Context) error {
	// Try to get the current state to check if there's an active task
	state, err := m.client.State.GetLatestState(ctx, &cline.EmptyRequest{})
	if err != nil {
		// If we can't get state, assume no active task and continue
		if global.Config.Verbose {
			m.renderer.RenderDebug("Could not get state to check for active task: %v", err)
		}
		return nil
	}

	// Properly parse the state to check if there's actually an active task
	if state.StateJson != "" {
		var stateData types.ExtensionState
		if err := json.Unmarshal([]byte(state.StateJson), &stateData); err != nil {
			// If we can't parse state, assume no active task
			if global.Config.Verbose {
				m.renderer.RenderDebug("Could not parse state JSON: %v", err)
			}
			return nil
		}

		// Check if there's actually an active task
		if stateData.CurrentTaskItem != nil && stateData.CurrentTaskItem.Id != "" {
			if global.Config.Verbose {
				m.renderer.RenderDebug("Found active task %s, cancelling...", stateData.CurrentTaskItem.Id)
			}

			// Cancel the existing task
			_, err := m.client.Task.CancelTask(ctx, &cline.EmptyRequest{})
			if err != nil {
				if global.Config.Verbose {
					m.renderer.RenderDebug("Cancel task returned error: %v", err)
				}
			} else {
				fmt.Println("Cancelled existing task to start new one")
			}
		}
	}

	return nil
}

// ValidateCheckpointExists checks if a checkpoint ID is valid
func (m *Manager) ValidateCheckpointExists(ctx context.Context, checkpointID int64) error {
	// Get current state
	state, err := m.client.State.GetLatestState(ctx, &cline.EmptyRequest{})
	if err != nil {
		return fmt.Errorf("failed to get state: %w", err)
	}

	// Extract messages
	messages, err := m.extractMessagesFromState(state.StateJson)
	if err != nil {
		return fmt.Errorf("failed to extract messages: %w", err)
	}

	// Find and validate the checkpoint message
	for _, msg := range messages {
		if msg.Timestamp == checkpointID {
			if msg.Say != string(types.SayTypeCheckpointCreated) {
				return fmt.Errorf("timestamp %d is not a checkpoint (type: %s)", checkpointID, msg.Type)
			}
			return nil // Valid checkpoint
		}
	}

	return fmt.Errorf("checkpoint ID %d not found in task history", checkpointID)
}

// CheckSendEnabled checks if we can send a message to the current task
// Returns nil if sending is allowed, or an error indicating why it's not allowed
// We duplicate the logic from buttonConfig::getButtonConfig
func (m *Manager) CheckSendEnabled(ctx context.Context) error {
	state, err := m.client.State.GetLatestState(ctx, &cline.EmptyRequest{})
	if err != nil {
		return fmt.Errorf("failed to get latest state: %w", err)
	}

	var stateData types.ExtensionState
	if err := json.Unmarshal([]byte(state.StateJson), &stateData); err != nil {
		return fmt.Errorf("failed to parse state: %w", err)
	}

	// Check if there is an active task
	if stateData.CurrentTaskItem == nil {
		return ErrNoActiveTask
	}

	messages, err := m.extractMessagesFromState(state.StateJson)
	if err != nil {
		return fmt.Errorf("failed to extract messages: %w", err)
	}

	if len(messages) == 0 {
		return nil
	}

	// Use final message to perform validation
	lastMessage := messages[len(messages)-1]

	// Error types which we allow sending on
	errorTypes := []string{
		string(types.AskTypeAPIReqFailed),        // "api_req_failed"
		string(types.AskTypeMistakeLimitReached), // "mistake_limit_reached"
	}

	isError := false

	// Check if message is an error type
	if lastMessage.Type == types.MessageTypeAsk {
		for _, errType := range errorTypes {
			if lastMessage.Ask == errType {
				isError = true
				break
			}
		}
	}

	// Streaming and error check
	if lastMessage.Partial && !isError {
		if global.Config.Verbose {
			m.renderer.RenderDebug("Send disabled: task is streaming and non-error")
		}
		return ErrTaskBusy
	}

	// All ask messages allow sending, EXCEPT command_output
	if lastMessage.Type == types.MessageTypeAsk {
		// Special case: command_output means command is actively streaming
		// In the CLI, we don't want to show input during streaming output (too messy)
		// The webview can show "Proceed While Running" button, but CLI should wait
		if lastMessage.Ask == string(types.AskTypeCommandOutput) {
			if global.Config.Verbose {
				m.renderer.RenderDebug("Send disabled: command output is streaming")
			}
			return ErrTaskBusy
		}

		if global.Config.Verbose {
			m.renderer.RenderDebug("Send enabled: ask message")
		}
		return nil
	}

	// Technically unnecessary but implements getButtonConfig 1-1
	if lastMessage.Type == types.MessageTypeSay && lastMessage.Say == string(types.SayTypeAPIReqStarted) {
		if global.Config.Verbose {
			m.renderer.RenderDebug("Send disabled: API request is active")
		}
		return ErrTaskBusy
	}

	if global.Config.Verbose {
		m.renderer.RenderDebug("Send disabled: default fallback")
	}

	return ErrTaskBusy
}

// CheckNeedsApproval determines if the current task is waiting for approval
// Returns (needsApproval, lastMessage, error)
func (m *Manager) CheckNeedsApproval(ctx context.Context) (bool, *types.ClineMessage, error) {
	state, err := m.client.State.GetLatestState(ctx, &cline.EmptyRequest{})
	if err != nil {
		return false, nil, fmt.Errorf("failed to get latest state: %w", err)
	}

	messages, err := m.extractMessagesFromState(state.StateJson)
	if err != nil {
		return false, nil, fmt.Errorf("failed to extract messages: %w", err)
	}

	if len(messages) == 0 {
		return false, nil, nil
	}

	// Use final message to check if approval is needed
	lastMessage := messages[len(messages)-1]

	// Only check non-partial ask messages
	if lastMessage.Partial {
		return false, nil, nil
	}

	// Check if this is an approval-required ask type
	if lastMessage.Type == types.MessageTypeAsk {
		approvalTypes := []string{
			string(types.AskTypeTool),
			string(types.AskTypeCommand),
			string(types.AskTypeBrowserActionLaunch),
			string(types.AskTypeUseMcpServer),
		}

		for _, approvalType := range approvalTypes {
			if lastMessage.Ask == approvalType {
				return true, lastMessage, nil
			}
		}
	}

	return false, nil, nil
}

// SendMessage sends a followup message to the current task
func (m *Manager) SendMessage(ctx context.Context, message string, images, files []string, approve string) error {
	responseType := "messageResponse"

	if approve == "true" {
		responseType = "yesButtonClicked"
	}

	if approve == "false" {
		responseType = "noButtonClicked"
	}

	if global.Config.Verbose {
		m.renderer.RenderDebug("Sending message: %s", message)
		if len(files) > 0 {
			m.renderer.RenderDebug("Files: %v", files)
		}
		if len(images) > 0 {
			m.renderer.RenderDebug("Images: %v", images)
		}
	}

	// Send the followup message using AskResponse
	req := &cline.AskResponseRequest{
		ResponseType: responseType,
		Text:         message,
		Images:       images,
		Files:        files,
	}

	_, err := m.client.Task.AskResponse(ctx, req)
	if err != nil {
		return fmt.Errorf("failed to send message: %w", err)
	}

	return nil
}

// SetMode sets the Plan/Act mode for the current Cline instance and optionally sends message
func (m *Manager) SetMode(ctx context.Context, mode string, message *string, images, files []string) error {
	if mode != "act" && mode != "plan" {
		return fmt.Errorf("invalid mode '%s': must be 'act' or 'plan'", mode)
	}

	var protoMode cline.PlanActMode
	if mode == "plan" {
		protoMode = cline.PlanActMode_PLAN
	} else {
		protoMode = cline.PlanActMode_ACT
	}

	req := &cline.TogglePlanActModeRequest{
		Metadata: &cline.Metadata{},
		Mode:     protoMode,
	}

	if message != nil {
		req.ChatContent = &cline.ChatContent{
			Message: message,
			Images:  images,
			Files:   files,
		}
	}

	_, err := m.client.State.TogglePlanActModeProto(ctx, req)
	if err != nil {
		return fmt.Errorf("failed to set mode to '%s': %w", mode, err)
	}

	return nil
}

// SetModeAndSendMessage sets the mode and sends a message in one operation
// Handles task restoration internally if the mode switch cancels the current task
func (m *Manager) SetModeAndSendMessage(ctx context.Context, mode, message string, images, files []string) error {
	if mode != "act" && mode != "plan" {
		return fmt.Errorf("invalid mode '%s': must be 'act' or 'plan'", mode)
	}

	taskId, err := m.getCurrentTaskId(ctx)
	if err != nil {
		return fmt.Errorf("failed to get current task ID: %w", err)
	}
	fmt.Printf("Current task ID: %s\n", taskId)

	var protoMode cline.PlanActMode
	if mode == "plan" {
		protoMode = cline.PlanActMode_PLAN
	} else {
		protoMode = cline.PlanActMode_ACT
	}

	req := &cline.TogglePlanActModeRequest{
		Metadata: &cline.Metadata{},
		Mode:     protoMode,
		ChatContent: &cline.ChatContent{
			Message: &message,
			Images:  images,
			Files:   files,
		},
	}

	result, err := m.client.State.TogglePlanActModeProto(ctx, req)
	if err != nil {
		return fmt.Errorf("failed to set mode to '%s': %w", mode, err)
	}

	taskPreserved := result.Value

	if taskPreserved {
		fmt.Printf("Message sent as part of mode change\n")
		return nil
	} else {
		if message != "" || len(images) > 0 || len(files) > 0 {
			fmt.Printf("Task was cancelled, restoring task ID: %s\n", taskId)

			err = m.ReinitExistingTaskFromId(ctx, taskId)
			if err != nil {
				return fmt.Errorf("Failed to restore task: %w", err)
			}
			fmt.Printf("Task restored successfully\n")

			// Hardcoded sleep should be replaced with a way to fetch whether task is ready algorithmically
			time.Sleep(1 * time.Second)

			err = m.SendMessage(ctx, message, images, files, "")
			if err != nil {
				return fmt.Errorf("Failed to send message: %w", err)
			}
			fmt.Printf("Message sent to restored task\n")
		}
	}

	return nil
}

// getCurrentTaskId extracts the current task ID from the server state
func (m *Manager) getCurrentTaskId(ctx context.Context) (string, error) {
	// Get the latest state
	state, err := m.client.State.GetLatestState(ctx, &cline.EmptyRequest{})
	if err != nil {
		return "", fmt.Errorf("failed to get state: %w", err)
	}

	// Parse the server state JSON
	var stateData types.ExtensionState
	if err := json.Unmarshal([]byte(state.StateJson), &stateData); err != nil {
		return "", fmt.Errorf("failed to parse state JSON: %w", err)
	}

	// Extract current task ID
	if stateData.CurrentTaskItem != nil && stateData.CurrentTaskItem.Id != "" {
		return stateData.CurrentTaskItem.Id, nil
	}

	return "", fmt.Errorf("no current task found in state")
}

// ReinitExistingTaskFromId reinitializes an existing task from the given task ID
func (m *Manager) ReinitExistingTaskFromId(ctx context.Context, taskId string) error {
	req := &cline.StringRequest{Value: taskId}
	resp, err := m.client.Task.ShowTaskWithId(ctx, req)
	if err != nil {
		return fmt.Errorf("Failed to reinitialize task %s: %w", taskId, err)
	}

	fmt.Printf("Successfully reinitialized task: %s (ID: %s)\n", taskId, resp.Id)

	return nil
}

// ResumeTask resumes an existing task by ID
func (m *Manager) ResumeTask(ctx context.Context, taskID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if global.Config.Verbose {
		m.renderer.RenderDebug("Resuming task: %s", taskID)
	}

	// This call handles cancellation of any active task
	if err := m.ReinitExistingTaskFromId(ctx, taskID); err != nil {
		return fmt.Errorf("failed to resume task %s: %w", taskID, err)
	}

	fmt.Printf("Task %s resumed successfully\n", taskID)

	return nil
}

// RestoreCheckpoint restores the task to a specific checkpoint
func (m *Manager) RestoreCheckpoint(ctx context.Context, checkpointID int64, restoreType string) error {
	if global.Config.Verbose {
		m.renderer.RenderDebug("Restoring checkpoint: %d (type: %s)", checkpointID, restoreType)
	}

	// Create the checkpoint restore request
	req := &cline.CheckpointRestoreRequest{
		Metadata:    &cline.Metadata{},
		Number:      checkpointID,
		RestoreType: restoreType,
	}

	_, err := m.client.Checkpoints.CheckpointRestore(ctx, req)
	if err != nil {
		return fmt.Errorf("failed to restore checkpoint %d: %w", checkpointID, err)
	}

	return nil
}

// CancelTask cancels the current task
func (m *Manager) CancelTask(ctx context.Context) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	_, err := m.client.Task.CancelTask(ctx, &cline.EmptyRequest{})
	if err != nil {
		return fmt.Errorf("failed to cancel task: %w", err)
	}

	return nil
}

// ShowConversation displays the current conversation
func (m *Manager) ShowConversation(ctx context.Context) error {
	// Check if there's an active task before showing conversation
	err := m.CheckSendEnabled(ctx)
	if err != nil {
		// Handle specific error cases
		if errors.Is(err, ErrNoActiveTask) {
			fmt.Println("No active task found. Use 'cline task new' to create a task first.")
			return nil
		}
		// For other errors (like task busy), we can still show the conversation
	}

	// Disable streaming mode for static view
	m.mu.Lock()
	m.isStreamingMode = false
	m.mu.Unlock()

	m.mu.RLock()
	defer m.mu.RUnlock()

	// Get the latest state which contains messages
	state, err := m.client.State.GetLatestState(ctx, &cline.EmptyRequest{})
	if err != nil {
		return fmt.Errorf("failed to get state: %w", err)
	}

	// Parse the state JSON to extract messages
	messages, err := m.extractMessagesFromState(state.StateJson)
	if err != nil {
		return fmt.Errorf("failed to extract messages: %w", err)
	}

	if len(messages) == 0 {
		fmt.Println("No conversation history found.")
		return nil
	}

	for i, msg := range messages {
		if msg.Partial {
			continue
		}
		m.displayMessage(msg, false, false, i)
	}

	return nil
}

func (m *Manager) FollowConversation(ctx context.Context, instanceAddress string, interactive bool) error {
	// Enable streaming mode
	m.mu.Lock()
	m.isStreamingMode = true
	m.isInteractive = interactive
	m.mu.Unlock()

	if global.Config.OutputFormat != "plain" {
		markdown := fmt.Sprintf("*Using instance: %s*\n*Press Ctrl+C to exit*", instanceAddress)
		rendered := m.renderer.RenderMarkdown(markdown)
		fmt.Printf("%s", rendered)
	} else {
		fmt.Printf("Using instance: %s\n", instanceAddress)
		if interactive {
			fmt.Println("Following task conversation in interactive mode... (Press Ctrl+C to exit)")
		} else {
			fmt.Println("Following task conversation... (Press Ctrl+C to exit)")
		}
	}

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	// Create stream coordinator
	coordinator := NewStreamCoordinator()

	// Load history first
	totalMessageCount, err := m.loadAndDisplayRecentHistory(ctx)
	if err != nil {
		m.renderer.RenderDebug("Warning: Failed to load conversation history: %v", err)
		totalMessageCount = 0
	}
	coordinator.SetConversationTurnStartIndex(totalMessageCount)

	// Start both streams concurrently
	errChan := make(chan error, 3)

	if global.Config.OutputFormat == "json" {
		go m.handleStateStream(ctx, coordinator, errChan, nil)
	} else {
		go m.handleStateStream(ctx, coordinator, errChan, nil)
		go m.handlePartialMessageStream(ctx, coordinator, errChan)

		// Start input handler if interactive mode is enabled
		if interactive {
			inputHandler := NewInputHandler(m, coordinator, cancel)
			go inputHandler.Start(ctx, errChan)
		}
	}

	// Handle Ctrl+C signals
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		defer signal.Stop(sigChan) // Clean up signal handler when goroutine exits
		for {
			select {
			case <-ctx.Done():
				return
			case <-sigChan:
				if interactive {
					// Interactive mode (task chat)
					// Check if input is currently being shown
					if coordinator.IsInputAllowed() {
						// Input form is showing - huh will handle the signal via ErrUserAborted
						// Do nothing here, let the input handler deal with it
					} else {
						// Streaming mode - cancel the task and stay in follow mode
						m.renderer.RenderTaskCancelled()
						if err := m.CancelTask(context.Background()); err != nil {
							fmt.Printf("Error cancelling task: %v\n", err)
						}
						// Don't cancel main context - stay in follow mode
					}
				} else {
					// Non-interactive mode (task view --follow)
					// Just exit without canceling the task
					cancel()
					return // Exit the loop after canceling in non-interactive mode
				}
			}
		}
	}()

	// Wait for either stream to error or context cancellation
	select {
	case <-ctx.Done():
		// Check if this was a user-initiated cancellation (Ctrl+C)
		// Return nil for clean exit instead of context.Canceled error
		if ctx.Err() == context.Canceled {
			return nil
		}
		return ctx.Err()
	case err := <-errChan:
		cancel()
		return err
	}
}

// FollowConversationUntilCompletion streams conversation updates until task completion
func (m *Manager) FollowConversationUntilCompletion(ctx context.Context, opts FollowOptions) error {
	// Check if there's an active task before entering follow mode
	// Skip this check if we just created a task (to avoid race condition where task isn't active yet)
	if !opts.SkipActiveTaskCheck {
		err := m.CheckSendEnabled(ctx)
		if err != nil {
			if errors.Is(err, ErrNoActiveTask) {
				fmt.Println("No task is currently running.")
				return nil
			}
			// For other errors (like task busy), we can still enter follow mode
			// as the user may want to observe the task
		}
	}

	// Enable streaming mode
	m.mu.Lock()
	m.isStreamingMode = true
	m.mu.Unlock()

	fmt.Println("Following task conversation until completion... (Press Ctrl+C to exit)")

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	// Create stream coordinator
	coordinator := NewStreamCoordinator()

	// Load history first
	totalMessageCount, err := m.loadAndDisplayRecentHistory(ctx)
	if err != nil {
		m.renderer.RenderDebug("Warning: Failed to load conversation history: %v", err)
		totalMessageCount = 0
	}
	coordinator.SetConversationTurnStartIndex(totalMessageCount)

	// Start both streams concurrently
	errChan := make(chan error, 2)
	completionChan := make(chan bool, 1)

	if global.Config.OutputFormat == "json" {
		go m.handleStateStream(ctx, coordinator, errChan, completionChan)
	} else {
		go m.handleStateStream(ctx, coordinator, errChan, completionChan)
		go m.handlePartialMessageStream(ctx, coordinator, errChan)
	}

	// Wait for completion, error, or context cancellation
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-completionChan:
		cancel()
		return nil
	case err := <-errChan:
		cancel()
		return err
	}
}

// handleStateStream handles the SubscribeToState stream
func (m *Manager) handleStateStream(ctx context.Context, coordinator *StreamCoordinator, errChan chan error, completionChan chan bool) {
	stateStream, err := m.client.State.SubscribeToState(ctx, &cline.EmptyRequest{})
	if err != nil {
		errChan <- fmt.Errorf("failed to subscribe to state: %w", err)
		return
	}

	for {
		select {
		case <-ctx.Done():
			return
		default:
			stateUpdate, err := stateStream.Recv()
			if err != nil {
				m.renderer.RenderDebug("State stream receive error: %v", err)
				errChan <- fmt.Errorf("failed to receive state update: %w", err)
				return
			}

			var pErr error

			if global.Config.OutputFormat == "json" {
				pErr = m.processStateUpdateJsonMode(stateUpdate, coordinator, completionChan)
			} else {
				pErr = m.processStateUpdate(stateUpdate, coordinator, completionChan)
			}

			if pErr != nil {
				m.renderer.RenderDebug("State processing error: %v", pErr)
			}
		}
	}
}

func (m *Manager) processStateUpdateJsonMode(stateUpdate *cline.State, coordinator *StreamCoordinator, completionChan chan bool) error {
	messages, err := m.extractMessagesFromState(stateUpdate.StateJson)
	if err != nil {
		return err
	}

	// Process messages from current conversation turn onwards
	startIndex := coordinator.GetConversationTurnStartIndex()

	var foundCompletion bool
	var displayedUsage bool

	for i := startIndex; i < len(messages); i++ {
		msg := messages[i]

		if global.Config.Verbose {
			m.renderer.RenderDebug("State message %d: type=%s, say=%s", i, msg.Type, msg.Say)
		}

		// Exit after we've seen a task completion & printed out the usage info
		if msg.Say == string(types.SayTypeCompletionResult) {
			foundCompletion = true
		}

		// Determine if message is ready to be displayed now
		shouldDisplay := true

		switch {
		case msg.Say == string(types.SayTypeAPIReqStarted):
			shouldDisplay = false
			apiInfo := types.APIRequestInfo{Cost: -1}
			if err := json.Unmarshal([]byte(msg.Text), &apiInfo); err == nil && apiInfo.Cost >= 0 {
				shouldDisplay = true
				displayedUsage = true
			}
		}

		// Skip if message is partial, except for a specific edge case
		if msg.Partial {
			// Exception: display if type=say, text="", say="text"
			if msg.IsSay() && msg.Text == "" && msg.Say == string(types.SayTypeText) {
				shouldDisplay = true
			} else {
				shouldDisplay = false
			}
		}

		// Display valid messages, exit as soon as we hit a non-valid message
		if shouldDisplay {
			coordinator.CompleteTurn(i + 1) // Mark the message as complete as soon as we print it
			m.displayMessage(msg, false, false, i)
		} else {
			break
		}
	}

	// We only want to exit after we've displayed the usage, for the case of seeing completion result
	if completionChan != nil && foundCompletion && displayedUsage {
		completionChan <- true
	}

	return nil
}

// processStateUpdate processes state updates and supports logic for handling task competion markers
func (m *Manager) processStateUpdate(stateUpdate *cline.State, coordinator *StreamCoordinator, completionChan chan bool) error {
	// Update current mode from state
	m.updateMode(stateUpdate.StateJson)

	messages, err := m.extractMessagesFromState(stateUpdate.StateJson)
	if err != nil {
		return err
	}

	// Process messages from current conversation turn onwards
	startIndex := coordinator.GetConversationTurnStartIndex()

	var foundCompletion bool
	var displayedUsage bool

	for i := startIndex; i < len(messages); i++ {
		msg := messages[i]

		if global.Config.Verbose {
			m.renderer.RenderDebug("State message %d: type=%s, say=%s", i, msg.Type, msg.Say)
		}

		// Exit after we've seen a task completion & printed out the usage info
		if msg.Say == string(types.SayTypeCompletionResult) {
			foundCompletion = true
		}

		switch {
		case msg.Say == string(types.SayTypeUserFeedback):
			msgKey := fmt.Sprintf("%d", msg.Timestamp)
			if !coordinator.IsProcessedInCurrentTurn(msgKey) {
				fmt.Println()
				m.displayMessage(msg, false, false, i)
				coordinator.MarkProcessedInCurrentTurn(msgKey)
			}

		case msg.Say == string(types.SayTypeCommand):
			msgKey := fmt.Sprintf("%d", msg.Timestamp)
			if !coordinator.IsProcessedInCurrentTurn(msgKey) {
				fmt.Println()
				m.displayMessage(msg, false, false, i)

				coordinator.MarkProcessedInCurrentTurn(msgKey)
			}

		case msg.Say == string(types.SayTypeCommandOutput):
			msgKey := fmt.Sprintf("%d", msg.Timestamp)
			if !coordinator.IsProcessedInCurrentTurn(msgKey) {
				m.displayMessage(msg, false, false, i)

				coordinator.MarkProcessedInCurrentTurn(msgKey)
			}

		case msg.Say == string(types.SayTypeBrowserActionLaunch):
			msgKey := fmt.Sprintf("%d", msg.Timestamp)
			if !coordinator.IsProcessedInCurrentTurn(msgKey) {
				fmt.Println()
				m.displayMessage(msg, false, false, i)

				coordinator.MarkProcessedInCurrentTurn(msgKey)
			}

		case msg.Say == string(types.SayTypeMcpServerRequestStarted):
			msgKey := fmt.Sprintf("%d", msg.Timestamp)
			if !coordinator.IsProcessedInCurrentTurn(msgKey) {
				fmt.Println()
				m.displayMessage(msg, false, false, i)

				coordinator.MarkProcessedInCurrentTurn(msgKey)
			}

		case msg.Say == string(types.SayTypeMcpServerResponse):
			msgKey := fmt.Sprintf("%d", msg.Timestamp)
			if !coordinator.IsProcessedInCurrentTurn(msgKey) {
				fmt.Println()
				m.displayMessage(msg, false, false, i)

				coordinator.MarkProcessedInCurrentTurn(msgKey)
			}

		case msg.Say == string(types.SayTypeMcpNotification):
			msgKey := fmt.Sprintf("%d", msg.Timestamp)
			if !coordinator.IsProcessedInCurrentTurn(msgKey) {
				fmt.Println()
				m.displayMessage(msg, false, false, i)

				coordinator.MarkProcessedInCurrentTurn(msgKey)
			}

		case msg.Say == string(types.SayTypeUseMcpServer):
			msgKey := fmt.Sprintf("%d", msg.Timestamp)
			if !coordinator.IsProcessedInCurrentTurn(msgKey) {
				fmt.Println()
				m.displayMessage(msg, false, false, i)

				coordinator.MarkProcessedInCurrentTurn(msgKey)
			}

		case msg.Say == string(types.SayTypeCheckpointCreated):
			msgKey := fmt.Sprintf("%d", msg.Timestamp)
			if !coordinator.IsProcessedInCurrentTurn(msgKey) {
				fmt.Println()
				m.displayMessage(msg, false, false, i)

				coordinator.MarkProcessedInCurrentTurn(msgKey)
			}

		case msg.Say == string(types.SayTypeAPIReqStarted):
			msgKey := fmt.Sprintf("%d", msg.Timestamp)
			apiInfo := types.APIRequestInfo{Cost: -1}
			if err := json.Unmarshal([]byte(msg.Text), &apiInfo); err == nil && apiInfo.Cost >= 0 {
				if !coordinator.IsProcessedInCurrentTurn(msgKey) {
					fmt.Println() // adds a separator between cline message and usage message
					m.displayMessage(msg, false, false, i)

					coordinator.MarkProcessedInCurrentTurn(msgKey)
					coordinator.CompleteTurn(len(messages))
					displayedUsage = true
				}
			}

		case msg.Say == string(types.SayTypeCompletionResult):
			msgKey := fmt.Sprintf("%d", msg.Timestamp)
			if !msg.Partial && !coordinator.IsProcessedInCurrentTurn(msgKey) {
				fmt.Println()
				m.displayMessage(msg, false, false, i)
				coordinator.MarkProcessedInCurrentTurn(msgKey)
			}

		case msg.Ask == string(types.AskTypeCommandOutput):
			msgKey := fmt.Sprintf("%d", msg.Timestamp)
			if !coordinator.IsProcessedInCurrentTurn(msgKey) {
				m.displayMessage(msg, false, false, i)

				coordinator.MarkProcessedInCurrentTurn(msgKey)
			}

		case msg.Ask == string(types.AskTypePlanModeRespond):
			msgKey := fmt.Sprintf("%d", msg.Timestamp)
			// Non-streaming mode: render normally when message is complete
			if !msg.Partial && !coordinator.IsProcessedInCurrentTurn(msgKey) {
				m.displayMessage(msg, false, false, i)

				coordinator.MarkProcessedInCurrentTurn(msgKey)
			}

		case msg.Type == types.MessageTypeAsk:
			msgKey := fmt.Sprintf("%d", msg.Timestamp)
			// Only render if not already handled by partial stream
			if !msg.Partial && !coordinator.IsProcessedInCurrentTurn(msgKey) {
				m.displayMessage(msg, false, false, i)
				coordinator.MarkProcessedInCurrentTurn(msgKey)
			}
		}
	}

	// We only want to exit after we've displayed the usage, for the case of seeing completion result
	if completionChan != nil && foundCompletion && displayedUsage {
		completionChan <- true
	}

	return nil
}

// handlePartialMessageStream handles the SubscribeToPartialMessage stream for streaming assistant text
func (m *Manager) handlePartialMessageStream(ctx context.Context, coordinator *StreamCoordinator, errChan chan error) {
	partialStream, err := m.client.Ui.SubscribeToPartialMessage(ctx, &cline.EmptyRequest{})
	if err != nil {
		errChan <- fmt.Errorf("failed to subscribe to partial messages: %w", err)
		return
	}

	defer func() {
		m.streamingDisplay.FreezeActiveSegment()
	}()

	for {
		select {
		case <-ctx.Done():
			return
		default:
			protoMsg, err := partialStream.Recv()
			if err != nil {
				m.renderer.RenderDebug("Partial stream receive error: %v", err)
				errChan <- fmt.Errorf("failed to receive partial message: %w", err)
				return
			}

			// Convert proto message to our Message struct
			msg := types.ConvertProtoToMessage(protoMsg)

			// Debug: Log received message (always show for debugging)
			m.renderer.RenderDebug("Received streaming message: type=%s, partial=%v, text_len=%d",
				msg.Type, msg.Partial, len(msg.Text))

			// Handle the message with streaming support for de-dupping
			if err := m.handleStreamingMessage(msg, coordinator); err != nil {
				m.renderer.RenderDebug("Error handling streaming message: %v", err)
			}
		}
	}
}

// handleStreamingMessage handles a streaming message
func (m *Manager) handleStreamingMessage(msg *types.ClineMessage, coordinator *StreamCoordinator) error {
	// Debug: Always log what we're processing
	m.renderer.RenderDebug("Processing message: timestamp=%d, partial=%v, type=%s, text_preview=%s",
		msg.Timestamp, msg.Partial, msg.Type, m.truncateText(msg.Text, 50))

	// Use streaming display which handles deduplication internally
	if err := m.streamingDisplay.HandlePartialMessage(msg); err != nil {
		m.renderer.RenderDebug("Streaming display failed, using fallback: %v", err)
		// Fallback to regular display
		m.displayMessage(msg, true, false, -1)
	}

	return nil
}

// truncateText truncates text for debug display
func (m *Manager) truncateText(text string, maxLen int) string {
	if len(text) <= maxLen {
		return text
	}
	return text[:maxLen] + "..."
}

// displayMessage displays a single message using the handler system
func (m *Manager) displayMessage(msg *types.ClineMessage, isLast, isPartial bool, messageIndex int) error {
	if global.Config.OutputFormat == "json" {
		return m.outputMessageAsJSON(msg)
	} else {
		m.mu.RLock()
		isStreaming := m.isStreamingMode
		isInteractive := m.isInteractive
		m.mu.RUnlock()

		dc := &handlers.DisplayContext{
			State:           m.state,
			Renderer:        m.renderer,
			ToolRenderer:    m.toolRenderer,
			SystemRenderer:  m.systemRenderer,
			IsLast:          isLast,
			IsPartial:       isPartial,
			MessageIndex:    messageIndex,
			IsStreamingMode: isStreaming,
			IsInteractive:   isInteractive,
		}

		return m.handlerRegistry.Handle(msg, dc)
	}
}

// outputMessageAsJSON prints a single cline message as json
func (m *Manager) outputMessageAsJSON(msg *types.ClineMessage) error {
	jsonBytes, err := json.MarshalIndent(msg, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal message as JSON: %w", err)
	}

	fmt.Println(string(jsonBytes))
	return nil
}

// loadAndDisplayRecentHistory loads and displays recent conversation history and returns the total number of existing messages
func (m *Manager) loadAndDisplayRecentHistory(ctx context.Context) (int, error) {
	// Get the latest state which contains messages
	state, err := m.client.State.GetLatestState(ctx, &cline.EmptyRequest{})
	if err != nil {
		return 0, fmt.Errorf("failed to get state: %w", err)
	}

	// Parse the state JSON to extract messages
	messages, err := m.extractMessagesFromState(state.StateJson)
	if err != nil {
		return 0, fmt.Errorf("failed to extract messages: %w", err)
	}

	if len(messages) == 0 {
		fmt.Println("No conversation history found.")
		return 0, nil
	}

	// Show only the last 100 messages by default
	const maxHistoryMessages = 100
	totalMessages := len(messages)
	startIndex := 0

	if totalMessages > maxHistoryMessages {
		startIndex = totalMessages - maxHistoryMessages
		if global.Config.OutputFormat != "plain" {
			markdown := fmt.Sprintf("*Conversation history (%d of %d messages)*", maxHistoryMessages, totalMessages)
			rendered := m.renderer.RenderMarkdown(markdown)
			fmt.Printf("\n%s\n\n", rendered)
		} else {
			fmt.Printf("--- Conversation history (%d of %d messages) ---\n", maxHistoryMessages, totalMessages)
		}
	} else {
		if global.Config.OutputFormat != "plain" {
			markdown := fmt.Sprintf("*Conversation history (%d messages)*", totalMessages)
			rendered := m.renderer.RenderMarkdown(markdown)
			fmt.Printf("\n%s\n\n", rendered)
		} else {
			fmt.Printf("--- Conversation history (%d messages) ---\n", totalMessages)
		}
	}

	for i := startIndex; i < len(messages); i++ {
		msg := messages[i]

		if msg.Partial {
			continue
		}

		m.displayMessage(msg, false, false, i)
	}

	// Return the total number of messages in the conversation
	return totalMessages, nil
}

// extractMessagesFromState parses the state JSON and extracts messages
func (m *Manager) extractMessagesFromState(stateJson string) ([]*types.ClineMessage, error) {
	return types.ExtractMessagesFromStateJSON(stateJson)
}

// GetState returns the current conversation state
func (m *Manager) GetState() *types.ConversationState {
	return m.state
}

// GetClient returns the underlying ClineClient for direct gRPC calls
func (m *Manager) GetClient() *client.ClineClient {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.client
}

// GetRenderer returns the renderer for formatting output
func (m *Manager) GetRenderer() *display.Renderer {
	return m.renderer
}

// GetCurrentMode returns the current plan/act mode
func (m *Manager) GetCurrentMode() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.currentMode
}

// GetSlashRegistry returns the slash command registry
func (m *Manager) GetSlashRegistry() *slash.Registry {
	return m.slashRegistry
}

// extractModeFromState extracts the current mode from state JSON
func (m *Manager) extractModeFromState(stateJson string) string {
	var rawState map[string]interface{}
	if err := json.Unmarshal([]byte(stateJson), &rawState); err != nil {
		return m.currentMode // Return current mode if parsing fails
	}

	if mode, ok := rawState["mode"].(string); ok {
		return mode
	}

	return m.currentMode // Return current mode if not found in state
}

// updateMode updates the current mode from state
func (m *Manager) updateMode(stateJson string) {
	mode := m.extractModeFromState(stateJson)
	m.mu.Lock()
	m.currentMode = mode
	m.mu.Unlock()
}

// UpdateTaskAutoApprovalAction enables a specific auto-approval action for the current task
func (m *Manager) UpdateTaskAutoApprovalAction(ctx context.Context, actionKey string) error {
	boolPtr := func(b bool) *bool { return &b }

	settings := &cline.Settings{
		AutoApprovalSettings: &cline.AutoApprovalSettings{
			Actions: &cline.AutoApprovalActions{},
		},
	}

	// Set the specific action to true based on actionKey
	truePtr := boolPtr(true)

	switch actionKey {
	case "read_files":
		settings.AutoApprovalSettings.Actions.ReadFiles = truePtr
	case "edit_files":
		settings.AutoApprovalSettings.Actions.EditFiles = truePtr
	case "execute_all_commands":
		settings.AutoApprovalSettings.Actions.ExecuteAllCommands = truePtr
	case "use_browser":
		settings.AutoApprovalSettings.Actions.UseBrowser = truePtr
	case "use_mcp":
		settings.AutoApprovalSettings.Actions.UseMcp = truePtr
	default:
		return fmt.Errorf("unknown auto-approval action: %s", actionKey)
	}

	_, err := m.client.State.UpdateTaskSettings(ctx, &cline.UpdateTaskSettingsRequest{
		Settings: settings,
	})
	if err != nil {
		return fmt.Errorf("failed to update task settings: %w", err)
	}

	return nil
}

// Cleanup cleans up resources
func (m *Manager) Cleanup() {
	// Clean up streaming display resources if needed
	if m.streamingDisplay != nil {
		m.streamingDisplay.Cleanup()
	}
}
