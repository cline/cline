package handlers

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/cline/cli/pkg/cli/clerror"
	"github.com/cline/cli/pkg/cli/output"
	"github.com/cline/cli/pkg/cli/types"
)

// AskHandler handles ASK type messages
type AskHandler struct {
	*BaseHandler
}

// NewAskHandler creates a new ASK handler
func NewAskHandler() *AskHandler {
	return &AskHandler{
		BaseHandler: NewBaseHandler("ask", PriorityHigh),
	}
}

// CanHandle returns true if this is an ASK message
func (h *AskHandler) CanHandle(msg *types.ClineMessage) bool {
	return msg.IsAsk()
}

func (h *AskHandler) Handle(msg *types.ClineMessage, dc *DisplayContext) error {
	// Always display approval messages so user can see what they're approving
	// The input handler will show the approval prompt form after the content is displayed

	switch msg.Ask {
	case string(types.AskTypeFollowup):
		return h.handleFollowup(msg, dc)
	case string(types.AskTypePlanModeRespond):
		return h.handlePlanModeRespond(msg, dc)
	case string(types.AskTypeCommand):
		return h.handleCommand(msg, dc)
	case string(types.AskTypeCommandOutput):
		return h.handleCommandOutput(msg, dc)
	case string(types.AskTypeCompletionResult):
		return h.handleCompletionResult(msg, dc)
	case string(types.AskTypeTool):
		return h.handleTool(msg, dc)
	case string(types.AskTypeAPIReqFailed):
		return h.handleAPIReqFailed(msg, dc)
	case string(types.AskTypeResumeTask):
		return h.handleResumeTask(msg, dc)
	case string(types.AskTypeResumeCompletedTask):
		return h.handleResumeCompletedTask(msg, dc)
	case string(types.AskTypeMistakeLimitReached):
		return h.handleMistakeLimitReached(msg, dc)
	case string(types.AskTypeBrowserActionLaunch):
		return h.handleBrowserActionLaunch(msg, dc)
	case string(types.AskTypeUseMcpServer):
		return h.handleUseMcpServer(msg, dc)
	case string(types.AskTypeNewTask):
		return h.handleNewTask(msg, dc)
	case string(types.AskTypeCondense):
		return h.handleCondense(msg, dc)
	case string(types.AskTypeReportBug):
		return h.handleReportBug(msg, dc)
	default:
		return h.handleDefault(msg, dc)
	}
}

// handleFollowup handles followup questions
func (h *AskHandler) handleFollowup(msg *types.ClineMessage, dc *DisplayContext) error {
	body := dc.ToolRenderer.GenerateAskFollowupBody(msg.Text)

	if body == "" {
		return nil
	}

	if dc.IsStreamingMode {
		// In streaming mode, header was already shown by partial stream
		// Just render the body content
		output.Print(body)
	} else {
		// Non-streaming mode: render header + body together
		header := dc.ToolRenderer.GenerateAskFollowupHeader()
		rendered := dc.Renderer.RenderMarkdown(header)
		output.Print("\n")
		output.Print(rendered)
		output.Print("\n")
		output.Print(body)
	}

	return nil
}

// handlePlanModeRespond handles plan mode responses
func (h *AskHandler) handlePlanModeRespond(msg *types.ClineMessage, dc *DisplayContext) error {
	if dc.IsStreamingMode {
		// In streaming mode, header was already shown by partial stream
		// Just render the body content
		body := dc.ToolRenderer.GeneratePlanModeRespondBody(msg.Text)
		if body != "" {
			output.Print(body)
		}
	} else {
		// In non-streaming mode, render header + body together
		header := dc.ToolRenderer.GeneratePlanModeRespondHeader()
		body := dc.ToolRenderer.GeneratePlanModeRespondBody(msg.Text)

		if body == "" {
			return nil
		}

		// Render header
		rendered := dc.Renderer.RenderMarkdown(header)
		output.Print("\n")
		output.Print(rendered)
		output.Print("\n")

		// Render body
		output.Print(body)
	}

	return nil
}

// showApprovalHint displays a hint in non-interactive mode about how to approve/deny
func (h *AskHandler) showApprovalHint(dc *DisplayContext) {
	if !dc.IsInteractive {
		output.Printf("\n%s\n", dc.Renderer.Dim("Cline is requesting approval to use this tool"))
		output.Printf("%s\n", dc.Renderer.Dim("Use cline task send --approve or --deny to respond"))
	}
}

