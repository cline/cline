package display

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/cline/cli/pkg/cli/types"
)

// ToolRenderer provides unified rendering for tool and command messages
type ToolRenderer struct {
	mdRenderer   *MarkdownRenderer
	outputFormat string
}

// NewToolRenderer creates a new tool renderer
func NewToolRenderer(mdRenderer *MarkdownRenderer, outputFormat string) *ToolRenderer {
	return &ToolRenderer{
		mdRenderer:   mdRenderer,
		outputFormat: outputFormat,
	}
}

// RenderToolApprovalRequest renders a tool approval request ("Cline wants to...")
func (tr *ToolRenderer) RenderToolApprovalRequest(tool *types.ToolMessage) string {
	var output strings.Builder

	// Generate header
	header := tr.generateToolHeader(tool, "wants to")
	rendered := tr.renderMarkdown(header)
	output.WriteString(rendered)
	output.WriteString("\n")

	// Add content preview for relevant tools
	contentPreview := tr.GenerateToolContentPreview(tool)
	if contentPreview != "" {
		output.WriteString("\n")
		output.WriteString(contentPreview)
	}

	return output.String()
}

// RenderToolExecution renders a completed tool execution ("Cline is ...ing")
func (tr *ToolRenderer) RenderToolExecution(tool *types.ToolMessage) string {
	var output strings.Builder

	// Generate header
	header := tr.generateToolHeader(tool, "is")
	rendered := tr.renderMarkdown(header)
	output.WriteString("\n")
	output.WriteString(rendered)
	output.WriteString("\n")

	// Add content body for relevant tools
	contentBody := tr.GenerateToolContentBody(tool)
	if contentBody != "" {
		output.WriteString("\n")
		output.WriteString(contentBody)
		output.WriteString("\n")
	}

	return output.String()
}

// RenderToolExecutionHeader renders just the header for streaming (no body)
func (tr *ToolRenderer) RenderToolExecutionHeader(tool *types.ToolMessage) string {
	header := tr.generateToolHeader(tool, "is")
	return header
}

// RenderToolApprovalHeader renders just the header for approval requests (no body)
func (tr *ToolRenderer) RenderToolApprovalHeader(tool *types.ToolMessage) string {
	header := tr.generateToolHeader(tool, "wants to")
	return header
}

// generateToolHeader generates the markdown header for a tool message
func (tr *ToolRenderer) generateToolHeader(tool *types.ToolMessage, verbTense string) string {
	var verb string
	var action string

	switch tool.Tool {
	case string(types.ToolTypeEditedExistingFile):
		if verbTense == "wants to" {
			action = "wants to edit"
		} else {
			action = "is editing"
		}
		return fmt.Sprintf("### Cline %s `%s`", action, tool.Path)

	case string(types.ToolTypeNewFileCreated):
		if verbTense == "wants to" {
			action = "wants to write"
		} else {
			action = "is writing"
		}
		return fmt.Sprintf("### Cline %s `%s`", action, tool.Path)

	case string(types.ToolTypeReadFile):
		if verbTense == "wants to" {
			action = "wants to read"
		} else {
			action = "is reading"
		}
		return fmt.Sprintf("### Cline %s `%s`", action, tool.Path)

	case string(types.ToolTypeFileDeleted):
		if verbTense == "wants to" {
			action = "wants to delete"
		} else {
			action = "is deleting"
		}
		return fmt.Sprintf("### Cline %s `%s`", action, tool.Path)

	case string(types.ToolTypeListFilesTopLevel):
		if verbTense == "wants to" {
			action = "wants to list files in"
		} else {
			action = "is listing files in"
		}
		return fmt.Sprintf("### Cline %s `%s`", action, tool.Path)

	case string(types.ToolTypeListFilesRecursive):
		if verbTense == "wants to" {
			action = "wants to recursively list files in"
		} else {
			action = "is recursively listing files in"
		}
		return fmt.Sprintf("### Cline %s `%s`", action, tool.Path)

	case string(types.ToolTypeSearchFiles):
		if tool.Regex != "" && tool.Path != "" {
			if verbTense == "wants to" {
				action = "wants to search for"
			} else {
				action = "is searching for"
			}
			return fmt.Sprintf("### Cline %s `%s` in `%s`", action, tool.Regex, tool.Path)
		} else if tool.Regex != "" {
			if verbTense == "wants to" {
				action = "wants to search for"
			} else {
				action = "is searching for"
			}
			return fmt.Sprintf("### Cline %s `%s`", action, tool.Regex)
		} else {
			if verbTense == "wants to" {
				return "### Cline wants to search files"
			} else {
				return "### Cline is searching files"
			}
		}

	case string(types.ToolTypeWebFetch):
		if verbTense == "wants to" {
			action = "wants to fetch"
		} else {
			action = "is fetching"
		}
		return fmt.Sprintf("### Cline %s `%s`", action, tool.Path)

	case string(types.ToolTypeWebSearch):
		if verbTense == "wants to" {
			action = "wants to search for"
		} else {
			action = "is searching for"
		}
		return fmt.Sprintf("### Cline %s `%s`", action, tool.Path)

	case string(types.ToolTypeListCodeDefinitionNames):
		if verbTense == "wants to" {
			action = "wants to list code definitions in"
		} else {
			action = "is listing code definitions in"
		}
		return fmt.Sprintf("### Cline %s `%s`", action, tool.Path)

	case string(types.ToolTypeSummarizeTask):
		if verbTense == "wants to" {
			return "### Cline wants to condense the conversation"
		} else {
			return "### Cline condensed the conversation"
		}

	default:
		if verbTense == "wants to" {
			verb = "wants to use"
		} else {
			verb = "is using"
		}
		return fmt.Sprintf("### Cline %s tool: %s", verb, tool.Tool)
	}
}

