package handlers

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/cline/cli/pkg/cli/clerror"
	"github.com/cline/cli/pkg/cli/output"
	"github.com/cline/cli/pkg/cli/types"
)

// SayHandler handles SAY type messages
type SayHandler struct {
	*BaseHandler
}

// NewSayHandler creates a new SAY handler
func NewSayHandler() *SayHandler {
	return &SayHandler{
		BaseHandler: NewBaseHandler("say", PriorityNormal),
	}
}

// CanHandle returns true if this is a SAY message
func (h *SayHandler) CanHandle(msg *types.ClineMessage) bool {
	return msg.IsSay()
}

// Handle processes SAY messages
func (h *SayHandler) Handle(msg *types.ClineMessage, dc *DisplayContext) error {
	timestamp := msg.GetTimestamp()

	switch msg.Say {
	case string(types.SayTypeTask):
		return h.handleTask(msg, dc)
	case string(types.SayTypeError):
		return h.handleError(msg, dc)
	case string(types.SayTypeAPIReqStarted):
		return h.handleAPIReqStarted(msg, dc)
	case string(types.SayTypeAPIReqFinished):
		return h.handleAPIReqFinished(msg, dc)
	case string(types.SayTypeText):
		return h.handleText(msg, dc)
	case string(types.SayTypeReasoning):
		return h.handleReasoning(msg, dc)
	case string(types.SayTypeCompletionResult):
		return h.handleCompletionResult(msg, dc)
	case string(types.SayTypeUserFeedback):
		return h.handleUserFeedback(msg, dc)
	case string(types.SayTypeUserFeedbackDiff):
		return h.handleUserFeedbackDiff(msg, dc)
	case string(types.SayTypeAPIReqRetried):
		return h.handleAPIReqRetried(msg, dc)
	case string(types.SayTypeErrorRetry):
		return h.handleErrorRetry(msg, dc)
	case string(types.SayTypeCommand):
		return h.handleCommand(msg, dc)
	case string(types.SayTypeCommandOutput):
		return h.handleCommandOutput(msg, dc)
	case string(types.SayTypeTool):
		return h.handleTool(msg, dc)
	case string(types.SayTypeShellIntegrationWarning):
		return h.handleShellIntegrationWarning(msg, dc)
	case string(types.SayTypeBrowserActionLaunch):
		return h.handleBrowserActionLaunch(msg, dc)
	case string(types.SayTypeBrowserAction):
		return h.handleBrowserAction(msg, dc)
	case string(types.SayTypeBrowserActionResult):
		return h.handleBrowserActionResult(msg, dc)
	case string(types.SayTypeMcpServerRequestStarted):
		return h.handleMcpServerRequestStarted(msg, dc)
	case string(types.SayTypeMcpServerResponse):
		return h.handleMcpServerResponse(msg, dc)
	case string(types.SayTypeMcpNotification):
		return h.handleMcpNotification(msg, dc)
	case string(types.SayTypeUseMcpServer):
		return h.handleUseMcpServer(msg, dc)
	case string(types.SayTypeDiffError):
		return h.handleDiffError(msg, dc)
	case string(types.SayTypeDeletedAPIReqs):
		return h.handleDeletedAPIReqs(msg, dc)
	case string(types.SayTypeClineignoreError):
		return h.handleClineignoreError(msg, dc)
	case string(types.SayTypeCheckpointCreated):
		return h.handleCheckpointCreated(msg, dc, timestamp)
	case string(types.SayTypeLoadMcpDocumentation):
		return h.handleLoadMcpDocumentation(msg, dc)
	case string(types.SayTypeInfo):
		return h.handleInfo(msg, dc)
	case string(types.SayTypeTaskProgress):
		return h.handleTaskProgress(msg, dc)
	case string(types.SayTypeHookStatus):
		return h.handleHookStatus(msg, dc)
	case string(types.SayTypeHookOutputStream):
		return h.handleHookOutputStream(msg, dc)
	default:
		return h.handleDefault(msg, dc)
	}
}

// handleTask handles task messages
func (h *SayHandler) handleTask(msg *types.ClineMessage, dc *DisplayContext) error {
	return nil
}

// handleError handles error messages
func (h *SayHandler) handleError(msg *types.ClineMessage, dc *DisplayContext) error {
	return dc.Renderer.RenderMessage("ERROR", msg.Text, true)
}

