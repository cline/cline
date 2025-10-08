package handlers

import (
	"encoding/json"
	"fmt"
	"strings"

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
	return dc.Renderer.RenderMessage("ERROR", msg.Text)
}

// handleAPIReqStarted handles API request started messages
func (h *SayHandler) handleAPIReqStarted(msg *types.ClineMessage, dc *DisplayContext) error {
	// Parse API request info
	apiInfo := types.APIRequestInfo{Cost: -1}
	if err := json.Unmarshal([]byte(msg.Text), &apiInfo); err != nil {
		return dc.Renderer.RenderMessage("API INFO", msg.Text)
	}

	// Handle different API request states
	if apiInfo.CancelReason != "" {
		if apiInfo.CancelReason == "user_cancelled" {
			return dc.Renderer.RenderMessage("API INFO", "Request Cancelled")
		} else if apiInfo.CancelReason == "retries_exhausted" {
			return dc.Renderer.RenderMessage("API INFO", "Request Failed (Retries Exhausted)")
		}
		return dc.Renderer.RenderMessage("API INFO", "Streaming Failed")
	}

	if apiInfo.Cost >= 0 {
		return dc.Renderer.RenderAPI("Request completed", &apiInfo)
	}

	// Check for retry status
	if apiInfo.RetryStatus != nil {
		return dc.Renderer.RenderRetry(
			apiInfo.RetryStatus.Attempt,
			apiInfo.RetryStatus.MaxAttempts,
			apiInfo.RetryStatus.DelaySec)
	}

	return dc.Renderer.RenderAPI("Processing request", &apiInfo)
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
	prefix := "CLINE"
	if dc.MessageIndex == 0 {
		prefix = "USER"
	}

	return dc.Renderer.RenderMessage(prefix, msg.Text)
}

// handleReasoning handles reasoning messages
func (h *SayHandler) handleReasoning(msg *types.ClineMessage, dc *DisplayContext) error {
	if msg.Text == "" {
		return nil
	}

	return dc.Renderer.RenderMessage("THINKING", msg.Text)
}

func (h *SayHandler) handleCompletionResult(msg *types.ClineMessage, dc *DisplayContext) error {
	text := msg.Text

	if strings.HasSuffix(text, "HAS_CHANGES") {
		text = strings.TrimSuffix(text, "HAS_CHANGES")
	}

	return dc.Renderer.RenderMessage("RESULT", text)
}

// handleUserFeedback handles user feedback messages
func (h *SayHandler) handleUserFeedback(msg *types.ClineMessage, dc *DisplayContext) error {
	if msg.Text != "" {
		return dc.Renderer.RenderMessage("USER", msg.Text)
	} else {
		return dc.Renderer.RenderMessage("USER", "[Provided feedback without text]")
	}
}

// handleUserFeedbackDiff handles user feedback diff messages
func (h *SayHandler) handleUserFeedbackDiff(msg *types.ClineMessage, dc *DisplayContext) error {
	var toolMsg types.ToolMessage
	if err := json.Unmarshal([]byte(msg.Text), &toolMsg); err != nil {
		return dc.Renderer.RenderMessage("USER DIFF", msg.Text)
	}

	message := fmt.Sprintf("User manually edited: %s\n\nDiff:\n%s",
		toolMsg.Path,
		toolMsg.Diff)

	return dc.Renderer.RenderMessage("USER DIFF", message)
}

// handleAPIReqRetried handles API request retry messages
func (h *SayHandler) handleAPIReqRetried(msg *types.ClineMessage, dc *DisplayContext) error {
	return dc.Renderer.RenderMessage("API INFO", "Retrying request")
}

// handleCommand handles command execution announcements
func (h *SayHandler) handleCommand(msg *types.ClineMessage, dc *DisplayContext) error {
	if msg.Text == "" {
		return nil
	}

	command := strings.TrimSpace(msg.Text)

	err := dc.Renderer.RenderMessage("TERMINAL", "Running command:")
	if err != nil {
		return fmt.Errorf("failed to render handleCommand: %w", err)
	}

	fmt.Printf("\n```shell\n%s\n```\n", command)

	return nil
}

