package task

// StreamCoordinator manages coordination between SubscribeToState and SubscribeToPartialMessage streams
type StreamCoordinator struct {
	conversationTurnStartIndex int             // First message index of current turn
	processedInCurrentTurn     map[string]bool // What we've handled in THIS turn
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

// CompleteTurn resets the coordinator for the next conversation turn
func (sc *StreamCoordinator) CompleteTurn(totalMessages int) {
	sc.conversationTurnStartIndex = totalMessages
	sc.processedInCurrentTurn = make(map[string]bool)
}