// handleAPIReqStarted handles API request started messages
func (h *SayHandler) handleAPIReqStarted(msg *types.ClineMessage, dc *DisplayContext) error {
	// Parse API request info
	apiInfo := types.APIRequestInfo{Cost: -1}
	if err := json.Unmarshal([]byte(msg.Text), &apiInfo); err != nil {
		return dc.Renderer.RenderMessage("API INFO", msg.Text, true)
	}

	// Check for streaming failed message with error details
	if apiInfo.StreamingFailedMessage != "" {
		clineErr, _ := clerror.ParseClineError(apiInfo.StreamingFailedMessage)
		if clineErr != nil {
			return h.renderClineError(clineErr, dc)
		}
	}

	// Handle different API request states
	if apiInfo.CancelReason != "" {
		if apiInfo.CancelReason == "user_cancelled" {
			return dc.Renderer.RenderMessage("API INFO", "Request Cancelled", true)
		} else if apiInfo.CancelReason == "retries_exhausted" {
			return dc.Renderer.RenderMessage("API INFO", "Request Failed (Retries Exhausted)", true)
		}
		return dc.Renderer.RenderMessage("API INFO", "Streaming Failed", true)
	}

	if apiInfo.Cost >= 0 {
		return dc.Renderer.RenderAPI("request completed", &apiInfo)
	}

	// Check for retry status
	if apiInfo.RetryStatus != nil {
		return dc.Renderer.RenderRetry(
			apiInfo.RetryStatus.Attempt,
			apiInfo.RetryStatus.MaxAttempts,
			apiInfo.RetryStatus.DelaySec)
	}

	return dc.Renderer.RenderAPI("processing request", &apiInfo)
}

// renderClineError renders a ClineError with appropriate formatting based on type
func (h *SayHandler) renderClineError(err *clerror.ClineError, dc *DisplayContext) error {
	if dc.SystemRenderer == nil {
		return dc.Renderer.RenderMessage("ERROR", err.Message, true)
	}

	switch err.GetErrorType() {
	case clerror.ErrorTypeBalance:
		return dc.SystemRenderer.RenderBalanceError(err)
	case clerror.ErrorTypeAuth:
		return dc.SystemRenderer.RenderAuthError(err)
	case clerror.ErrorTypeRateLimit:
		return dc.SystemRenderer.RenderRateLimitError(err)
	default:
		return dc.SystemRenderer.RenderAPIError(err)
	}
}

// handleAPIReqFinished handles API request finished messages
func (h *SayHandler) handleAPIReqFinished(msg *types.ClineMessage, dc *DisplayContext) error {
	// This message type is typically not displayed as it's handled by the started message
	return nil
}

// handleText handles regular text messages
func (h *SayHandler) handleText(msg *types.ClineMessage, dc *DisplayContext) error {
	if msg.Text == "" {
		return nil
	}

	// Special case for the user's task input
	if dc.MessageIndex == 0 {
		markdown := formatUserMessage(msg.Text)
		rendered := dc.Renderer.RenderMarkdown(markdown)
		output.Printf("%s", rendered)
		output.Printf("\n")
		return nil
	}

	// Regular Cline text response
	var rendered string
	if dc.IsStreamingMode {
		// In streaming mode, header already shown by partial stream
		rendered = dc.Renderer.RenderMarkdown(msg.Text)
		output.Printf("%s\n", rendered)
	} else {
		// In non-streaming mode, render header + body together
		markdown := fmt.Sprintf("### Cline responds\n\n%s", msg.Text)
		rendered = dc.Renderer.RenderMarkdown(markdown)
		output.Printf("\n%s\n", rendered)
	}
	return nil
}

// handleReasoning handles reasoning messages
func (h *SayHandler) handleReasoning(msg *types.ClineMessage, dc *DisplayContext) error {
	if msg.Text == "" {
		return nil
	}

	var rendered string
	if dc.IsStreamingMode {
		// In streaming mode, header already shown by partial stream
		rendered = dc.Renderer.RenderMarkdown(msg.Text)
		output.Printf("%s\n", rendered)
	} else {
		// In non-streaming mode, render header + body together
		markdown := fmt.Sprintf("### Cline is thinking\n\n%s", msg.Text)
		rendered = dc.Renderer.RenderMarkdown(markdown)
		output.Printf("\n%s\n", rendered)
	}
	return nil
}