// handleCommand handles command execution requests
func (h *AskHandler) handleCommand(msg *types.ClineMessage, dc *DisplayContext) error {
	if msg.Text == "" {
		return nil
	}

	// Check if this command was flagged despite auto-approval settings
	autoApprovalConflict := strings.HasSuffix(msg.Text, "REQ_APP")

	// Use unified ToolRenderer
	rendered := dc.ToolRenderer.RenderCommandApprovalRequest(msg.Text, autoApprovalConflict)
	output.Print(rendered)

	h.showApprovalHint(dc)
	return nil
}

// handleCommandOutput handles command output requests
func (h *AskHandler) handleCommandOutput(msg *types.ClineMessage, dc *DisplayContext) error {
	if msg.Text == "" {
		return nil
	}

	commandOutput := msg.Text

	markdown := fmt.Sprintf("```\n%s\n```", commandOutput)
	rendered := dc.Renderer.RenderMarkdown(markdown)

	fmt.Printf("%s", rendered)

	return nil
}

// handleCompletionResult handles completion result requests
func (h *AskHandler) handleCompletionResult(msg *types.ClineMessage, dc *DisplayContext) error {
	return nil
}

// handleTool handles tool execution requests
func (h *AskHandler) handleTool(msg *types.ClineMessage, dc *DisplayContext) error {
	// Parse tool message
	var tool types.ToolMessage
	if err := json.Unmarshal([]byte(msg.Text), &tool); err != nil {
		// Fallback to simple display
		return dc.Renderer.RenderMessage("TOOL", msg.Text, true)
	}

	if dc.IsStreamingMode {
		// In streaming mode, header was already shown by partial stream
		// Just render the content preview
		contentPreview := dc.ToolRenderer.GenerateToolContentPreview(&tool)
		if contentPreview != "" {
			output.Print("\n")
			output.Print(contentPreview)
		}
	} else {
		// Non-streaming mode: render full approval (header + preview)
		rendered := dc.ToolRenderer.RenderToolApprovalRequest(&tool)
		output.Print(rendered)
	}

	h.showApprovalHint(dc)
	return nil
}

// handleAPIReqFailed handles API request failures
func (h *AskHandler) handleAPIReqFailed(msg *types.ClineMessage, dc *DisplayContext) error {
	// Try to parse as ClineError for better error display
	clineErr, _ := clerror.ParseClineError(msg.Text)
	if clineErr != nil {
		if dc.SystemRenderer != nil {
			// Render the error with system renderer
			switch clineErr.GetErrorType() {
			case clerror.ErrorTypeBalance:
				dc.SystemRenderer.RenderBalanceError(clineErr)
			case clerror.ErrorTypeAuth:
				dc.SystemRenderer.RenderAuthError(clineErr)
			case clerror.ErrorTypeRateLimit:
				dc.SystemRenderer.RenderRateLimitError(clineErr)
			default:
				dc.SystemRenderer.RenderAPIError(clineErr)
			}
			return nil
		}
		// Fallback: render with basic renderer using parsed message
		return dc.Renderer.RenderMessage("ERROR", fmt.Sprintf("API Request Failed: %s. Approve to retry request.", clineErr.Message), true)
	}
	// Last resort: display raw text if parsing completely failed
	return dc.Renderer.RenderMessage("ERROR", fmt.Sprintf("API Request Failed: %s. Approve to retry request.", msg.Text), true)
}

// handleResumeTask handles resume task requests
func (h *AskHandler) handleResumeTask(msg *types.ClineMessage, dc *DisplayContext) error {
	// Don't render - this is metadata only, user already knows they're resuming
	return nil
}

// handleResumeCompletedTask handles resume completed task requests
func (h *AskHandler) handleResumeCompletedTask(msg *types.ClineMessage, dc *DisplayContext) error {
	// Don't render - this is metadata only, user already knows they're resuming
	return nil
}

// handleMistakeLimitReached handles mistake limit reached
func (h *AskHandler) handleMistakeLimitReached(msg *types.ClineMessage, dc *DisplayContext) error {
	if dc.SystemRenderer != nil {
		details := make(map[string]string)
		if msg.Text != "" {
			details["details"] = msg.Text
		}
		dc.SystemRenderer.RenderError(
			"critical",
			"Mistake Limit Reached",
			"Cline has made too many consecutive mistakes and needs your guidance to proceed.",
			details,
		)
		fmt.Printf("\n**Approval required to continue.**\n")
		return nil
	}
	return dc.Renderer.RenderMessage("ERROR", fmt.Sprintf("Mistake Limit Reached: %s. Approval required.", msg.Text), true)
}

