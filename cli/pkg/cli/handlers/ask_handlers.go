package handlers

import (
	"encoding/json"
	"fmt"
	"strings"

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
	case string(types.AskTypeAutoApprovalMaxReached):
		return h.handleAutoApprovalMaxReached(msg, dc)
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
	var question string
	var options []string

	var askData types.AskData
	if err := json.Unmarshal([]byte(msg.Text), &askData); err == nil {
		question = askData.Question
		options = askData.Options
	} else {
		question = msg.Text
	}

	if question == "" {
		return nil
	}

	err := dc.Renderer.RenderMessage("QUESTION", question, true)
	if err != nil {
		return err
	}

	// Display options if available
	if len(options) > 0 {
		fmt.Println("\nOptions:")
		for i, option := range options {
			fmt.Printf("%d. %s\n", i+1, option)
		}
	}

	return nil
}

// handlePlanModeRespond handles plan mode responses
func (h *AskHandler) handlePlanModeRespond(msg *types.ClineMessage, dc *DisplayContext) error {
	var response string
	var options []string

	// Try to parse as JSON
	type PlanModeResponse struct {
		Response string   `json:"response"`
		Options  []string `json:"options,omitempty"`
	}

	var planData PlanModeResponse
	if err := json.Unmarshal([]byte(msg.Text), &planData); err == nil {
		response = planData.Response
		options = planData.Options
	} else {
		response = msg.Text
	}

	if response == "" {
		return nil
	}

	markdown := fmt.Sprintf("### Cline has a plan\n\n%s", response)
	rendered := dc.Renderer.RenderMarkdown(markdown)
	fmt.Printf("\n%s\n", rendered)

	// Display options if available
	if len(options) > 0 {
		fmt.Println("\nOptions:")
		for i, option := range options {
			fmt.Printf("%d. %s\n", i+1, option)
		}
	}

	return nil
}

// handleCommand handles command execution requests
func (h *AskHandler) handleCommand(msg *types.ClineMessage, dc *DisplayContext) error {
	if msg.Text == "" {
		return nil
	}

	command := msg.Text

	// Check if this command was flagged despite auto-approval settings turned on for safe commands
	hasAutoApprovalConflict := strings.HasSuffix(command, "REQ_APP")
	if hasAutoApprovalConflict {
		command = strings.TrimSuffix(command, "REQ_APP")
	}

	err := dc.Renderer.RenderMessage("TERMINAL", "Cline wants to execute this command:", true)
	if err != nil {
		return fmt.Errorf("failed to render handleCommand: %w", err)
	}

	// Render markdown with syntax highlighting
	markdown := fmt.Sprintf("```shell\n%s\n```", strings.TrimSpace(command))
	rendered := dc.Renderer.RenderMarkdown(markdown)
	fmt.Printf("\n%s\n", rendered)

	if hasAutoApprovalConflict {
		fmt.Printf("\nThe model has determined this command requires explicit approval.\n")
	} else {
		fmt.Printf("\nApproval required for this command.\n")
	}

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

	return h.renderToolMessage(&tool, dc)
}

// renderToolMessage renders a tool message with appropriate formatting
func (h *AskHandler) renderToolMessage(tool *types.ToolMessage, dc *DisplayContext) error {
	switch tool.Tool {
	case string(types.ToolTypeEditedExistingFile):
		dc.Renderer.RenderMessage("TOOL", fmt.Sprintf("Cline wants to edit file: %s", tool.Path), true)
	case string(types.ToolTypeNewFileCreated):
		dc.Renderer.RenderMessage("TOOL", fmt.Sprintf("Cline wants to create file: %s", tool.Path), true)
	case string(types.ToolTypeReadFile):
		dc.Renderer.RenderMessage("TOOL", fmt.Sprintf("Cline wants to read file: %s", tool.Path), true)
	case string(types.ToolTypeListFilesTopLevel):
		dc.Renderer.RenderMessage("TOOL", fmt.Sprintf("Cline wants to list files in: %s", tool.Path), true)
	case string(types.ToolTypeListFilesRecursive):
		dc.Renderer.RenderMessage("TOOL", fmt.Sprintf("Cline wants to recursively list files in: %s", tool.Path), true)
	case string(types.ToolTypeSearchFiles):
		dc.Renderer.RenderMessage("TOOL", fmt.Sprintf("Cline wants to search for '%s' in: %s", tool.Regex, tool.Path), true)
	case string(types.ToolTypeWebFetch):
		dc.Renderer.RenderMessage("TOOL", fmt.Sprintf("Cline wants to fetch URL: %s", tool.Path), true)
	case string(types.ToolTypeListCodeDefinitionNames):
		dc.Renderer.RenderMessage("TOOL", fmt.Sprintf("Cline wants to list code definitions for: %s", tool.Path), true)
	default:
		dc.Renderer.RenderMessage("TOOL", fmt.Sprintf("Cline wants to use tool: %s", tool.Tool), true)
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

		fmt.Printf("Preview: %s\n", preview)
	}

	fmt.Printf("\nApproval required.\n")

	return nil
}

// handleAPIReqFailed handles API request failures
func (h *AskHandler) handleAPIReqFailed(msg *types.ClineMessage, dc *DisplayContext) error {
	return dc.Renderer.RenderMessage("ERROR", fmt.Sprintf("API Request Failed: %s. Approve to retry request.", msg.Text), true)
}

// handleResumeTask handles resume task requests
func (h *AskHandler) handleResumeTask(msg *types.ClineMessage, dc *DisplayContext) error {
	return dc.Renderer.RenderMessage("GEN INFO", "Resuming interrupted task.", true)
}

// handleResumeCompletedTask handles resume completed task requests
func (h *AskHandler) handleResumeCompletedTask(msg *types.ClineMessage, dc *DisplayContext) error {
	return dc.Renderer.RenderMessage("GEN INFO", "Resuming completed task.", true)
}

// handleMistakeLimitReached handles mistake limit reached
func (h *AskHandler) handleMistakeLimitReached(msg *types.ClineMessage, dc *DisplayContext) error {
	return dc.Renderer.RenderMessage("ERROR", fmt.Sprintf("Mistake Limit Reached: %s. Approval required.", msg.Text), true)
}

// handleAutoApprovalMaxReached handles auto-approval max reached
func (h *AskHandler) handleAutoApprovalMaxReached(msg *types.ClineMessage, dc *DisplayContext) error {
	return dc.Renderer.RenderMessage("WARNING", fmt.Sprintf("Auto-approval limit reached: %s. Approval required.", msg.Text), true)
}

// handleBrowserActionLaunch handles browser action launch requests
func (h *AskHandler) handleBrowserActionLaunch(msg *types.ClineMessage, dc *DisplayContext) error {
	url := strings.TrimSpace(msg.Text)
	return dc.Renderer.RenderMessage("BROWSER", fmt.Sprintf("Cline wants to launch browser and navigate to: %s. Approval required.", url), true)
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

	return dc.Renderer.RenderMessage("MCP",
		fmt.Sprintf("Cline wants to %s on the %s MCP server", operation, mcpReq.ServerName), true)
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