func (h *SayHandler) handleCompletionResult(msg *types.ClineMessage, dc *DisplayContext) error {
	text := msg.Text

	if strings.HasSuffix(text, "HAS_CHANGES") {
		text = strings.TrimSuffix(text, "HAS_CHANGES")
	}

	var rendered string
	if dc.IsStreamingMode {
		// In streaming mode, header already shown by partial stream
		rendered = dc.Renderer.RenderMarkdown(text)
		output.Printf("%s\n", rendered)
	} else {
		// In non-streaming mode, render header + body together
		markdown := fmt.Sprintf("### Task completed\n\n%s", text)
		rendered = dc.Renderer.RenderMarkdown(markdown)
		output.Printf("\n%s\n", rendered)
	}
	return nil
}

func formatUserMessage(text string) string {
	lines := strings.Split(text, "\n")

	// Wrap each line in backticks
	for i, line := range lines {
		if line != "" {
			lines[i] = fmt.Sprintf("`%s`", line)
		}
	}

	return strings.Join(lines, "\n")
}

// handleUserFeedback handles user feedback messages
func (h *SayHandler) handleUserFeedback(msg *types.ClineMessage, dc *DisplayContext) error {
	if msg.Text != "" {
		markdown := formatUserMessage(msg.Text)
		rendered := dc.Renderer.RenderMarkdown(markdown)
		output.Printf("%s", rendered)
		return nil
	} else {
		return dc.Renderer.RenderMessage("USER", "[Provided feedback without text]", true)
	}
}

// handleUserFeedbackDiff handles user feedback diff messages
func (h *SayHandler) handleUserFeedbackDiff(msg *types.ClineMessage, dc *DisplayContext) error {
	var toolMsg types.ToolMessage
	if err := json.Unmarshal([]byte(msg.Text), &toolMsg); err != nil {
		return dc.Renderer.RenderMessage("USER DIFF", msg.Text, true)
	}

	message := fmt.Sprintf("User manually edited: %s\n\nDiff:\n%s",
		toolMsg.Path,
		toolMsg.Diff)

	return dc.Renderer.RenderMessage("USER DIFF", message, true)
}

// handleAPIReqRetried handles API request retry messages
func (h *SayHandler) handleAPIReqRetried(msg *types.ClineMessage, dc *DisplayContext) error {
	return dc.Renderer.RenderMessage("API INFO", "Retrying request", true)
}

// handleErrorRetry handles error retry status messages
func (h *SayHandler) handleErrorRetry(msg *types.ClineMessage, dc *DisplayContext) error {
	// Parse retry info from message text
	type ErrorRetryInfo struct {
		Attempt      int  `json:"attempt"`
		MaxAttempts  int  `json:"maxAttempts"`
		DelaySeconds int  `json:"delaySeconds"`
		Failed       bool `json:"failed"`
	}

	var retryInfo ErrorRetryInfo
	if err := json.Unmarshal([]byte(msg.Text), &retryInfo); err != nil {
		// Fallback to simple message if parsing fails
		return dc.Renderer.RenderMessage("API INFO", "Auto-retry in progress", true)
	}

	if retryInfo.Failed {
		// Retry failed after max attempts
		message := fmt.Sprintf("Auto-retry failed after %d attempts. Manual intervention required.", retryInfo.MaxAttempts)
		if dc.SystemRenderer != nil {
			return dc.SystemRenderer.RenderWarning("Auto-Retry Failed", message)
		}
		return dc.Renderer.RenderMessage("WARNING", message, true)
	}

	// Retry in progress
	message := fmt.Sprintf("Attempt %d/%d - Retrying in %d seconds...",
		retryInfo.Attempt, retryInfo.MaxAttempts, retryInfo.DelaySeconds)
	return dc.Renderer.RenderMessage("API INFO", message, true)
}

// handleCommand handles command execution announcements
func (h *SayHandler) handleCommand(msg *types.ClineMessage, dc *DisplayContext) error {
	if msg.Text == "" {
		return nil
	}

	// Use unified ToolRenderer
	rendered := dc.ToolRenderer.RenderCommandExecution(msg.Text)
	output.Print(rendered)

	return nil
}

