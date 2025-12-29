package display

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"

	"github.com/cline/cli/pkg/cli/output"
	"github.com/cline/cli/pkg/cli/types"
)

type StreamingSegment struct {
	mu             sync.Mutex
	sayType        string
	prefix         string
	buffer         strings.Builder
	frozen         bool
	mdRenderer     *MarkdownRenderer
	toolRenderer   *ToolRenderer
	shouldMarkdown bool
	outputFormat   string
	msg            *types.ClineMessage
	toolParser     *ToolResultParser
}

func NewStreamingSegment(sayType, prefix string, mdRenderer *MarkdownRenderer, shouldMarkdown bool, msg *types.ClineMessage, outputFormat string) *StreamingSegment {
	ss := &StreamingSegment{
		sayType:        sayType,
		prefix:         prefix,
		mdRenderer:     mdRenderer,
		toolRenderer:   NewToolRenderer(mdRenderer, outputFormat),
		shouldMarkdown: shouldMarkdown,
		outputFormat:   outputFormat,
		msg:            msg,
		toolParser:     NewToolResultParser(mdRenderer),
	}

	// Render rich header immediately when creating segment (if in rich mode and TTY)
	if shouldMarkdown && outputFormat != "plain" && isTTY() {
		header := ss.generateRichHeader()
		rendered, _ := mdRenderer.Render(header)
		output.Println("")
		output.Print(rendered)
	}

	return ss
}

func (ss *StreamingSegment) AppendText(text string) {
	ss.mu.Lock()
	defer ss.mu.Unlock()

	if ss.frozen {
		return
	}

	// Replace buffer with FULL text - msg.Text contains complete accumulated content
	ss.buffer.Reset()
	ss.buffer.WriteString(text)
	
	// No rendering during streaming - we'll render once on Freeze()
}


func (ss *StreamingSegment) Freeze() {
	ss.mu.Lock()
	defer ss.mu.Unlock()

	if ss.frozen {
		return
	}

	ss.frozen = true
	currentBuffer := ss.buffer.String()
	
	// Render and print the final markdown
	ss.renderFinal(currentBuffer)
}

func (ss *StreamingSegment) renderFinal(currentBuffer string) {
	var bodyContent string

	// Use ToolRenderer for all body rendering to centralize logic
	if ss.sayType == "ask" {
		// Handle ASK messages
		if ss.msg.Ask == string(types.AskTypeTool) {
			// Tool approval: use ToolRenderer for body
			var tool types.ToolMessage
			if err := json.Unmarshal([]byte(currentBuffer), &tool); err == nil {
				// For approval requests in streaming, use the preview method
				bodyContent = ss.toolRenderer.GenerateToolContentPreview(&tool)
			}
		} else if ss.msg.Ask == string(types.AskTypeFollowup) {
			// Followup question: use ToolRenderer
			bodyContent = ss.toolRenderer.GenerateAskFollowupBody(currentBuffer)
		} else if ss.msg.Ask == string(types.AskTypePlanModeRespond) {
			// Plan mode respond: use ToolRenderer
			bodyContent = ss.toolRenderer.GeneratePlanModeRespondBody(currentBuffer)
		} else if ss.msg.Ask == string(types.AskTypeCommand) {
			// Command approval: no body needed - header shows command, output shown separately later
			bodyContent = ""
		} else {
			// For other ask types, render as-is
			bodyContent = currentBuffer
		}
	} else if ss.sayType == string(types.SayTypeTool) {
		// Tool execution (SAY): use ToolRenderer for body
		var tool types.ToolMessage
		if err := json.Unmarshal([]byte(currentBuffer), &tool); err == nil {
			bodyContent = ss.toolRenderer.GenerateToolContentBody(&tool)
		}
	} else if ss.sayType == string(types.SayTypeCommand) {
		// Command output
		bodyContent = "```shell\n" + currentBuffer + "\n```"
		// Render markdown only in rich mode and TTY
		if ss.shouldMarkdown && ss.outputFormat != "plain" && isTTY() {
			rendered, err := ss.mdRenderer.Render(bodyContent)
			if err == nil {
				bodyContent = rendered
			}
		}
	} else {
		// For other types (reasoning, text, etc.), render markdown as-is
		if ss.shouldMarkdown && ss.outputFormat != "plain" && isTTY() {
			rendered, err := ss.mdRenderer.Render(currentBuffer)
			if err == nil {
				bodyContent = rendered
			} else {
				bodyContent = currentBuffer
			}
		} else {
			bodyContent = currentBuffer
		}
	}

	// Print the body content
	if bodyContent != "" {
		if !strings.HasSuffix(bodyContent, "\n") {
			output.Print(bodyContent)
			output.Println("")
		} else {
			output.Print(bodyContent)
		}
	}
}


// generateRichHeader generates a contextual header for the segment
func (ss *StreamingSegment) generateRichHeader() string {
	switch ss.sayType {
	case string(types.SayTypeReasoning):
		return "### Cline is thinking\n"
		
	case string(types.SayTypeText):
		return "### Cline responds\n"
		
	case string(types.SayTypeCompletionResult):
		return "### Task completed\n"
		
	case string(types.SayTypeTool):
		return ss.generateToolHeader()
		
	case "ask":
		// Check the specific ask type
		if ss.msg.Ask == string(types.AskTypePlanModeRespond) {
			return ss.toolRenderer.GeneratePlanModeRespondHeader()
		}

		// For tool approvals, show proper tool header
		if ss.msg.Ask == string(types.AskTypeTool) {
			var tool types.ToolMessage
			if err := json.Unmarshal([]byte(ss.msg.Text), &tool); err == nil {
				// Use ToolRenderer for approval header with "wants to" verbs
				return ss.toolRenderer.RenderToolApprovalHeader(&tool)
			}
		}

		// For command approvals, show command header
		if ss.msg.Ask == string(types.AskTypeCommand) {
			command := strings.TrimSpace(ss.msg.Text)
			if strings.HasSuffix(command, "REQ_APP") {
				command = strings.TrimSuffix(command, "REQ_APP")
				command = strings.TrimSpace(command)
			}
			return fmt.Sprintf("### Cline wants to run `%s`\n", command)
		}

		// For followup questions, show question header
		if ss.msg.Ask == string(types.AskTypeFollowup) {
			return ss.toolRenderer.GenerateAskFollowupHeader()
		}

		// For other ask types, show generic message
		return fmt.Sprintf("### Cline is asking (%s)\n", ss.msg.Ask)
		
	default:
		return fmt.Sprintf("### %s\n", ss.prefix)
	}
}

// generateToolHeader generates a contextual header for tool operations
func (ss *StreamingSegment) generateToolHeader() string {
	// Parse tool JSON from message text
	var tool types.ToolMessage
	if err := json.Unmarshal([]byte(ss.msg.Text), &tool); err != nil {
		return "### Tool operation\n"
	}

	// Use unified ToolRenderer for header
	return ss.toolRenderer.RenderToolExecutionHeader(&tool)
}
