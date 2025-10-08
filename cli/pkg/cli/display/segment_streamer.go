package display

import (
	"fmt"
	"strings"
	"sync"
	"time"
)

type StreamingSegment struct {
	mu              sync.Mutex
	messageType     string
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
}

func NewStreamingSegment(messageType, prefix string, mdRenderer *MarkdownRenderer, shouldMarkdown bool) *StreamingSegment {
	return &StreamingSegment{
		messageType:    messageType,
		prefix:         prefix,
		mdRenderer:     mdRenderer,
		shouldMarkdown: shouldMarkdown,
	}
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

	text := currentBuffer

	if ss.messageType == "CMD" {
		text = "```shell\n" + text + "\n```"
	}

	var rendered string
	if ss.shouldMarkdown {
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

	text := currentBuffer

	if ss.messageType == "CMD" {
		text = "```shell\n" + text + "\n```"
	}

	var rendered string
	if ss.shouldMarkdown {
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
