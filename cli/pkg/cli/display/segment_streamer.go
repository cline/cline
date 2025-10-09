package display

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/cline/cli/pkg/cli/types"
)

type StreamingSegment struct {
	mu              sync.Mutex
	sayType         string
	prefix          string
	buffer          strings.Builder
	lastRendered    string
	lastBuffer      string
	lastAppended    string
	lastLineCount   int
	timer           *time.Timer
	frozen          bool
	mdRenderer      *MarkdownRenderer
	shouldMarkdown  bool
	outputFormat    string
	msg             *types.ClineMessage
}

func NewStreamingSegment(sayType, prefix string, mdRenderer *MarkdownRenderer, shouldMarkdown bool, msg *types.ClineMessage, outputFormat string) *StreamingSegment {
	ss := &StreamingSegment{
		sayType:        sayType,
		prefix:         prefix,
		mdRenderer:     mdRenderer,
		shouldMarkdown: shouldMarkdown,
		outputFormat:   outputFormat,
		msg:            msg,
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

	if ss.timer != nil {
		ss.timer.Stop()
	}

	ss.timer = time.AfterFunc(150*time.Millisecond, func() {
		ss.Render()
	})
}

func (ss *StreamingSegment) Render() error {
	ss.mu.Lock()
	defer ss.mu.Unlock()

	if ss.frozen {
		return nil
	}

	currentBuffer := ss.buffer.String()
	if currentBuffer == ss.lastBuffer {
		return nil
	}

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
	
	// For tools, parse JSON and decide what to show
	if ss.sayType == string(types.SayTypeTool) {
		var tool types.ToolMessage
		if err := json.Unmarshal([]byte(currentBuffer), &tool); err == nil {
			// Tools that show no body - header is sufficient
			switch tool.Tool {
			case "readFile", "listFilesTopLevel", "listFilesRecursive", 
			     "listCodeDefinitionNames", "searchFiles", "webFetch":
				return nil  // Skip body rendering, header already shown
			
			case "editedExistingFile":
				// Show the diff (stored in Content field)
				if tool.Content != "" {
					text = "```diff\n" + tool.Content + "\n```"
				} else {
					return nil  // No diff yet, just show header
				}
			
			default:
				// Other tools: suppress JSON body for now
				return nil
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

	// Calculate new line count
	newLineCount := ss.mdRenderer.CountLines(rendered)
	if !strings.HasSuffix(rendered, "\n") {
		newLineCount++
	}

	// LIVE markdown rendering
	// Clear previous render (if any)
	if ss.lastLineCount > 0 {
		ClearLines(ss.lastLineCount)
	} else {
		// First render - add blank line before segment
		fmt.Println()
	}

	// Print live markdown
	fmt.Print(rendered)
	
	// Track how many lines we actually printed (not including any trailing newline we might add)
	actualLines := strings.Count(rendered, "\n")
	
	// Add final newline if needed
	if !strings.HasSuffix(rendered, "\n") {
		fmt.Println()
		actualLines++ // Count the newline we just added
	}
	
	// Save this for next clear
	ss.lastLineCount = actualLines

	// Update state
	ss.lastRendered = rendered
	ss.lastBuffer = currentBuffer

	return nil
}

func (ss *StreamingSegment) Freeze() {
	ss.mu.Lock()

	if ss.frozen {
		ss.mu.Unlock()
		return
	}

	if ss.timer != nil {
		ss.timer.Stop()
		ss.timer = nil
	}

	ss.frozen = true
	currentBuffer := ss.buffer.String()
	needsRender := currentBuffer != ss.lastBuffer

	ss.mu.Unlock()

	if needsRender {
		ss.renderFinal(currentBuffer)
	}
}

func (ss *StreamingSegment) renderFinal(currentBuffer string) {
	ss.mu.Lock()
	defer ss.mu.Unlock()

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
	
	// For tools, parse JSON and decide what to show
	if ss.sayType == string(types.SayTypeTool) {
		var tool types.ToolMessage
		if err := json.Unmarshal([]byte(currentBuffer), &tool); err == nil {
			// Tools that show no body - header is sufficient
			switch tool.Tool {
			case "readFile", "listFilesTopLevel", "listFilesRecursive",
			     "listCodeDefinitionNames", "searchFiles", "webFetch":
				// No final render needed, header already shown
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

	if ss.lastLineCount > 0 {
		ss.clearPrevious()
	}

	// Print final render (frozen segments stay permanent)
	if !strings.HasSuffix(rendered, "\n") {
		fmt.Print(rendered)
		fmt.Println()
	} else {
		fmt.Print(rendered)
	}

	ss.lastRendered = rendered
	ss.lastBuffer = currentBuffer
	// No need to track line count after freeze - segment is permanent
	ss.lastLineCount = 0
}

func (ss *StreamingSegment) clearPrevious() {
	ClearLines(ss.lastLineCount)
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
		return "### Cline has a plan\n"
		
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
		
	default:
		return fmt.Sprintf("### Tool: %s\n", tool.Tool)
	}
}