// handleCommandOutput handles command output messages
func (h *SayHandler) handleCommandOutput(msg *types.ClineMessage, dc *DisplayContext) error {
	if msg.Text == "" {
		return nil
	}

	// Use unified ToolRenderer
	rendered := dc.ToolRenderer.RenderCommandOutput(msg.Text)
	output.Print(rendered)

	return nil
}

func (h *SayHandler) handleTool(msg *types.ClineMessage, dc *DisplayContext) error {
	var tool types.ToolMessage
	if err := json.Unmarshal([]byte(msg.Text), &tool); err != nil {
		return dc.Renderer.RenderMessage("TOOL", msg.Text, true)
	}

	// Use unified ToolRenderer
	rendered := dc.ToolRenderer.RenderToolExecution(&tool)
	output.Print(rendered)

	return nil
}

// handleShellIntegrationWarning handles shell integration warning messages
func (h *SayHandler) handleShellIntegrationWarning(msg *types.ClineMessage, dc *DisplayContext) error {
	return dc.Renderer.RenderMessage("WARNING", "Shell Integration Unavailable - Cline won't be able to view the command's output.", true)
}

// handleBrowserActionLaunch handles browser action launch messages
func (h *SayHandler) handleBrowserActionLaunch(msg *types.ClineMessage, dc *DisplayContext) error {
	url := msg.Text
	if url == "" {
		return nil
	}

	return dc.Renderer.RenderMessage("BROWSER", fmt.Sprintf("Launching browser at: %s", url), true)
}

// handleBrowserAction handles browser action messages
func (h *SayHandler) handleBrowserAction(msg *types.ClineMessage, dc *DisplayContext) error {
	if msg.Text == "" {
		return nil
	}

	type BrowserActionData struct {
		Action     string `json:"action"`
		Coordinate string `json:"coordinate,omitempty"`
		Text       string `json:"text,omitempty"`
	}

	var actionData BrowserActionData
	if err := json.Unmarshal([]byte(msg.Text), &actionData); err != nil {
		return dc.Renderer.RenderMessage("BROWSER", msg.Text, true)
	}

	// Special handling for type action
	if actionData.Action == "type" && actionData.Text != "" {
		actionText := fmt.Sprintf("type '%s'", actionData.Text)
		return dc.Renderer.RenderMessage("BROWSER", fmt.Sprintf("Next action: %s", actionText), true)
	}

	// Special handling for click action
	if actionData.Action == "click" && actionData.Coordinate != "" {
		actionText := fmt.Sprintf("click (%s)", actionData.Coordinate)
		return dc.Renderer.RenderMessage("BROWSER", fmt.Sprintf("Next action: %s", actionText), true)
	}

	// Generic handling for all other actions
	return dc.Renderer.RenderMessage("BROWSER", fmt.Sprintf("Next action: %s", actionData.Action), true)
}

// handleBrowserActionResult handles browser action result messages
func (h *SayHandler) handleBrowserActionResult(msg *types.ClineMessage, dc *DisplayContext) error {
	if msg.Text == "" {
		return nil
	}

	type BrowserActionResult struct {
		Screenshot           string `json:"screenshot,omitempty"`
		Logs                 string `json:"logs,omitempty"`
		CurrentUrl           string `json:"currentUrl,omitempty"`
		CurrentMousePosition string `json:"currentMousePosition,omitempty"`
	}

	var result BrowserActionResult
	if err := json.Unmarshal([]byte(msg.Text), &result); err != nil {
		return dc.Renderer.RenderMessage("BROWSER", "Action completed", true)
	}

	// If we have logs, include them in the message
	if result.Logs != "" {
		return dc.Renderer.RenderMessage("BROWSER", fmt.Sprintf("Action completed with logs: '%s'", result.Logs), true)
	}

	// Default case
	return dc.Renderer.RenderMessage("BROWSER", "Action completed", true)
}

// handleMcpServerRequestStarted handles MCP server request started messages
func (h *SayHandler) handleMcpServerRequestStarted(msg *types.ClineMessage, dc *DisplayContext) error {
	return dc.Renderer.RenderMessage("MCP", "Sending request to server", true)
}

// handleMcpServerResponse handles MCP server response messages
func (h *SayHandler) handleMcpServerResponse(msg *types.ClineMessage, dc *DisplayContext) error {
	return dc.Renderer.RenderMessage("MCP", fmt.Sprintf("Server response: %s", msg.Text), true)
}

