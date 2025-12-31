package display

import (
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
		panic(fmt.Sprintf("Failed to initialize markdown renderer: %v", err))
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

	// Render hooks from the state stream only (not partial stream) to avoid duplicates.
	//
	// Rationale: hook status messages are often updated/reordered by the backend (e.g. PreToolUse
	// hooks are moved above the corresponding tool message). The state stream represents the
	// authoritative, “final” message ordering, while the partial stream is best-effort for
	// incremental display.
	//
	// Only suppress *partial* hook messages; complete ones still flow through dedupe.
	if msg.Partial && msg.Say == string(types.SayTypeHookStatus) {
		return nil
	}

	// Check for deduplication
	if s.dedupe.IsDuplicate(msg) {
		return nil
	}

	// Segment-based header-only streaming
	// Partial stream only shows headers immediately, state stream will handle content bodies
	sayType := msg.Say
	if msg.Type == types.MessageTypeAsk {
		sayType = "ask"
	}

	// Detect segment boundary
	if s.activeSegment != nil && s.activeSegment.sayType != sayType {
		// Just cleanup, don't freeze (no body to print)
		s.activeSegment = nil
	}

	// On first partial message for a new segment type, create segment (prints header)
	if s.activeSegment == nil && msg.Partial {
		shouldMd := s.shouldRenderMarkdown(sayType)
		prefix := s.getPrefix(sayType)
		// NewStreamingSegment prints the header immediately
		s.activeSegment = NewStreamingSegment(sayType, prefix, s.mdRenderer, shouldMd, msg, s.renderer.outputFormat)
		// Header printed, done - don't append text or freeze
		return nil
	}

	// For subsequent partial messages, do nothing (header already shown)
	if msg.Partial {
		return nil
	}

	// When message is complete (partial=false), render the content body
	if s.activeSegment != nil {
		// Had an active segment from partial messages - freeze to render body
		s.activeSegment.AppendText(msg.Text)
		s.activeSegment.Freeze()
		s.activeSegment = nil
	} else if !msg.Partial {
		// Message arrived complete without partial phase - create segment and render immediately
		shouldMd := s.shouldRenderMarkdown(sayType)
		prefix := s.getPrefix(sayType)
		segment := NewStreamingSegment(sayType, prefix, s.mdRenderer, shouldMd, msg, s.renderer.outputFormat)
		segment.AppendText(msg.Text)
		segment.Freeze()
	}

	return nil
}

func (s *StreamingDisplay) shouldRenderMarkdown(sayType string) bool {
	switch sayType {
	case string(types.SayTypeReasoning),
		string(types.SayTypeText),
		string(types.SayTypeCompletionResult),
		string(types.SayTypeTool),
		"ask":
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
	case string(types.SayTypeHookStatus):
		return "HOOK"
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