// GenerateToolContentPreview generates content preview for approval requests
func (tr *ToolRenderer) GenerateToolContentPreview(tool *types.ToolMessage) string {
	if tool.Content == "" {
		return ""
	}

	switch tool.Tool {
	case string(types.ToolTypeEditedExistingFile):
		// Show diff for edits
		diffMarkdown := fmt.Sprintf("```diff\n%s\n```", tool.Content)
		return tr.renderMarkdown(diffMarkdown)

	case string(types.ToolTypeNewFileCreated):
		// Show content preview for new files (truncated)
		preview := strings.TrimSpace(tool.Content)
		if len(preview) > 500 {
			preview = preview[:500] + "..."
		}
		previewMd := fmt.Sprintf("```\n%s\n```", preview)
		return tr.renderMarkdown(previewMd)

	case string(types.ToolTypeReadFile), string(types.ToolTypeWebFetch), string(types.ToolTypeWebSearch), string(types.ToolTypeFileDeleted):
		// No preview for read/fetch/search operations
		return ""

	default:
		// For other tools, show truncated content if available
		preview := strings.TrimSpace(tool.Content)
		if len(preview) > 200 {
			preview = preview[:200] + "..."
		}
		if preview != "" {
			return fmt.Sprintf("Preview: %s", preview)
		}
		return ""
	}
}

// GenerateToolContentBody generates full content for completed executions
func (tr *ToolRenderer) GenerateToolContentBody(tool *types.ToolMessage) string {
	if tool.Content == "" {
		return ""
	}

	// Use enhanced tool result parser for supported tools
	toolParser := NewToolResultParser(tr.mdRenderer)

	switch tool.Tool {
	case string(types.ToolTypeReadFile),
		string(types.ToolTypeFileDeleted):
		// readFile: show header only, no body
		return ""

	case string(types.ToolTypeListFilesTopLevel),
		string(types.ToolTypeListFilesRecursive),
		string(types.ToolTypeListCodeDefinitionNames),
		string(types.ToolTypeSearchFiles),
		string(types.ToolTypeWebFetch),
		string(types.ToolTypeWebSearch):
		// Use parser for structured output
		preview := toolParser.ParseToolResult(tool)
		return tr.renderMarkdown(preview)

	case string(types.ToolTypeEditedExistingFile):
		// Show the diff
		diffMarkdown := fmt.Sprintf("```diff\n%s\n```", tool.Content)
		return tr.renderMarkdown(diffMarkdown)

	case string(types.ToolTypeNewFileCreated):
		// Show file content preview
		preview := strings.TrimSpace(tool.Content)
		if len(preview) > 1000 {
			preview = preview[:1000] + "..."
		}
		contentMd := fmt.Sprintf("```\n%s\n```", preview)
		return tr.renderMarkdown(contentMd)

	default:
		// For unknown tools, show content as-is
		if len(tool.Content) > 500 {
			return tool.Content[:500] + "..."
		}
		return tool.Content
	}
}

