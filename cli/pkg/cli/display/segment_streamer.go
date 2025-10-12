package display

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"

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
	
	// Render rich header immediately when creating segment (if in rich mode)
	if shouldMarkdown && outputFormat != "plain" {
		header := ss.generateRichHeader()
		rendered, _ := mdRenderer.Render(header)
		fmt.Println()
		fmt.Print(rendered)
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
	// For ASK messages, handle based on ask type
	text := currentBuffer
	if ss.sayType == "ask" {
		// For tool approvals, render tool content (diff, file content, etc.)
		if ss.msg.Ask == string(types.AskTypeTool) {
			var tool types.ToolMessage
			if err := json.Unmarshal([]byte(currentBuffer), &tool); err == nil {
				// Render tool-specific content
				switch tool.Tool {
				case "editedExistingFile":
					// Show the diff (stored in Content field)
					if tool.Content != "" {
						text = "```diff\n" + tool.Content + "\n```"
					} else {
						return  // No diff, just header
					}

				case "readFile":
					// Show file content preview
					if tool.Content != "" {
						text = "```\n" + tool.Content + "\n```"
					} else {
						return  // No content preview
					}

				case "newFileCreated":
					// Show new file content
					if tool.Content != "" {
						text = "```\n" + tool.Content + "\n```"
					} else {
						return  // No content
					}

				default:
					// Other tools: no body content needed
					return
				}
			}
		} else {
			// For other ASK types (questions, etc.), parse as AskData
			var askData types.AskData
			if err := json.Unmarshal([]byte(currentBuffer), &askData); err == nil {
				// Use the response field as the text to render
				text = askData.Response

				// Add options if available
				if len(askData.Options) > 0 {
					text += "\n\nOptions:\n"
					for i, option := range askData.Options {
						text += fmt.Sprintf("%d. %s\n", i+1, option)
					}
				}
			}
		}
	}
	
	// For tools, parse JSON and render with enhanced formatting
	if ss.sayType == string(types.SayTypeTool) {
		var tool types.ToolMessage
		if err := json.Unmarshal([]byte(currentBuffer), &tool); err == nil {
			// Use tool parser for enhanced rendering
			switch tool.Tool {
			case "listFilesTopLevel", "listFilesRecursive",
			     "listCodeDefinitionNames", "searchFiles", "webFetch":
				// Use enhanced tool result parser for final render
				text = ss.toolParser.ParseToolResult(&tool)
			
			case "readFile":
				// readFile: show header only, no body
				return
			
			case "editedExistingFile":
				// Show the diff (stored in Content field)
				if tool.Content != "" {
					text = "```diff\n" + tool.Content + "\n```"
				} else {
					return  // No diff, just header
				}
			
			default:
				// Other tools: suppress JSON body for now
				return
			}
		}
	}

	if ss.sayType == string(types.SayTypeCommand) {
		text = "```shell\n" + text + "\n```"
	}

	var rendered string
	if ss.shouldMarkdown && ss.outputFormat != "plain" {
		var err error
		rendered, err = ss.mdRenderer.Render(text)
		if err != nil {
			rendered = ss.prefix + ": " + currentBuffer
		}
	} else {
		rendered = ss.prefix + ": " + currentBuffer
	}

	// Print final render once (no clearing needed, header already printed)
	if !strings.HasSuffix(rendered, "\n") {
		fmt.Print(rendered)
		fmt.Println()
	} else {
		fmt.Print(rendered)
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
			return "### Cline has a plan\n"
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

		// For other ask types (questions, etc.), show generic message
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
