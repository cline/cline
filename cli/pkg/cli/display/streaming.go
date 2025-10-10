package display

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"

	"github.com/cline/cli/pkg/cli/types"
)

// StreamingDisplay manages streaming message display with deduplication
type StreamingDisplay struct {
	mu            sync.RWMutex
	state         *types.ConversationState
	renderer      *Renderer
	dedupe        *MessageDeduplicator
	activeSegment *StreamingSegment
	mdRenderer    *MarkdownRenderer
}

// NewStreamingDisplay creates a new streaming display manager
func NewStreamingDisplay(state *types.ConversationState, renderer *Renderer) *StreamingDisplay {
	mdRenderer, err := NewMarkdownRenderer()
	if err != nil {
		mdRenderer = nil
	}

	return &StreamingDisplay{
		state:      state,
		renderer:   renderer,
		dedupe:     NewMessageDeduplicator(),
		mdRenderer: mdRenderer,
	}
}

// HandlePartialMessage processes partial messages with streaming support
func (s *StreamingDisplay) HandlePartialMessage(msg *types.ClineMessage) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Check for deduplication
	if s.dedupe.IsDuplicate(msg) {
		return nil
	}

	// Skip if markdown renderer not available, fall back to old behavior
	if s.mdRenderer == nil {
		messageKey := fmt.Sprintf("%d", msg.Timestamp)
		timestamp := msg.GetTimestamp()
		streamingMsg := s.state.GetStreamingMessage()

		switch msg.Type {
		case types.MessageTypeAsk:
			return s.handleStreamingAsk(msg, messageKey, timestamp, streamingMsg)
		case types.MessageTypeSay:
			return s.handleStreamingSay(msg, messageKey, timestamp, streamingMsg)
		default:
			return s.renderer.RenderMessage("CLINE", msg.Text, true)
		}
	}

	// Segment-based markdown streaming
	sayType := msg.Say
	if msg.Type == types.MessageTypeAsk {
		sayType = "ask"
	}

	// Detect segment boundary
	if s.activeSegment != nil && s.activeSegment.sayType != sayType {
		s.activeSegment.Freeze()
		s.activeSegment = nil
	}

	// Start new segment if needed
	if s.activeSegment == nil {
		shouldMd := s.shouldRenderMarkdown(sayType)
		prefix := s.getPrefix(sayType)
		s.activeSegment = NewStreamingSegment(sayType, prefix, s.mdRenderer, shouldMd, msg, s.renderer.outputFormat)
	}

	// Append text to active segment
	if msg.Text != "" {
		s.activeSegment.AppendText(msg.Text)
	}

	// If message is complete, freeze segment
	if !msg.Partial {
		s.activeSegment.Freeze()
		s.activeSegment = nil
	}

	return nil
}

// handleStreamingAsk handles streaming ASK messages
func (s *StreamingDisplay) handleStreamingAsk(msg *types.ClineMessage, messageKey, timestamp string, streamingMsg *types.StreamingMessage) error {
	if msg.Text == "" {
		return nil
	}

	cleanText := s.renderer.sanitizeText(msg.Text)
	if cleanText == "" {
		return nil
	}

	// Check if this is an update to the same ASK message
	if streamingMsg.CurrentKey == messageKey {
		// This is an update to the same ASK message - stream the changes
		if cleanText != streamingMsg.LastText {
			s.streamAskMessageUpdate(cleanText, streamingMsg.LastText, timestamp)
			s.state.SetStreamingMessage(messageKey, cleanText)
		}
	} else {
		s.finishCurrentStream()
		fmt.Println()
		s.streamAskMessage(cleanText, timestamp, true)
		s.state.SetStreamingMessage(messageKey, cleanText)
	}

	return nil
}

