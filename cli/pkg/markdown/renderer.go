package markdown

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"strings"
	"sync"

	"github.com/charmbracelet/glamour"
)

// StreamRenderer handles ChatGPT-style hybrid streaming:
// 1. Shows plain text immediately (character-by-character)
// 2. Freezes completed blocks with styling (no jumping)
// 3. Only streams new plain text for incomplete blocks
type StreamRenderer struct {
	mu                sync.Mutex
	glamour           *glamour.TermRenderer
	ctx               context.Context
	cancel            context.CancelFunc
	frozenOutput      string       // Completed, styled blocks (immutable)
	currentBlock      bytes.Buffer // Current block being streamed (plain text)
	allText           bytes.Buffer // Full accumulated text for context
	plainCharsWritten int          // Number of plain chars displayed in current block
	inputDebug        *os.File
}

// NewStreamRenderer creates a new streaming markdown renderer
func NewStreamRenderer() (*StreamRenderer, error) {
	// Create Glamour renderer
	renderer, err := glamour.NewTermRenderer(
		glamour.WithStylePath("dark"),
		glamour.WithWordWrap(80),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create glamour renderer: %w", err)
	}

	ctx, cancel := context.WithCancel(context.Background())

	sr := &StreamRenderer{
		glamour: renderer,
		ctx:     ctx,
		cancel:  cancel,
	}

	// Enable debug logging if CLINE_MARKDOWN_DEBUG env var is set
	if os.Getenv("CLINE_MARKDOWN_DEBUG") != "" {
		debugPath := os.Getenv("CLINE_MARKDOWN_DEBUG")
		if inputFile, err := os.Create(debugPath + ".input.md"); err == nil {
			sr.inputDebug = inputFile
		}
	}

	return sr, nil
}

// WriteIncremental implements ChatGPT-style block-based streaming:
// 1. Show plain text immediately
// 2. Freeze completed blocks (no re-rendering)
// 3. Only re-render current incomplete block
func (sr *StreamRenderer) WriteIncremental(text string) error {
	sr.mu.Lock()
	defer sr.mu.Unlock()

	// Log input
	if sr.inputDebug != nil {
		sr.inputDebug.WriteString(text)
	}

	// Append to all text for full context
	sr.allText.WriteString(text)
	
	// Append to current block
	sr.currentBlock.WriteString(text)

	// Show plain text immediately (ChatGPT-style)
	fmt.Print(text)
	sr.plainCharsWritten += len(text)

	// Check if we should freeze this block and re-render
	if sr.shouldFreezeBlock(text) {
		sr.freezeCurrentBlock()
	}

	return nil
}

// shouldFreezeBlock determines if we should freeze the current block
// This happens at logical boundaries like paragraph breaks
func (sr *StreamRenderer) shouldFreezeBlock(newText string) bool {
	currentBlockText := sr.currentBlock.String()
	
	// Freeze on double newline (paragraph break)
	if strings.HasSuffix(currentBlockText, "\n\n") {
		return true
	}
	
	// Freeze on closing code block
	if strings.HasSuffix(currentBlockText, "```\n") {
		// Count code fences in current block
		fenceCount := strings.Count(currentBlockText, "```")
		if fenceCount >= 2 && fenceCount%2 == 0 {
			return true
		}
	}
	
	// Freeze every ~5 lines to keep blocks manageable
	lineCount := strings.Count(currentBlockText, "\n")
	if lineCount >= 5 {
		return true
	}
	
	return false
}

// freezeCurrentBlock renders the current block and adds it to frozen output
func (sr *StreamRenderer) freezeCurrentBlock() {
	if sr.currentBlock.Len() == 0 {
		return
	}

	// Clear the plain text we just printed
	plainText := sr.currentBlock.String()
	lineCount := strings.Count(plainText, "\n")
	
	if lineCount > 0 {
		// Move cursor up to start of current block
		fmt.Printf("\033[%dA", lineCount)
		// Clear from cursor down
		fmt.Print("\033[J")
	} else {
		// Clear current line
		fmt.Print("\r\033[K")
	}

	// Render the full context (frozen + current) to get correct styling
	fullText := sr.frozenOutput + sr.currentBlock.String()
	rendered, err := sr.glamour.Render(fullText)
	if err != nil {
		// Fallback: keep plain text
		fmt.Print(sr.frozenOutput)
		fmt.Print(plainText)
		sr.currentBlock.Reset()
		sr.plainCharsWritten = 0
		return
	}

	// Print the fully rendered output
	fmt.Print(rendered)
	
	// Update frozen output to include this block
	sr.frozenOutput = fullText
	
	// Reset current block
	sr.currentBlock.Reset()
	sr.plainCharsWritten = 0
}

// FlushMessage completes the current message with final markdown render
func (sr *StreamRenderer) FlushMessage() error {
	sr.mu.Lock()
	defer sr.mu.Unlock()

	// Freeze any remaining content in current block
	if sr.currentBlock.Len() > 0 {
		sr.freezeCurrentBlock()
	}
	
	// Add separator
	fmt.Println()
	
	// Reset everything
	sr.frozenOutput = ""
	sr.currentBlock.Reset()
	sr.allText.Reset()
	sr.plainCharsWritten = 0

	return nil
}

// Close shuts down the streaming renderer gracefully
func (sr *StreamRenderer) Close() error {
	sr.cancel()
	
	if sr.inputDebug != nil {
		sr.inputDebug.Close()
	}
	
	return nil
}