// handleCommandOutput handles command output messages
func (h *SayHandler) handleCommandOutput(msg *types.ClineMessage, dc *DisplayContext) error {
	commandOutput := msg.Text
	return dc.Renderer.RenderMessage("TERMINAL", fmt.Sprintf("Current terminal output: %s", commandOutput))
}

func (h *SayHandler) handleTool(msg *types.ClineMessage, dc *DisplayContext) error {
	var tool types.ToolMessage
	if err := json.Unmarshal([]byte(msg.Text), &tool); err != nil {
		return dc.Renderer.RenderMessage("TOOL", msg.Text)
	}

	return h.renderToolMessage(&tool, dc)
}

func (h *SayHandler) renderToolMessage(tool *types.ToolMessage, dc *DisplayContext) error {
	switch tool.Tool {
	case string(types.ToolTypeEditedExistingFile):
		dc.Renderer.RenderMessage("TOOL", fmt.Sprintf("Cline edited file: %s", tool.Path))
	case string(types.ToolTypeNewFileCreated):
		dc.Renderer.RenderMessage("TOOL", fmt.Sprintf("Cline created file: %s", tool.Path))
	case string(types.ToolTypeReadFile):
		dc.Renderer.RenderMessage("TOOL", fmt.Sprintf("Cline read file: %s", tool.Path))
	case string(types.ToolTypeListFilesTopLevel):
		dc.Renderer.RenderMessage("TOOL", fmt.Sprintf("Cline listed files in: %s", tool.Path))
	case string(types.ToolTypeListFilesRecursive):
		dc.Renderer.RenderMessage("TOOL", fmt.Sprintf("Cline recursively listed files in: %s", tool.Path))
	case string(types.ToolTypeSearchFiles):
		dc.Renderer.RenderMessage("TOOL", fmt.Sprintf("Cline searched for '%s' in: %s", tool.Regex, tool.Path))
	case string(types.ToolTypeWebFetch):
		dc.Renderer.RenderMessage("TOOL", fmt.Sprintf("Cline fetched URL: %s", tool.Path))
	case string(types.ToolTypeListCodeDefinitionNames):
		dc.Renderer.RenderMessage("TOOL", fmt.Sprintf("Cline listed code definitions for: %s", tool.Path))
	case string(types.ToolTypeSummarizeTask):
		dc.Renderer.RenderMessage("TOOL", "Cline condensed the conversation")
	default:
		dc.Renderer.RenderMessage("TOOL", fmt.Sprintf("Cline executed tool: %s", tool.Tool))
	}

	// Skip content preview for readFile and webFetch tools
	if tool.Tool == string(types.ToolTypeReadFile) || tool.Tool == string(types.ToolTypeWebFetch) {
		return nil
	}

	// Show content preview, truncating if necessary
	preview := tool.Content
	if preview != "" {
		preview = strings.TrimSpace(tool.Content)
		if len(preview) > 1000 {
			preview = preview[:1000] + "..."
		}
		fmt.Printf("Content: %s\n", preview)
	}

	return nil
}

// handleShellIntegrationWarning handles shell integration warning messages
func (h *SayHandler) handleShellIntegrationWarning(msg *types.ClineMessage, dc *DisplayContext) error {
	return dc.Renderer.RenderMessage("WARNING", "Shell Integration Unavailable - Cline won't be able to view the command's output.")
}