// handleStreamingSay handles streaming SAY messages
func (s *StreamingDisplay) handleStreamingSay(msg *types.ClineMessage, messageKey, timestamp string, streamingMsg *types.StreamingMessage) error {
	switch msg.Say {
	case string(types.SayTypeText), string(types.SayTypeCompletionResult), string(types.SayTypeReasoning):
		return s.handleStreamingText(msg, messageKey, timestamp, streamingMsg)
	case string(types.SayTypeCommand):
		return s.handleStreamingCommand(msg, messageKey, timestamp, streamingMsg)
	case string(types.SayTypeCommandOutput):
		return s.handleStreamingCommandOutput(msg, messageKey, timestamp, streamingMsg)
	case string(types.SayTypeShellIntegrationWarning):
		return s.handleShellIntegrationWarning(msg, messageKey, timestamp, streamingMsg)
	default:
		// For non-streaming message types, use regular display
		return s.renderer.RenderMessage(s.getMessagePrefix(msg.Say), msg.Text, true)
	}
}

// handleStreamingText handles streaming text messages
func (s *StreamingDisplay) handleStreamingText(msg *types.ClineMessage, messageKey, timestamp string, streamingMsg *types.StreamingMessage) error {
	cleanText := s.renderer.sanitizeText(msg.Text)
	if cleanText == "" {
		return nil
	}

	// Check if we've already displayed this exact message
	if streamingMsg.CurrentKey == messageKey && streamingMsg.LastText == cleanText {
		return nil // Duplicate - ignore it
	}

	// Check if this is an update to the same message
	if streamingMsg.CurrentKey == messageKey {
		// Show incremental changes
		if len(cleanText) > len(streamingMsg.LastText) && strings.HasPrefix(cleanText, streamingMsg.LastText) {
			// Show only the new characters with typewriter effect
			newChars := cleanText[len(streamingMsg.LastText):]
			s.typewriterPrint(newChars)
			s.state.SetStreamingMessage(messageKey, cleanText)
		} else {
			s.renderer.ClearLine()
			prefix := s.getMessagePrefix(msg.Say)

			if msg.Say == string(types.SayTypeReasoning) || msg.Say == string(types.SayTypeText) || msg.Say == string(types.SayTypeCompletionResult) {
				s.renderer.typewriter.PrintfInstant("%s: ", prefix)
			} else {
				s.renderer.typewriter.PrintfInstant("[%s] %s: ", timestamp, prefix)
			}
			s.typewriterPrint(cleanText)
			s.state.SetStreamingMessage(messageKey, cleanText)
		}
	} else {
		s.finishCurrentStream()
		fmt.Println()

		prefix := s.getMessagePrefix(msg.Say)

		if msg.Say == string(types.SayTypeReasoning) || msg.Say == string(types.SayTypeText) || msg.Say == string(types.SayTypeCompletionResult) {
			s.renderer.typewriter.PrintfInstant("%s: ", prefix)
		} else {
			s.renderer.typewriter.PrintfInstant("[%s] %s: ", timestamp, prefix)
		}

		s.typewriterPrint(cleanText)

		s.state.SetStreamingMessage(messageKey, cleanText)
	}

	// If message is complete, add newline
	if !msg.Partial {
		fmt.Println()
		s.state.SetStreamingMessage("", "")
	}

	return nil
}

// handleStreamingCommand handles command execution messages
func (s *StreamingDisplay) handleStreamingCommand(msg *types.ClineMessage, messageKey, timestamp string, streamingMsg *types.StreamingMessage) error {
	cleanText := s.renderer.sanitizeText(msg.Text)
	if cleanText == "" {
		return nil
	}

	s.finishCurrentStream()
	fmt.Println()
	s.renderer.typewriter.PrintfInstant("CMD: ")
	s.typewriterPrint(cleanText)
	fmt.Println()

	return nil
}

