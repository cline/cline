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
	// For ASK messages, parse JSON and extract response field
	text := currentBuffer
	if ss.sayType == "ask" {
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
		// For other ask types (tool approvals, questions, etc.), show the ask type
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
	
	switch tool.Tool {
	case "readFile":
		if tool.Path != "" {
			return fmt.Sprintf("### Cline is reading `%s`\n", tool.Path)
		}
		return "### Cline is reading a file\n"
		
	case "writeFile", "newFileCreated":
		if tool.Path != "" {
			return fmt.Sprintf("### Cline is writing `%s`\n", tool.Path)
		}
		return "### Cline is writing a file\n"
		
	case "editedExistingFile":
		if tool.Path != "" {
			return fmt.Sprintf("### Cline is editing `%s`\n", tool.Path)
		}
		return "### Cline is editing a file\n"
		
	case "searchFiles":
		if tool.Regex != "" && tool.Path != "" {
			return fmt.Sprintf("### Cline is searching for `%s` in `%s`\n", tool.Regex, tool.Path)
		} else if tool.Regex != "" {
			return fmt.Sprintf("### Cline is searching for `%s`\n", tool.Regex)
		}
		return "### Cline is searching files\n"
		
	case "listFilesTopLevel":
		if tool.Path != "" {
			return fmt.Sprintf("### Cline is listing files in `%s`\n", tool.Path)
		}
		return "### Cline is listing files\n"
		
	case "listFilesRecursive":
		if tool.Path != "" {
			return fmt.Sprintf("### Cline is recursively listing files in `%s`\n", tool.Path)
		}
		return "### Cline is recursively listing files\n"
		
	case "listCodeDefinitionNames":
		if tool.Path != "" {
			return fmt.Sprintf("### Cline is listing code definitions in `%s`\n", tool.Path)
		}
		return "### Cline is listing code definitions\n"
		
	case "webFetch":
		if tool.Path != "" {
			return fmt.Sprintf("### Cline is fetching `%s`\n", tool.Path)
		}
		return "### Cline is fetching a URL\n"
		
	default:
		return fmt.Sprintf("### Tool: %s\n", tool.Tool)
	}
}