// handleBrowserActionLaunch handles browser action launch requests
func (h *AskHandler) handleBrowserActionLaunch(msg *types.ClineMessage, dc *DisplayContext) error {
	url := strings.TrimSpace(msg.Text)
	err := dc.Renderer.RenderMessage("BROWSER", fmt.Sprintf("Cline wants to launch browser and navigate to: %s. Approval required.", url), true)
	h.showApprovalHint(dc)
	return err
}

// handleUseMcpServer handles MCP server usage requests
func (h *AskHandler) handleUseMcpServer(msg *types.ClineMessage, dc *DisplayContext) error {
	// Parse MCP server usage request
	type McpServerRequest struct {
		ServerName string `json:"serverName"`
		Type       string `json:"type"`
		ToolName   string `json:"toolName,omitempty"`
		Arguments  string `json:"arguments,omitempty"`
		URI        string `json:"uri,omitempty"`
	}

	var mcpReq McpServerRequest
	if err := json.Unmarshal([]byte(msg.Text), &mcpReq); err != nil {
		return dc.Renderer.RenderMessage("MCP", msg.Text, true)
	}

	var operation string
	if mcpReq.Type == "access_mcp_resource" {
		operation = "access a resource"
	} else {
		operation = fmt.Sprintf("use a tool (%s)", mcpReq.ToolName)
		if mcpReq.Arguments != "" {
			operation = fmt.Sprintf("%s with args (%s)", operation, mcpReq.Arguments)
		}
	}

	err := dc.Renderer.RenderMessage("MCP",
		fmt.Sprintf("Cline wants to %s on the %s MCP server", operation, mcpReq.ServerName), true)

	h.showApprovalHint(dc)
	return err
}

// handleNewTask handles new task creation requests
func (h *AskHandler) handleNewTask(msg *types.ClineMessage, dc *DisplayContext) error {
	return dc.Renderer.RenderMessage("NEW TASK", fmt.Sprintf("Cline wants to start a new task: %s. Approval required.", msg.Text), true)
}

// handleCondense handles conversation condensing requests
func (h *AskHandler) handleCondense(msg *types.ClineMessage, dc *DisplayContext) error {
	return dc.Renderer.RenderMessage("CONDENSE", fmt.Sprintf("Cline wants to condense the conversation: %s. Approval required.", msg.Text), true)
}

// handleReportBug handles bug report requests
func (h *AskHandler) handleReportBug(msg *types.ClineMessage, dc *DisplayContext) error {
	var bugData struct {
		Title             string `json:"title"`
		WhatHappened      string `json:"what_happened"`
		StepsToReproduce  string `json:"steps_to_reproduce"`
		APIRequestOutput  string `json:"api_request_output"`
		AdditionalContext string `json:"additional_context"`
	}

	if err := json.Unmarshal([]byte(msg.Text), &bugData); err != nil {
		return dc.Renderer.RenderMessage("BUG REPORT", fmt.Sprintf("Cline wants to create a GitHub issue: %s. Approval required.", msg.Text), true)
	}

	err := dc.Renderer.RenderMessage("BUG REPORT", "Cline wants to create a GitHub issue:", true)
	if err != nil {
		return fmt.Errorf("failed to render handleReportBug: %w", err)
	}

	fmt.Printf("\n**Title**: %s\n", bugData.Title)
	fmt.Printf("**What Happened**: %s\n", bugData.WhatHappened)
	fmt.Printf("**Steps to Reproduce**: %s\n", bugData.StepsToReproduce)
	fmt.Printf("**API Request Output**: %s\n", bugData.APIRequestOutput)
	fmt.Printf("**Additional Context**: %s\n", bugData.AdditionalContext)
	fmt.Printf("\nApprove to create a GitHub issue.\n")

	return nil
}

// handleDefault handles unknown ASK message types
func (h *AskHandler) handleDefault(msg *types.ClineMessage, dc *DisplayContext) error {
	return dc.Renderer.RenderMessage("ASK", msg.Text, true)
}
