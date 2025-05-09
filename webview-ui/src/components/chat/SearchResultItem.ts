export interface SearchResultItem {
	id: string // Unique identifier for the result, could be message timestamp + match index
	messageTs: number // Timestamp of the original message
	snippet: string // Text snippet with context around the match
	// The actual highlighting of the searchQuery within the snippet will be handled by the rendering component
}