// handleBrowserActionLaunch handles browser action launch messages
func (h *SayHandler) handleBrowserActionLaunch(msg *types.ClineMessage, dc *DisplayContext) error {
	url := msg.Text
	if url == "" {
		return nil
	}

	return dc.Renderer.RenderMessage("BROWSER", fmt.Sprintf("Launching browser at: %s", url))
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
		return dc.Renderer.RenderMessage("BROWSER", msg.Text)
	}

	// Special handling for type action
	if actionData.Action == "type" && actionData.Text != "" {
		actionText := fmt.Sprintf("type '%s'", actionData.Text)
		return dc.Renderer.RenderMessage("BROWSER", fmt.Sprintf("Next action: %s", actionText))
	}

	// Special handling for click action
	if actionData.Action == "click" && actionData.Coordinate != "" {
		actionText := fmt.Sprintf("click (%s)", actionData.Coordinate)
		return dc.Renderer.RenderMessage("BROWSER", fmt.Sprintf("Next action: %s", actionText))
	}

	// Generic handling for all other actions
	return dc.Renderer.RenderMessage("BROWSER", fmt.Sprintf("Next action: %s", actionData.Action))
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
		return dc.Renderer.RenderMessage("BROWSER", "Action completed")
	}

	// If we have logs, include them in the message
	if result.Logs != "" {
		return dc.Renderer.RenderMessage("BROWSER", fmt.Sprintf("Action completed with logs: '%s'", result.Logs))
	}

	// Default case
	return dc.Renderer.RenderMessage("BROWSER", "Action completed")
}

// handleMcpServerRequestStarted handles MCP server request started messages
func (h *SayHandler) handleMcpServerRequestStarted(msg *types.ClineMessage, dc *DisplayContext) error {
	return dc.Renderer.RenderMessage("MCP", "Sending request to server")
}

// handleMcpServerResponse handles MCP server response messages
func (h *SayHandler) handleMcpServerResponse(msg *types.ClineMessage, dc *DisplayContext) error {
	return dc.Renderer.RenderMessage("MCP", fmt.Sprintf("Server response: %s", msg.Text))
}

// handleMcpNotification handles MCP notification messages
func (h *SayHandler) handleMcpNotification(msg *types.ClineMessage, dc *DisplayContext) error {
	return dc.Renderer.RenderMessage("MCP", fmt.Sprintf("Server notification: %s", msg.Text))
}

// handleUseMcpServer handles MCP server usage messages
func (h *SayHandler) handleUseMcpServer(msg *types.ClineMessage, dc *DisplayContext) error {
	return dc.Renderer.RenderMessage("MCP", "Server operation approved")
}

// handleDiffError handles diff error messages
func (h *SayHandler) handleDiffError(msg *types.ClineMessage, dc *DisplayContext) error {
	return dc.Renderer.RenderMessage("WARNING", "Diff Edit Failure - The model used an invalid diff edit format or used search patterns that don't match anything in the file.")
}

// handleDeletedAPIReqs handles deleted API requests messages
func (h *SayHandler) handleDeletedAPIReqs(msg *types.ClineMessage, dc *DisplayContext) error {
	// This message includes api metrics of deleted messages, which we do not log
	return dc.Renderer.RenderMessage("GEN INFO", "Checkpoint restored")
}

// handleClineignoreError handles .clineignore error messages
func (h *SayHandler) handleClineignoreError(msg *types.ClineMessage, dc *DisplayContext) error {
	return dc.Renderer.RenderMessage("WARNING", fmt.Sprintf("Access Denied - Cline tried to access %s which is blocked by the .clineignore file", msg.Text))
}

func (h *SayHandler) handleCheckpointCreated(msg *types.ClineMessage, dc *DisplayContext, timestamp string) error {
	message := fmt.Sprintf("Checkpoint created (ID: %d)", msg.Timestamp)
	return dc.Renderer.RenderMessageWithTimestamp(timestamp, "GEN INFO", message)
}

// handleLoadMcpDocumentation handles load MCP documentation messages
func (h *SayHandler) handleLoadMcpDocumentation(msg *types.ClineMessage, dc *DisplayContext) error {
	return dc.Renderer.RenderMessage("GEN INFO", "Loading MCP documentation")
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

	return dc.Renderer.RenderMessage("PROGRESS", fmt.Sprintf("Task Checklist: %s", msg.Text))
}

// handleDefault handles unknown SAY message types
func (h *SayHandler) handleDefault(msg *types.ClineMessage, dc *DisplayContext) error {
	return dc.Renderer.RenderMessage("SAY", msg.Text)
}