// RenderCommandApprovalRequest renders a command approval request
func (tr *ToolRenderer) RenderCommandApprovalRequest(command string, autoApprovalConflict bool) string {
	var output strings.Builder

	// Clean command
	command = strings.TrimSpace(command)
	if strings.HasSuffix(command, "REQ_APP") {
		command = strings.TrimSuffix(command, "REQ_APP")
		command = strings.TrimSpace(command)
		autoApprovalConflict = true
	}

	// Generate header
	header := fmt.Sprintf("### Cline wants to run `%s`", command)
	rendered := tr.renderMarkdown(header)
	output.WriteString(rendered)
	output.WriteString("\n")

	// Show command in code block
	cmdBlock := fmt.Sprintf("```shell\n%s\n```", command)
	cmdRendered := tr.renderMarkdown(cmdBlock)
	output.WriteString("\n")
	output.WriteString(cmdRendered)

	// Add warning if needed
	if autoApprovalConflict {
		output.WriteString("\nWARNING: The model has determined this command requires explicit approval.\n")
	}

	return output.String()
}

// RenderCommandExecution renders a command execution announcement
func (tr *ToolRenderer) RenderCommandExecution(command string) string {
	command = strings.TrimSpace(command)
	header := fmt.Sprintf("### Cline is running `%s`", command)
	rendered := tr.renderMarkdown(header)
	return "\n" + rendered + "\n"
}

// RenderCommandOutput renders command output
func (tr *ToolRenderer) RenderCommandOutput(output string) string {
	var result strings.Builder

	header := "### Terminal output"
	rendered := tr.renderMarkdown(header)
	result.WriteString("\n")
	result.WriteString(rendered)
	result.WriteString("\n\n")

	// Show output in code block
	outputBlock := fmt.Sprintf("```\n%s\n```", strings.TrimSpace(output))
	outputRendered := tr.renderMarkdown(outputBlock)
	result.WriteString(outputRendered)
	result.WriteString("\n")

	return result.String()
}

// RenderUserResponse renders user approval/rejection feedback
func (tr *ToolRenderer) RenderUserResponse(approved bool, feedback string) string {
	var symbol, status string

	if approved {
		symbol = "✓"
		status = "Approved"
	} else {
		symbol = "✗"
		status = "Rejected"
	}

	if feedback != "" {
		return fmt.Sprintf("%s %s with feedback: %s\n", symbol, status, feedback)
	}
	return fmt.Sprintf("%s %s\n", symbol, status)
}

// renderMarkdown renders markdown if not in plain mode and in a TTY
func (tr *ToolRenderer) renderMarkdown(markdown string) string {
	// Skip markdown rendering if plain mode or not in TTY
	if tr.outputFormat == "plain" || !isTTY() {
		return markdown
	}

	if tr.mdRenderer == nil {
		return markdown
	}

	rendered, err := tr.mdRenderer.Render(markdown)
	if err != nil {
		return markdown
	}

	return rendered
}

// GenerateAskFollowupHeader generates the header for followup questions
func (tr *ToolRenderer) GenerateAskFollowupHeader() string {
	return "### Cline has a question\n"
}

// GenerateAskFollowupBody generates the body content for followup questions
func (tr *ToolRenderer) GenerateAskFollowupBody(messageText string) string {
	var question string
	var options []string

	// Try to parse as JSON
	var askData types.AskData
	if err := json.Unmarshal([]byte(messageText), &askData); err == nil {
		question = askData.Question
		options = askData.Options
	} else {
		question = messageText
	}

	if question == "" {
		return ""
	}

	// Build the body
	var body strings.Builder

	// Render the question
	rendered := tr.renderMarkdown(question)
	body.WriteString(rendered)

	// Add options if available
	if len(options) > 0 {
		body.WriteString("\n\nOptions:\n")
		for i, option := range options {
			body.WriteString(fmt.Sprintf("%d. %s\n", i+1, option))
		}
	}

	return body.String()
}

// GeneratePlanModeRespondHeader generates the header for plan mode responses
func (tr *ToolRenderer) GeneratePlanModeRespondHeader() string {
	return "### Cline has a plan\n"
}

// GeneratePlanModeRespondBody generates the body content for plan mode responses
func (tr *ToolRenderer) GeneratePlanModeRespondBody(messageText string) string {
	var response string
	var options []string

	// Try to parse as JSON
	type PlanModeResponse struct {
		Response string   `json:"response"`
		Options  []string `json:"options,omitempty"`
	}

	var planData PlanModeResponse
	if err := json.Unmarshal([]byte(messageText), &planData); err == nil {
		response = planData.Response
		options = planData.Options
	} else {
		response = messageText
	}

	if response == "" {
		return ""
	}

	// Build the body
	var body strings.Builder

	// Render the response
	rendered := tr.renderMarkdown(response)
	body.WriteString(rendered)

	// Add options if available
	if len(options) > 0 {
		body.WriteString("\n\nOptions:\n")
		for i, option := range options {
			body.WriteString(fmt.Sprintf("%d. %s\n", i+1, option))
		}
	}

	return body.String()
}