// handleStreamingCommandOutput handles streaming command output
func (s *StreamingDisplay) handleStreamingCommandOutput(msg *types.ClineMessage, messageKey, timestamp string, streamingMsg *types.StreamingMessage) error {
	cleanText := s.renderer.sanitizeText(msg.Text)
	if cleanText == "" {
		return nil
	}

	// Check if we've already displayed this exact message
	if streamingMsg.CurrentKey == messageKey && streamingMsg.LastText == cleanText {
		return nil
	}

	// Check if this is an update to the same message
	if streamingMsg.CurrentKey == messageKey {
		// Show incremental changes with typewriter effect
		if len(cleanText) > len(streamingMsg.LastText) && strings.HasPrefix(cleanText, streamingMsg.LastText) {
			newChars := cleanText[len(streamingMsg.LastText):]
			s.typewriterPrint(newChars)
			s.state.SetStreamingMessage(messageKey, cleanText)
		} else {
			s.renderer.ClearLine()
			s.renderer.typewriter.PrintfInstant("OUT: ")
			s.typewriterPrint(cleanText)
			s.state.SetStreamingMessage(messageKey, cleanText)
		}
	} else {
		s.finishCurrentStream()
		fmt.Println()
		s.renderer.typewriter.PrintfInstant("OUT: ")
		s.typewriterPrint(cleanText)
		s.state.SetStreamingMessage(messageKey, cleanText)
	}

	// If message is complete, add newline
	if !msg.Partial {
		fmt.Println()
		s.state.SetStreamingMessage("", "")
	}

	return nil
}

// handleShellIntegrationWarning handles shell integration warning messages
func (s *StreamingDisplay) handleShellIntegrationWarning(msg *types.ClineMessage, messageKey, timestamp string, streamingMsg *types.StreamingMessage) error {
	cleanText := s.renderer.sanitizeText(msg.Text)
	if cleanText == "" {
		return nil
	}

	s.finishCurrentStream()
	fmt.Println()
	s.renderer.typewriter.PrintfInstant("NOTE: ")
	s.typewriterPrint("Command executed (output not streamed due to shell integration)")
	fmt.Println()

	return nil
}

// handleStreamingTool handles streaming tool messages with deduplication
func (s *StreamingDisplay) handleStreamingTool(msg *types.ClineMessage, messageKey, timestamp string, streamingMsg *types.StreamingMessage) error {
	cleanText := s.renderer.sanitizeText(msg.Text)
	if cleanText == "" {
		return nil
	}

	// Parse the tool JSON to extract structured information
	var toolData types.ToolMessage
	if err := json.Unmarshal([]byte(cleanText), &toolData); err != nil {
		// If parsing fails, just show generic tool message
		s.finishCurrentStream()
		fmt.Println()
		fmt.Printf("TOOL: %s\n", cleanText)
		s.state.StreamingMessage.LastToolMessage = cleanText
		return nil
	}

	// Format the tool message nicely
	formattedTool := s.formatStructuredToolMessage(&toolData)

	// Check if this is the exact same tool message we just displayed
	if streamingMsg.LastToolMessage == formattedTool {
		return nil // Exact duplicate - ignore it
	}

	// Check if this is a very similar tool message
	if streamingMsg.LastToolMessage != "" && s.isSimilarToolMessage(streamingMsg.LastToolMessage, formattedTool) {
		return nil
	}

	s.finishCurrentStream()
	fmt.Println()
	fmt.Printf("TOOL: %s\n", formattedTool)

	// Store the formatted tool message for deduplication
	s.state.StreamingMessage.LastToolMessage = formattedTool

	return nil
}

// streamAskMessage streams an ASK message in a natural format
func (s *StreamingDisplay) streamAskMessage(text, timestamp string, isNew bool) {
	// Try to parse as JSON
	var askData types.AskData
	if err := s.parseJSON(text, &askData); err != nil {
		fmt.Printf("ASK: %s", text)
		return
	}

	fmt.Printf("ASK: %s", askData.Response)

	// Display options if available
	if len(askData.Options) > 0 {
		fmt.Print("\n\nOptions:")
		for i, option := range askData.Options {
			fmt.Printf("\n%d. %s", i+1, option)
		}
	}
}