// handleMcpNotification handles MCP notification messages
func (h *SayHandler) handleMcpNotification(msg *types.ClineMessage, dc *DisplayContext) error {
	return dc.Renderer.RenderMessage("MCP", fmt.Sprintf("Server notification: %s", msg.Text), true)
}

// handleUseMcpServer handles MCP server usage messages
func (h *SayHandler) handleUseMcpServer(msg *types.ClineMessage, dc *DisplayContext) error {
	return dc.Renderer.RenderMessage("MCP", "Server operation approved", true)
}

// handleDiffError handles diff error messages
func (h *SayHandler) handleDiffError(msg *types.ClineMessage, dc *DisplayContext) error {
	if dc.SystemRenderer != nil {
		return dc.SystemRenderer.RenderWarning(
			"Diff Edit Failure",
			"The model used search patterns that don't match anything in the file. Retrying...",
		)
	}
	return dc.Renderer.RenderMessage("WARNING", "Diff Edit Failure - The model used an invalid diff edit format or used search patterns that don't match anything in the file.", true)
}

// handleDeletedAPIReqs handles deleted API requests messages
func (h *SayHandler) handleDeletedAPIReqs(msg *types.ClineMessage, dc *DisplayContext) error {
	// Don't render - this is internal metadata (aggregated API metrics from deleted checkpoint messages)
	return nil
}

// handleClineignoreError handles .clineignore error messages
func (h *SayHandler) handleClineignoreError(msg *types.ClineMessage, dc *DisplayContext) error {
	if dc.SystemRenderer != nil {
		return dc.SystemRenderer.RenderInfo(
			"Access Denied",
			fmt.Sprintf("Cline tried to access `%s` which is blocked by the .clineignore file.", msg.Text),
		)
	}
	return dc.Renderer.RenderMessage("WARNING", fmt.Sprintf("Access Denied - Cline tried to access %s which is blocked by the .clineignore file", msg.Text), true)
}

func (h *SayHandler) handleCheckpointCreated(msg *types.ClineMessage, dc *DisplayContext, timestamp string) error {
	if dc.SystemRenderer != nil {
		return dc.SystemRenderer.RenderCheckpoint(timestamp, msg.Timestamp)
	}
	// Fallback to basic renderer if SystemRenderer not available
	markdown := fmt.Sprintf("## [%s] Checkpoint created `%d`", timestamp, msg.Timestamp)
	rendered := dc.Renderer.RenderMarkdown(markdown)
	output.Print(rendered)
	return nil
}

// handleLoadMcpDocumentation handles load MCP documentation messages
func (h *SayHandler) handleLoadMcpDocumentation(msg *types.ClineMessage, dc *DisplayContext) error {
	if dc.SystemRenderer != nil {
		return dc.SystemRenderer.RenderInfo("MCP", "Loading MCP documentation")
	}
	return dc.Renderer.RenderMessage("INFO", "Loading MCP documentation", true)
}

// handleInfo handles info messages
func (h *SayHandler) handleInfo(msg *types.ClineMessage, dc *DisplayContext) error {
	return nil
}

// handleTaskProgress handles task progress messages
func (h *SayHandler) handleTaskProgress(msg *types.ClineMessage, dc *DisplayContext) error {
	if msg.Text == "" {
		return nil
	}

	markdown := fmt.Sprintf("### Progress\n\n%s", msg.Text)
	rendered := dc.Renderer.RenderMarkdown(markdown)
	output.Printf("\n%s\n", rendered)
	return nil
}

// handleDefault handles unknown SAY message types
func (h *SayHandler) handleDefault(msg *types.ClineMessage, dc *DisplayContext) error {
	// Debug: log unhandled say types to help identify missing cases using output.Printf for CLI consistency
	if dc.Verbose {
		output.Printf("[DEBUG] Unhandled SAY type: '%s' (text preview: %s)\n", msg.Say, truncateForDisplay(msg.Text, 50))
	}
	return dc.Renderer.RenderMessage("SAY", msg.Text, true)
}

func truncateForDisplay(text string, maxLen int) string {
	if len(text) <= maxLen {
		return text
	}
	return text[:maxLen] + "..."
}
