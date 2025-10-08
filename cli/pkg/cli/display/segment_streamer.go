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

	// Clear previous render if exists
	if ss.lastLineCount > 0 {
		ClearLines(ss.lastLineCount)
	}

	// Print new render and track actual printed lines
	if !strings.HasSuffix(rendered, "\n") {
		fmt.Print(rendered)
		fmt.Println()
		// Track: rendered lines + the newline we just added
		ss.lastLineCount = ss.mdRenderer.CountLines(rendered) + 1
	} else {
		fmt.Print(rendered)
		// Track: just the rendered lines (already includes newline)
		ss.lastLineCount = ss.mdRenderer.CountLines(rendered)
	}

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
