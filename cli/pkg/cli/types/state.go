package types

import (
	"sync"
)

// ConversationState manages the state of the conversation
type ConversationState struct {
	mu               sync.RWMutex
	StreamingMessage *StreamingMessage `json:"streamingMessage,omitempty"`
}

// StreamingMessage manages state for streaming message display
type StreamingMessage struct {
	CurrentKey string `json:"currentKey"`
	LastText   string `json:"lastText"`
}

// NewConversationState creates a new conversation state
func NewConversationState() *ConversationState {
	return &ConversationState{
		StreamingMessage: &StreamingMessage{},
	}
}

// SetStreamingMessage updates the streaming message state
func (cs *ConversationState) SetStreamingMessage(key, text string) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.StreamingMessage.CurrentKey = key
	cs.StreamingMessage.LastText = text
}

// GetStreamingMessage returns the current streaming message state
func (cs *ConversationState) GetStreamingMessage() *StreamingMessage {
	cs.mu.RLock()
	defer cs.mu.RUnlock()
	return &StreamingMessage{
		CurrentKey: cs.StreamingMessage.CurrentKey,
		LastText:   cs.StreamingMessage.LastText,
	}
}

// Clear resets state
func (cs *ConversationState) Clear() {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.StreamingMessage = &StreamingMessage{}
}

// ExtensionState represents the server-side extension state structure
type ExtensionState struct {
	CurrentTaskItem *CurrentTaskItem `json:"currentTaskItem,omitempty"`
}

// CurrentTaskItem - minimal struct with just what we need
type CurrentTaskItem struct {
	Id string `json:"id"`
}
