package task

import "sync"

// StreamCoordinator manages coordination between SubscribeToState and SubscribeToPartialMessage streams
type StreamCoordinator struct {
	conversationTurnStartIndex int             // First message index of current turn
	processedInCurrentTurn     map[string]bool // What we've handled in THIS turn
	inputAllowed               bool            // Whether user input is currently allowed
	mu                         sync.RWMutex    // Protects inputAllowed
}

// NewStreamCoordinator creates a new stream coordinator
func NewStreamCoordinator() *StreamCoordinator {
	return &StreamCoordinator{
		conversationTurnStartIndex: 0,
		processedInCurrentTurn:     make(map[string]bool),
	}
}

// SetConversationTurnStartIndex sets the starting index for the current conversation turn
func (sc *StreamCoordinator) SetConversationTurnStartIndex(index int) {
	sc.conversationTurnStartIndex = index
}

// GetConversationTurnStartIndex returns the starting index for the current conversation turn
func (sc *StreamCoordinator) GetConversationTurnStartIndex() int {
	return sc.conversationTurnStartIndex
}

// MarkProcessedInCurrentTurn marks an item as processed in the current turn
func (sc *StreamCoordinator) MarkProcessedInCurrentTurn(key string) {
	sc.processedInCurrentTurn[key] = true
}

// IsProcessedInCurrentTurn checks if an item has been processed in the current turn
func (sc *StreamCoordinator) IsProcessedInCurrentTurn(key string) bool {
	return sc.processedInCurrentTurn[key]
}

// CompleteTurn updates the start index for the next batch of messages
// Note: Does NOT reset the processed map - that persists across state updates
func (sc *StreamCoordinator) CompleteTurn(totalMessages int) {
	sc.conversationTurnStartIndex = totalMessages
	// Don't reset processedInCurrentTurn - it should persist across state updates
}

// SetInputAllowed sets whether user input is currently allowed
func (sc *StreamCoordinator) SetInputAllowed(allowed bool) {
	sc.mu.Lock()
	defer sc.mu.Unlock()
	sc.inputAllowed = allowed
}

// IsInputAllowed returns whether user input is currently allowed
func (sc *StreamCoordinator) IsInputAllowed() bool {
	sc.mu.RLock()
	defer sc.mu.RUnlock()
	return sc.inputAllowed
}
