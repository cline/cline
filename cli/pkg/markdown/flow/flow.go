// Package flow provides memory-efficient streaming markdown rendering with configurable flow control.
//
// The flow package enables processing large markdown files without loading them entirely into memory.
// It supports three flow modes for different use cases:
//
//   - Unbuffered (-1): Aggressive flushing at safe boundaries for minimal latency
//   - Buffered (0): Maximum buffering until EOF for optimal throughput
//   - Windowed (N): Bounded buffering with N-byte window for balanced performance
//
// Key features:
//   - Smart boundary detection to avoid breaking markdown structures
//   - Code fence awareness to prevent splitting within code blocks
//   - YAML frontmatter detection and proper handling
//   - Buffer overflow protection with configurable limits
//   - Production-ready error handling and resource management
//
// Example usage:
//
//	render := func(data []byte) ([]byte, error) {
//		// Your markdown renderer (e.g., glamour)
//		return glamour.Render(string(data))
//	}
//
//	err := Flow(ctx, reader, writer, 0, render) // Buffered mode
//	if err != nil {
//		log.Fatal(err)
//	}
package flow
import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"syscall"
)
const (
	// Core modes
	Unbuffered = -1      // Aggressive flushing at boundaries
	Buffered   = 0       // No flushing until EOF
	Windowed   = 1048576 // 1 MiB max buffer length
)
// RenderFunc is a function that renders markdown to output bytes
type RenderFunc func(data []byte) ([]byte, error)
// Config configures the streaming buffer behavior
type Config struct {
	Window int64      // -1: minimal buffering (aggressive flush), 0: maximum buffering (no flush until EOF), N: bounded at N bytes
	Render RenderFunc // glamour renderer (byte-based)
}
// Validate checks config parameters for safety
func (c Config) Validate() error {
	if c.Render == nil {
		return errors.New("render function cannot be nil")
	}
	if c.Window > Windowed {
		return fmt.Errorf("window size %d exceeds maximum %d", c.Window, Windowed)
	}
	if c.Window < -1 {
		return fmt.Errorf("invalid window size %d (must be >= -1)", c.Window)
	}
	return nil
}
// Buffer handles incremental markdown rendering with configurable buffering
type Buffer struct {
	config       Config
	writer       io.Writer // output writer
	accum        []byte    // accumulated markdown
	written      int64     // total bytes written
	hadSplits    bool      // track if we actually split at buffer boundaries
	pendingBlank []byte    // deferred glamour blank lines awaiting context
	offset       int       // -1 unknown, 0 none, >0 end index of detected frontmatter
	// Fence tracking for smart boundaries
	inFence   bool // currently inside ``` code fence
	lastFence int  // Track position where fence closed
	postFence bool // Just exited a fence block
}
// NewBuffer creates a new streaming buffer with validated config
func NewBuffer(config Config, w io.Writer) (*Buffer, error) {
	if err := config.Validate(); err != nil {
		return nil, fmt.Errorf("invalid config: %w", err)
	}
	if w == nil {
		return nil, errors.New("writer cannot be nil")
	}
	return &Buffer{
		config:  config,
		writer:  w,
		accum:   make([]byte, 0, 4096), // 4 KiB standard initial buffer
		inFence: false,
		offset:  -1,
	}, nil
}
// calculateFenceState determines if we're inside a code fence for given data
// When resetFirst is true, it clears state before calculation (used after splits)
func (b *Buffer) calculateFenceState(data []byte, resetFirst bool) {
	if resetFirst {
		b.inFence = false
		b.postFence = false
	}
	lines := bytes.Split(data, []byte("\n"))
	position := 0
	for _, line := range lines {
		trimmed := bytes.TrimSpace(line)
		// Check for code fence markers (``` or ~~~)
		// Accept ``` or ~~~ optionally followed by language specifier
		if (len(trimmed) >= 3 && bytes.HasPrefix(trimmed, []byte("```"))) ||
			(len(trimmed) >= 3 && bytes.HasPrefix(trimmed, []byte("~~~"))) {
			wasInFence := b.inFence
			// Toggle fence state for standard triple-backtick fences
			b.inFence = !b.inFence
			// Track when we exit a fence
			if wasInFence && !b.inFence {
				b.postFence = true
				b.lastFence = position
			} else {
				b.postFence = false
			}
		}
		position += len(line) + 1 // +1 for newline
	}
}
// detectFrontmatter inspects the accumulator for YAML frontmatter and records where it ends.
func (b *Buffer) detectFrontmatter() {
	if b.offset != -1 {
		return
	}
	data := b.accum
	if len(data) == 0 {
		return
	}
	// First byte must be '-'
	if data[0] != '-' {
		b.offset = 0
		return
	}
	if len(data) < 3 {
		// Need at least "---"
		return
	}
	if !bytes.HasPrefix(data, []byte("---")) {
		b.offset = 0
		return
	}
	if len(data) < 4 {
		return
	}
	newlineIdx := 3
	if data[3] == '\r' {
		if len(data) < 5 || data[4] != '\n' {
			b.offset = 0
			return
		}
		newlineIdx = 4
	} else if data[3] != '\n' {
		b.offset = 0
		return
	}
	searchStart := newlineIdx + 1
	if idx := bytes.Index(data[searchStart:], []byte("\n---\n")); idx >= 0 {
		b.offset = searchStart + idx + 5
		return
	}
	if idx := bytes.Index(data[searchStart:], []byte("\n---")); idx >= 0 && searchStart+idx+4 == len(data) {
		b.offset = len(data)
		return
	}
	if int64(len(data)) >= Windowed {
		b.offset = 0
	}
}
// processContentSlice updates fence state and line length tracking for new content.
func (b *Buffer) processContentSlice(content []byte, currentLineLen *int) {
	if len(content) == 0 {
		return
	}
	b.calculateFenceState(content, false)
	if idx := bytes.LastIndexByte(content, '\n'); idx >= 0 {
		*currentLineLen = len(content) - idx - 1
	} else {
		*currentLineLen += len(content)
	}
	if *currentLineLen > Windowed {
		b.accum = append(b.accum, '\n')
		*currentLineLen = 0
	}
}
// handleData ingests new data into the accumulator, resolving frontmatter when possible.
func (b *Buffer) handleData(data []byte, currentLineLen *int) {
	if len(data) == 0 {
		return
	}
	// Buffer overflow protection
	if int64(len(b.accum))+int64(len(data)) > Windowed {
		// Force immediate flush to prevent buffer overflow
		if len(b.accum) > 0 {
			b.flushToSafeBoundary(true)
		}
		// If still too large after flush, truncate input
		if int64(len(b.accum))+int64(len(data)) > Windowed {
			maxAppend := Windowed - int64(len(b.accum))
			if maxAppend > 0 {
				data = data[:maxAppend]
			} else {
				return // Skip this data entirely
			}
		}
	}
	originalLen := len(b.accum)
	b.accum = append(b.accum, data...)
	if b.written == 0 && b.offset == -1 {
		b.detectFrontmatter()
		if b.offset > 0 && b.offset <= len(b.accum) {
			consumed := b.offset
			b.accum = b.accum[consumed:]
			if len(b.accum) > 0 {
				b.calculateFenceState(b.accum, true)
			}
			originalLen -= consumed
			if originalLen < 0 {
				originalLen = 0
			}
			b.offset = 0
		} else if b.offset == 0 {
			// No frontmatter detected
		} else {
			// Still buffering potential frontmatter
			return
		}
	}
	if len(b.accum) == 0 {
		return
	}
	if originalLen > len(b.accum) {
		originalLen = 0
	}
	content := b.accum[originalLen:]
	b.processContentSlice(content, currentLineLen)
}
// Process reads markdown from r and streams rendered output via Output callback
func (b *Buffer) Process(ctx context.Context, r io.Reader) error {
	if ctx.Err() != nil {
		// Distinguish between different cancellation types:
		// - context.Canceled: clean user cancellation → return nil
		// - context.DeadlineExceeded: timeout → return error for proper exit code
		if ctx.Err() == context.DeadlineExceeded {
			return ctx.Err() // Timeout needs error for exit code
		}
		if ctx.Err() == context.Canceled {
			return nil // Clean cancellation
		}
		return ctx.Err()
	}
	// Create cancellable context for this process
	processCtx, processCancel := context.WithCancel(ctx)
	defer processCancel() // Ensure goroutine cleanup
	// Channel for read results
	type readResult struct {
		data []byte
		err  error
	}
	// Buffer the channel to avoid blocking on send
	readChan := make(chan readResult, 1)
	currentLineLen := 0
	// Start goroutine to read from input
	go func() {
		defer close(readChan)
		// Simple read buffer
		buf := make([]byte, 4096) // 4 KiB standard buffer
		for {
			// Check for context cancellation before reading
			select {
			case <-processCtx.Done():
				return
			default:
			}
			n, err := r.Read(buf)
			if n > 0 {
				// Send copy of data to avoid race conditions
				data := make([]byte, n)
				copy(data, buf[:n])
				// Try to send with context check
				select {
				case <-processCtx.Done():
					return
				case readChan <- readResult{data: data, err: err}:
				}
			}
			// If we have an error (including EOF), send it
			// Note: n > 0 with err != nil is valid (e.g., last read before EOF)
			if err != nil {
				// If we already sent data with the error above, don't send again
				if n == 0 {
					select {
					case <-processCtx.Done():
						return
					case readChan <- readResult{err: err}:
					}
				}
				return // Exit loop on any error including EOF
			}
		}
	}()
	// Main processing loop
	for {
		select {
		case <-processCtx.Done():
			// Context cancelled - flush accumulated content
			// Tests expect partial output to be rendered on interrupt
			// Use flush(false) to avoid glamour's EOF double-newline
			if len(b.accum) > 0 {
				if err := b.flush(); err != nil {
					return err
				}
			}
			if err := b.flushPendingPartial(); err != nil {
				return err
			}
			return nil
		case result, ok := <-readChan:
			if !ok {
				// Channel closed unexpectedly
				if len(b.accum) > 0 {
					return b.flush()
				}
				return nil
			}
			// Process the data
			if len(result.data) > 0 {
				b.handleData(result.data, &currentLineLen)
				if b.written == 0 && b.offset == -1 {
					continue
				}
				bufferSize := int64(len(b.accum))
				// Force flush if we exceed hard limit
				// This is a safety net to prevent OOM from unbounded input
				// In normal operation, shouldFlush() and flushToSafeBoundary() handle this
				if bufferSize > Windowed {
					b.flushToSafeBoundary(true)
				} else if b.shouldFlush() {
					// Force flush if we've accumulated way too much
					force := b.config.Window > Buffered && bufferSize > b.config.Window*2
					if err := b.flushToSafeBoundary(force); err != nil {
						return fmt.Errorf("opportunistic flush failed: %w", err)
					}
				}
				// Hard limit enforcement - split pathological input at safe boundaries
				if len(b.accum) >= Windowed {
					// Split at safe chunk boundary to avoid glamour limits
					if err := b.splitAndFlush(); err != nil {
						return fmt.Errorf("pathological split failed: %w", err)
					}
				}
			}
			// Handle errors
			if result.err == io.EOF {
				if b.offset == -1 && b.written == 0 && len(b.accum) > 0 {
					b.offset = 0
					b.processContentSlice(b.accum, &currentLineLen)
				}
				// Final flush of all remaining content
				if len(b.accum) > 0 {
					return b.flushFinal()
				}
				// Flush any pending glamour blanks if we ended exactly on a boundary
				if err := b.flushPendingFinal(); err != nil {
					return err
				}
				// Empty input special case - glamour outputs \n\n for empty input
				if b.written == 0 {
					// Never had any output, render empty string to match glamour
					return b.renderFinal([]byte{})
				}
				return nil
			}
			if result.err != nil {
				return result.err
			}
		}
	}
}
// shouldFlush determines if buffer should be flushed based on flow config
func (b *Buffer) shouldFlush() bool {
	if b.offset == -1 && b.written == 0 {
		return false
	}
	if b.config.Window == Buffered {
		// No flow: never flush until EOF
		return false
	}
	if b.config.Window < Buffered {
		// Aggressive flow: flush at ANY newline
		return bytes.Contains(b.accum, []byte("\n"))
	}
	// Bounded flow: flush when exceeding size threshold
	return int64(len(b.accum)) >= b.config.Window
}
// findSafeBoundary finds the last safe split point
func (b *Buffer) findSafeBoundary() int {
	// Never split inside code fence to preserve syntax highlighting integrity
	if b.inFence {
		return -1
	}
	// CRITICAL: If we just closed a fence, include the next line for context
	if b.postFence && b.lastFence >= 0 && b.lastFence < len(b.accum) {
		// Find next newline after fence to keep context together
		if idx := bytes.IndexByte(b.accum[b.lastFence:], '\n'); idx >= 0 {
			boundary := b.lastFence + idx + 1
			// Only use this boundary if it's reasonable
			if boundary < len(b.accum) {
				b.postFence = false // Clear flag after use
				return boundary
			}
		}
	}
	// Priority 1: Complete code blocks
	if idx := b.findCodeBlockBoundary(b.accum); idx > 0 {
		return idx
	}
	// Priority 2: Double newlines (paragraph boundaries)
	if idx := bytes.LastIndex(b.accum, []byte("\n\n")); idx >= 0 {
		return idx + 2
	}
	// Priority 3: Any newline as last resort
	if idx := bytes.LastIndex(b.accum, []byte("\n")); idx >= 0 {
		return idx + 1
	}
	// No boundary found
	return -1
}
// findCodeBlockBoundary finds the end of a complete code block if present
func (b *Buffer) findCodeBlockBoundary(data []byte) int {
	// Simple open/close tracking (markdown doesn't support nested fences)
	inFence := false
	lastCompleteEnd := -1
	idx := 0
	for idx < len(data) {
		// Check if we're at start of line
		if idx == 0 || data[idx-1] == '\n' {
			// Check for fence marker (``` or ~~~)
			if idx+2 < len(data) && ((data[idx] == '`' && data[idx+1] == '`' && data[idx+2] == '`') ||
				(data[idx] == '~' && data[idx+1] == '~' && data[idx+2] == '~')) {
				// Toggle fence state
				inFence = !inFence
				// Skip to end of line
				for idx < len(data) && data[idx] != '\n' {
					idx++
				}
				if idx < len(data) {
					idx++ // Include newline
				}
				// If we just closed a fence, mark this position
				if !inFence {
					lastCompleteEnd = idx
				}
				continue
			}
		}
		idx++
	}
	return lastCompleteEnd
}
// flushToSafeBoundary flushes content up to the last safe boundary
func (b *Buffer) flushToSafeBoundary(force bool) error {
	if len(b.accum) == 0 {
		return nil
	}
	// For aggressive flow (flow=-1), flush at ANY newline boundary
	if b.config.Window < Buffered {
		// Find the last newline in the buffer
		if idx := bytes.LastIndex(b.accum, []byte("\n")); idx >= 0 {
			boundary := idx + 1
			toRender := b.accum[:boundary]
			b.accum = b.accum[boundary:]
			// Only mark as split if there's remaining content
			if len(b.accum) > 0 {
				b.hadSplits = true
			}
			err := b.render(toRender)
			if err != nil {
				return fmt.Errorf("render failed after %d bytes: %w", b.written, err)
			}
			return nil
		}
		// No newline found, check for pathological input
		if force || len(b.accum) >= Windowed {
			// Split at safe boundary to avoid glamour hanging
			return b.splitAndFlush()
		}
		return nil
	}
	boundary := b.findSafeBoundary()
	if boundary <= 0 {
		if force {
			// Forced flush: render everything
			// CRITICAL: Never signal EOF for intermediate chunks!
			return b.flush()
		}
		// If we've accumulated significantly over threshold, flush at line boundary
		// Use a simple 2x threshold - if we're over 2x the window size, force a flush
		if b.config.Window > Buffered && int64(len(b.accum)) > b.config.Window*2 {
			// Find a line boundary as fallback
			if idx := bytes.LastIndex(b.accum, []byte("\n")); idx > 0 {
				boundary = idx + 1
			} else {
				// No line boundary either, split at safe chunk size
				return b.splitAndFlush()
			}
		} else {
			// No safe boundary: keep accumulating
			return nil
		}
	}
	// Split at boundary
	toRender := b.accum[:boundary]
	b.accum = b.accum[boundary:]
	// Only mark as split if there's remaining content (not just flushing everything)
	if len(b.accum) > 0 {
		b.hadSplits = true
	}
	// Recalculate fence state for remaining content after split
	// CRITICAL: Don't reset fence state - preserve it across boundaries
	b.calculateFenceState(b.accum, false)
	// Debug output
	// Reset cache since buffer changed
	// This is an intermediate flush at a boundary, never final
	// Only explicit flush(true) calls should be final
	err := b.render(toRender)
	if err != nil {
		return fmt.Errorf("split flush failed: %w", err)
	}
	return nil
}
// flush renders all accumulated content
func (b *Buffer) flush() error {
	if len(b.accum) == 0 {
		return nil
	}
	toRender := b.accum
	b.accum = b.accum[:0] // Clear but keep capacity
	// Reset cache since buffer is cleared
	// Reset fence state after flush (accumulator is now empty)
	b.inFence = false
	return b.render(toRender)
}
// flushFinal renders all accumulated content as final output
func (b *Buffer) flushFinal() error {
	if len(b.accum) == 0 {
		return nil
	}
	toRender := b.accum
	b.accum = b.accum[:0] // Clear but keep capacity
	// Reset fence state after flush (accumulator is now empty)
	b.inFence = false
	return b.renderFinal(toRender)
}
// splitAndFlush splits pathological input at safe boundaries to avoid glamour hanging
func (b *Buffer) splitAndFlush() error {
	if len(b.accum) == 0 {
		return nil
	}
	// Split at SafeChunkSize boundary to stay under glamour's limit
	for len(b.accum) >= Windowed {
		// Extract a safe chunk
		chunk := b.accum[:Windowed]
		b.accum = b.accum[Windowed:]
		b.hadSplits = true // Mark that we've split the input
		// Recalculate fence state for remaining content after split
		// CRITICAL: Don't reset fence state - preserve it across boundaries
		b.calculateFenceState(b.accum, false)
		// Render the chunk
		if err := b.render(chunk); err != nil {
			return fmt.Errorf("flush render failed: %w", err)
		}
	}
	// If there's remaining data less than chunk size, flush it
	if len(b.accum) > 0 {
		return b.flush()
	}
	return nil
}
const glamourBlankSequence = "\n  \n"
const glamourBlankLen = len(glamourBlankSequence)
var glamourBlankBytes = []byte(glamourBlankSequence)
const pendingBlankSequence = "  \n"
const pendingBlankLen = len(pendingBlankSequence)
var pendingBlankBytes = []byte(pendingBlankSequence)
func trailingGlamourBlanks(data []byte) int {
	suffix := 0
	for len(data) >= glamourBlankLen && bytes.HasSuffix(data, glamourBlankBytes) {
		suffix += glamourBlankLen
		data = data[:len(data)-glamourBlankLen]
	}
	return suffix
}
func convertGlamourBlankToFinal(data []byte) []byte {
	if len(data) == 0 {
		return nil
	}
	count := len(data) / pendingBlankLen
	if count <= 0 {
		return nil
	}
	result := make([]byte, count)
	for i := range result {
		result[i] = '\n'
	}
	return result
}
func (b *Buffer) writeChunk(output []byte, final bool) error {
	// Enforce total output size limit
	if b.written+int64(len(output)) > Windowed {
		// Calculate how much we can still write
		remaining := Windowed - b.written
		if remaining <= 0 {
			// Already at limit, don't write anything more
			return nil
		}
		// Truncate output to fit within limit
		output = output[:remaining]
	}
	swallowEPIPE := !final
	if final {
		suffixLen := trailingGlamourBlanks(output)
		count := suffixLen / glamourBlankLen
		var suffixConverted []byte
		if count > 0 {
			suffixStart := len(output) - suffixLen
			output = append(output[:suffixStart], bytes.Repeat([]byte("\n"), count)...)
			suffixConverted = make([]byte, count)
			for i := range suffixConverted {
				suffixConverted[i] = '\n'
			}
		}
		convertPending := len(output) == 0 && len(suffixConverted) == 0
		if len(b.pendingBlank) > 0 {
			pending := b.pendingBlank
			if convertPending {
				pending = convertGlamourBlankToFinal(pending)
			}
			if err := b.writeToWriter(pending, swallowEPIPE); err != nil {
				return err
			}
			b.pendingBlank = b.pendingBlank[:0]
		}
		if len(output) > 0 {
			if err := b.writeToWriter(output, swallowEPIPE); err != nil {
				return err
			}
		}
		if len(suffixConverted) > 0 {
			return b.writeToWriter(suffixConverted, swallowEPIPE)
		}
		return nil
	}
	// Non-final chunk
	if len(b.pendingBlank) > 0 {
		if err := b.writeToWriter(b.pendingBlank, swallowEPIPE); err != nil {
			return err
		}
		b.pendingBlank = b.pendingBlank[:0]
	}
	suffixLen := trailingGlamourBlanks(output)
	if suffixLen > 0 {
		count := suffixLen / glamourBlankLen
		suffixStart := len(output) - suffixLen
		output = append(output[:suffixStart], bytes.Repeat([]byte("\n"), count)...)
		b.pendingBlank = b.pendingBlank[:0]
		for i := 0; i < count; i++ {
			b.pendingBlank = append(b.pendingBlank, pendingBlankBytes...)
		}
	}
	if len(output) > 0 {
		return b.writeToWriter(output, swallowEPIPE)
	}
	return nil
}
func (b *Buffer) writeToWriter(data []byte, swallowEPIPE bool) error {
	if len(data) == 0 {
		return nil
	}
	n, err := b.writer.Write(data)
	if err != nil {
		if swallowEPIPE && errors.Is(err, syscall.EPIPE) {
			b.written += int64(n)
			return nil
		}
		return fmt.Errorf("write failed after %d bytes: %w", b.written, err)
	}
	b.written += int64(n)
	return nil
}
func (b *Buffer) flushPendingFinal() error {
	if len(b.pendingBlank) == 0 {
		return nil
	}
	converted := convertGlamourBlankToFinal(b.pendingBlank)
	b.pendingBlank = b.pendingBlank[:0]
	return b.writeToWriter(converted, false)
}
func (b *Buffer) flushPendingPartial() error {
	if len(b.pendingBlank) == 0 {
		return nil
	}
	count := len(b.pendingBlank) / pendingBlankLen
	newline := make([]byte, count)
	for i := range newline {
		newline[i] = '\n'
	}
	b.pendingBlank = b.pendingBlank[:0]
	return b.writeToWriter(newline, true)
}
// renderFinal is like render but for the final output
func (b *Buffer) renderFinal(data []byte) error {
	output, err := b.config.Render(data)
	if err != nil {
		return err
	}
	// Check if this is identity renderer (returns exactly what was given)
	isIdentity := bytes.Equal(output, data)
	// Conservative glamour detection - only apply spacing fixes to actual glamour output
	// Glamour output has consistent "  " prefix on content lines
	isLikelyGlamour := !isIdentity &&
		len(output) > 3 &&
		bytes.HasPrefix(output, []byte("\n  ")) &&
		bytes.Contains(output, []byte("\n  ")) // Has multiple glamour-formatted lines
	// Simple blank line handling for glamour output only
	// For the final render, we need special handling of the trailing newlines
	if isLikelyGlamour {
		// Special handling: glamour ends with \n\n, we should preserve that
		endsWithDoubleNewline := bytes.HasSuffix(output, []byte("\n\n"))
		// Do the normal blank line replacement
		output = bytes.ReplaceAll(output, []byte("\n\n"), []byte("\n  \n"))
		// If it originally ended with \n\n, restore that at the end
		if endsWithDoubleNewline && bytes.HasSuffix(output, []byte("\n  \n")) {
			// Remove the spaces from the final empty line
			output = output[:len(output)-4]            // Remove "  \n"
			output = append(output, []byte("\n\n")...) // Add back "\n\n"
		}
	}
	// Strip leading newline from non-first chunks (glamour only)
	if isLikelyGlamour && b.written > 0 && len(output) > 0 && output[0] == '\n' {
		output = output[1:]
	}
	// Skip completely empty output
	if len(output) == 0 {
		return b.writeChunk(output, true)
	}
	return b.writeChunk(output, true)
}
// render processes markdown through glamour and outputs directly to writer
func (b *Buffer) render(data []byte) error {
	output, err := b.config.Render(data)
	if err != nil {
		return err
	}
	// Check if this is identity renderer (returns exactly what was given)
	isIdentity := bytes.Equal(output, data)
	// Conservative glamour detection - only apply spacing fixes to actual glamour output
	// Glamour output has consistent "  " prefix on content lines
	isLikelyGlamour := !isIdentity &&
		len(output) > 3 &&
		bytes.HasPrefix(output, []byte("\n  ")) &&
		bytes.Contains(output, []byte("\n  ")) // Has multiple glamour-formatted lines
	// Simple blank line handling for glamour output only
	// Replace \n\n with \n  \n to maintain spacing
	if isLikelyGlamour {
		output = bytes.ReplaceAll(output, []byte("\n\n"), []byte("\n  \n"))
		// Ensure trailing empty lines have proper spacing
		// This ensures consistency with glow.orig output
		if bytes.HasSuffix(output, []byte("\n  \n")) {
			// Already has proper spacing
		} else if bytes.HasSuffix(output, []byte("\n\n")) {
			// Replace final empty line with properly spaced line
			output = bytes.TrimSuffix(output, []byte("\n"))
			output = append(output, []byte("  \n")...)
		}
	}
	// Strip leading newline from non-first chunks (glamour only)
	if isLikelyGlamour && b.written > 0 && len(output) > 0 && output[0] == '\n' {
		output = output[1:]
	}
	return b.writeChunk(output, false)
}
// Flow is the main entry point for streaming markdown rendering with configurable flow control.
//
// Flow processes markdown content from reader r and writes rendered output to writer w using the provided render function.
// The window parameter controls buffering behavior:
//
//   - window == -1 (Unbuffered): Aggressive flushing at newline boundaries for minimal latency
//   - window == 0 (Buffered): Maximum buffering until EOF for optimal throughput
//   - window > 0 (Windowed): Bounded buffering with specified byte limit for balanced performance
//
// The render function should accept markdown bytes and return rendered output (e.g., HTML or styled text).
// Flow handles smart boundary detection to avoid breaking markdown structures like code fences.
//
// Returns an error if validation fails or processing encounters unrecoverable issues.
func Flow(ctx context.Context, r io.Reader, w io.Writer, window int64, render RenderFunc) error {
	// Validate inputs
	switch {
	case ctx == nil:
		return fmt.Errorf("context cannot be nil")
	case r == nil:
		return fmt.Errorf("input reader cannot be nil")
	case w == nil:
		return fmt.Errorf("output writer cannot be nil")
	case render == nil:
		return fmt.Errorf("render function cannot be nil")
	case window < Unbuffered || (window > 0 && window > Windowed):
		return fmt.Errorf("window must be -1 (block), 0 (stream), or 1-%d (bytes)", Windowed)
	}
	// Create buffer configuration
	config := Config{
		Window: window,
		Render: render,
	}
	// Create buffer with validation
	buffer, err := NewBuffer(config, w)
	if err != nil {
		return fmt.Errorf("failed to create buffer: %w", err)
	}
	// Process the stream
	return buffer.Process(ctx, r)
}
