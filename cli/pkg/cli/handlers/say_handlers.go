package handlers

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/cline/cli/pkg/cli/display"
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
	return dc.Renderer.RenderMessage("ERROR", msg.Text, true)
}

// handleAPIReqStarted handles API request started messages
func (h *SayHandler) handleAPIReqStarted(msg *types.ClineMessage, dc *DisplayContext) error {
	// Parse API request info
	apiInfo := types.APIRequestInfo{Cost: -1}
	if err := json.Unmarshal([]byte(msg.Text), &apiInfo); err != nil {
		return dc.Renderer.RenderMessage("API INFO", msg.Text, true)
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
		fmt.Printf("%s", rendered)
		fmt.Printf("\n")
		return nil
	}

	// Regular Cline text response
	var rendered string
	if dc.IsStreamingMode {
		// In streaming mode, header already shown by partial stream
		rendered = dc.Renderer.RenderMarkdown(msg.Text)
		fmt.Printf("%s\n", rendered)
	} else {
		// In non-streaming mode, render header + body together
		markdown := fmt.Sprintf("### Cline responds\n\n%s", msg.Text)
		rendered = dc.Renderer.RenderMarkdown(markdown)
		fmt.Printf("\n%s\n", rendered)
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
		fmt.Printf("%s\n", rendered)
	} else {
		// In non-streaming mode, render header + body together
		markdown := fmt.Sprintf("### Cline is thinking\n\n%s", msg.Text)
		rendered = dc.Renderer.RenderMarkdown(markdown)
		fmt.Printf("\n%s\n", rendered)
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
		fmt.Printf("%s\n", rendered)
	} else {
		// In non-streaming mode, render header + body together
		markdown := fmt.Sprintf("### Task completed\n\n%s", text)
		rendered = dc.Renderer.RenderMarkdown(markdown)
		fmt.Printf("\n%s\n", rendered)
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
		fmt.Printf("%s", rendered)
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

// handleCommand handles command execution announcements
func (h *SayHandler) handleCommand(msg *types.ClineMessage, dc *DisplayContext) error {
	if msg.Text == "" {
		return nil
	}

	command := strings.TrimSpace(msg.Text)

	markdown := fmt.Sprintf("### Cline wants to run a command: `%s`", command)
	rendered := dc.Renderer.RenderMarkdown(markdown)

	// Render markdown with syntax highlighting
	fmt.Printf("%s\n", rendered)

	return nil
}

// handleCommandOutput handles command output messages
func (h *SayHandler) handleCommandOutput(msg *types.ClineMessage, dc *DisplayContext) error {
	commandOutput := msg.Text
	return dc.Renderer.RenderMessage("TERMINAL", fmt.Sprintf("Current terminal output: %s", commandOutput), true)
}

func (h *SayHandler) handleTool(msg *types.ClineMessage, dc *DisplayContext) error {
	var tool types.ToolMessage
	if err := json.Unmarshal([]byte(msg.Text), &tool); err != nil {
		return dc.Renderer.RenderMessage("TOOL", msg.Text, true)
	}

	return h.renderToolMessage(&tool, dc)
}

func (h *SayHandler) renderToolMessage(tool *types.ToolMessage, dc *DisplayContext) error {
	var markdown string
	
	// Generate header with consistent phrasing
	switch tool.Tool {
	case string(types.ToolTypeEditedExistingFile):
		markdown = fmt.Sprintf("### Cline is editing `%s`", tool.Path)
	case string(types.ToolTypeNewFileCreated):
		markdown = fmt.Sprintf("### Cline is writing `%s`", tool.Path)
	case string(types.ToolTypeReadFile):
		markdown = fmt.Sprintf("### Cline is reading `%s`", tool.Path)
	case string(types.ToolTypeListFilesTopLevel):
		markdown = fmt.Sprintf("### Cline is listing files in `%s`", tool.Path)
	case string(types.ToolTypeListFilesRecursive):
		markdown = fmt.Sprintf("### Cline is recursively listing files in `%s`", tool.Path)
	case string(types.ToolTypeSearchFiles):
		if tool.Regex != "" && tool.Path != "" {
			markdown = fmt.Sprintf("### Cline is searching for `%s` in `%s`", tool.Regex, tool.Path)
		} else if tool.Regex != "" {
			markdown = fmt.Sprintf("### Cline is searching for `%s`", tool.Regex)
		} else {
			markdown = "### Cline is searching files"
		}
	case string(types.ToolTypeWebFetch):
		markdown = fmt.Sprintf("### Cline is fetching `%s`", tool.Path)
	case string(types.ToolTypeListCodeDefinitionNames):
		markdown = fmt.Sprintf("### Cline is listing code definitions in `%s`", tool.Path)
	case string(types.ToolTypeSummarizeTask):
		markdown = "### Cline condensed the conversation"
	default:
		markdown = fmt.Sprintf("### Tool: %s", tool.Tool)
	}
	
	rendered := dc.Renderer.RenderMarkdown(markdown)
	fmt.Printf("\n%s\n", rendered)

	// Use enhanced tool result parser for supported tools
	toolParser := display.NewToolResultParser(dc.Renderer.GetMdRenderer())
	
	switch tool.Tool {
	case string(types.ToolTypeReadFile):
		// readFile: show header only, no body
		return nil
		
	case string(types.ToolTypeListFilesTopLevel), 
	     string(types.ToolTypeListFilesRecursive), 
		 string(types.ToolTypeListCodeDefinitionNames),
	     string(types.ToolTypeSearchFiles), 
		 string(types.ToolTypeWebFetch):

		if tool.Content != "" {
			preview := toolParser.ParseToolResult(tool)
			previewRendered := dc.Renderer.RenderMarkdown(preview)
			fmt.Printf("\n%s\n", previewRendered)
		}
		return nil
		
	case string(types.ToolTypeEditedExistingFile):
		// Show the diff if available
		if tool.Content != "" {
			diffMarkdown := fmt.Sprintf("```diff\n%s\n```", tool.Content)
			diffRendered := dc.Renderer.RenderMarkdown(diffMarkdown)
			fmt.Printf("%s", diffRendered)
		}
		return nil
	
	default:
		// Show content preview for other tools, truncating if necessary
		preview := tool.Content
		if preview != "" {
			preview = strings.TrimSpace(tool.Content)
			if len(preview) > 1000 {
				preview = preview[:1000] + "..."
			}
			fmt.Printf("Content: %s\n", preview)
		}
	}

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
	return dc.Renderer.RenderMessage("WARNING", "Diff Edit Failure - The model used an invalid diff edit format or used search patterns that don't match anything in the file.", true)
}

// handleDeletedAPIReqs handles deleted API requests messages
func (h *SayHandler) handleDeletedAPIReqs(msg *types.ClineMessage, dc *DisplayContext) error {
	// This message includes api metrics of deleted messages, which we do not log
	return dc.Renderer.RenderMessage("GEN INFO", "Checkpoint restored", true)
}

// handleClineignoreError handles .clineignore error messages
func (h *SayHandler) handleClineignoreError(msg *types.ClineMessage, dc *DisplayContext) error {
	return dc.Renderer.RenderMessage("WARNING", fmt.Sprintf("Access Denied - Cline tried to access %s which is blocked by the .clineignore file", msg.Text), true)
}

func (h *SayHandler) handleCheckpointCreated(msg *types.ClineMessage, dc *DisplayContext, timestamp string) error {
	return dc.Renderer.RenderCheckpointMessage(timestamp, "GEN INFO", msg.Timestamp)
}

// handleLoadMcpDocumentation handles load MCP documentation messages
func (h *SayHandler) handleLoadMcpDocumentation(msg *types.ClineMessage, dc *DisplayContext) error {
	return dc.Renderer.RenderMessage("GEN INFO", "Loading MCP documentation", true)
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
	fmt.Printf("\n%s\n", rendered)
	return nil
}

// handleDefault handles unknown SAY message types
func (h *SayHandler) handleDefault(msg *types.ClineMessage, dc *DisplayContext) error {
	return dc.Renderer.RenderMessage("SAY", msg.Text, true)
}