// streamAskMessageUpdate handles updates to an existing ASK message
func (s *StreamingDisplay) streamAskMessageUpdate(newText, oldText, timestamp string) {
	var oldAskData, newAskData types.AskData

	oldErr := s.parseJSON(oldText, &oldAskData)
	newErr := s.parseJSON(newText, &newAskData)

	if oldErr != nil || newErr != nil {
		// Handle plain text incremental updates
		if len(newText) > len(oldText) && strings.HasPrefix(newText, oldText) {
			newChars := newText[len(oldText):]
			fmt.Print(newChars)
		} else {
			// Non-incremental change - clear line and reprint everything
			s.renderer.ClearLine()
			fmt.Printf("ASK: %s", newText)
		}
		return
	}

	// Handle structured updates
	if len(newAskData.Response) > len(oldAskData.Response) && strings.HasPrefix(newAskData.Response, oldAskData.Response) {
		newChars := newAskData.Response[len(oldAskData.Response):]
		fmt.Print(newChars)
	} else if oldAskData.Response != newAskData.Response {
		s.renderer.ClearLine()
		fmt.Printf("ASK: %s", newAskData.Response)
	}

	// Handle options changes
	if len(newAskData.Options) > len(oldAskData.Options) {
		if len(oldAskData.Options) == 0 {
			fmt.Print("\n\nOptions:")
		}

		for i := len(oldAskData.Options); i < len(newAskData.Options); i++ {
			fmt.Printf("\n%d. %s", i+1, newAskData.Options[i])
		}
	}
}

// typewriterPrint displays text with a typewriter animation effect
func (s *StreamingDisplay) typewriterPrint(text string) {
	// Use the renderer's typewriter for consistent animation
	s.renderer.typewriter.Print(text)
}

// finishCurrentStream completes any ongoing streaming message
func (s *StreamingDisplay) finishCurrentStream() {
	streamingMsg := s.state.GetStreamingMessage()
	if streamingMsg.CurrentKey != "" {
		fmt.Println()
		s.state.SetStreamingMessage("", "")
	}
}

// getMessagePrefix returns the appropriate prefix for a message type
func (s *StreamingDisplay) getMessagePrefix(say string) string {
	switch say {
	case string(types.SayTypeCompletionResult):
		return "RESULT"
	case string(types.SayTypeText):
		return "CLINE"
	case string(types.SayTypeReasoning):
		return "THINKING"
	default:
		return "CLINE"
	}
}

// formatToolMessage formats tool call messages for better readability (legacy, keep for compatibility)
func (s *StreamingDisplay) formatToolMessage(text string) string {
	var toolCall map[string]interface{}
	if err := s.parseJSON(text, &toolCall); err == nil {
		if tool, ok := toolCall["tool"].(string); ok {
			parts := []string{tool}

			if path, ok := toolCall["path"].(string); ok && path != "" {
				parts = append(parts, fmt.Sprintf("path=%s", path))
			}

			if content, ok := toolCall["content"].(string); ok && content != "" {
				if len(content) > 50 {
					parts = append(parts, fmt.Sprintf("content=%s...", content[:50]))
				} else {
					parts = append(parts, fmt.Sprintf("content=%s", content))
				}
			}

			return strings.Join(parts, " ")
		}
	}

	// If not JSON or doesn't have expected structure, return truncated
	if len(text) > 100 {
		return text[:100] + "..."
	}
	return text
}

// formatStructuredToolMessage formats a parsed ToolMessage for display
func (s *StreamingDisplay) formatStructuredToolMessage(tool *types.ToolMessage) string {
	parts := []string{tool.Tool}

	if tool.Path != "" {
		parts = append(parts, fmt.Sprintf("path=%s", tool.Path))
	}

	if tool.Content != "" {
		if len(tool.Content) > 50 {
			parts = append(parts, fmt.Sprintf("content=%s...", tool.Content[:50]))
		} else {
			parts = append(parts, fmt.Sprintf("content=%s", tool.Content))
		}
	}

	if tool.Regex != "" {
		parts = append(parts, fmt.Sprintf("regex=%s", tool.Regex))
	}

	return strings.Join(parts, " ")
}

// isSimilarToolMessage checks if two tool messages are similar enough to be considered duplicates
func (s *StreamingDisplay) isSimilarToolMessage(msg1, msg2 string) bool {
	parts1 := strings.Fields(msg1)
	parts2 := strings.Fields(msg2)

	if len(parts1) == 0 || len(parts2) == 0 {
		return false
	}

	// If the first word (tool name) is the same, check for similarity
	if parts1[0] == parts2[0] {
		// For file operations, check if the path is the same
		if strings.Contains(msg1, "path=") && strings.Contains(msg2, "path=") {
			path1 := s.extractPathFromToolMessage(msg1)
			path2 := s.extractPathFromToolMessage(msg2)

			if path1 != "" && path1 == path2 {
				return true
			}
		}

		// For very similar content (>80% similarity), consider them duplicates
		similarity := s.calculateStringSimilarity(msg1, msg2)
		return similarity > 0.8
	}

	return false
}

// extractPathFromToolMessage extracts the path parameter from a tool message
func (s *StreamingDisplay) extractPathFromToolMessage(msg string) string {
	parts := strings.Fields(msg)
	for _, part := range parts {
		if strings.HasPrefix(part, "path=") {
			return strings.TrimPrefix(part, "path=")
		}
	}
	return ""
}

// calculateStringSimilarity calculates a simple similarity ratio between two strings
func (s *StreamingDisplay) calculateStringSimilarity(s1, s2 string) float64 {
	if s1 == s2 {
		return 1.0
	}

	if len(s1) == 0 || len(s2) == 0 {
		return 0.0
	}

	shorter, longer := s1, s2
	if len(s1) > len(s2) {
		shorter, longer = s2, s1
	}

	matches := 0
	for i, r := range shorter {
		if i < len(longer) && rune(longer[i]) == r {
			matches++
		}
	}

	return float64(matches) / float64(len(longer))
}

// parseJSON is a helper function to parse JSON with error handling
func (s *StreamingDisplay) parseJSON(text string, v interface{}) error {
	return json.Unmarshal([]byte(text), v)
}

func (s *StreamingDisplay) getMessageType(msg *types.ClineMessage) string {
	if msg.Type == types.MessageTypeAsk {
		return "ASK"
	}

	switch msg.Say {
	case string(types.SayTypeText):
		return "CLINE"
	case string(types.SayTypeReasoning):
		return "THINKING"
	case string(types.SayTypeCompletionResult):
		return "RESULT"
	case string(types.SayTypeCommand):
		return "CMD"
	default:
		return msg.Say
	}
}

func (s *StreamingDisplay) shouldRenderMarkdown(sayType string) bool {
	switch sayType {
	case string(types.SayTypeReasoning), string(types.SayTypeText), string(types.SayTypeCompletionResult), string(types.SayTypeTool), "ask":
		return true
	default:
		return false
	}
}

func (s *StreamingDisplay) getPrefix(sayType string) string {
	switch sayType {
	case string(types.SayTypeReasoning):
		return "THINKING"
	case string(types.SayTypeText):
		return "CLINE"
	case string(types.SayTypeCompletionResult):
		return "RESULT"
	case "ask":
		return "ASK"
	case string(types.SayTypeCommand):
		return "TERMINAL"
	default:
		return strings.ToUpper(sayType)
	}
}

func (s *StreamingDisplay) FreezeActiveSegment() {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.activeSegment != nil {
		s.activeSegment.Freeze()
		s.activeSegment = nil
	}
}

// Cleanup cleans up streaming display resources
func (s *StreamingDisplay) Cleanup() {
	s.FreezeActiveSegment()
	if s.dedupe != nil {
		s.dedupe.Stop()
	}
}
