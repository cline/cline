package types

// HistoryItem represents a task history item from taskHistory.json
// This struct matches the JSON format stored on disk
type HistoryItem struct {
	Id             string   `json:"id"`
	Ulid           string   `json:"ulid,omitempty"`
	Ts             int64    `json:"ts"`
	Task           string   `json:"task"`
	TokensIn       int32    `json:"tokensIn"`
	TokensOut      int32    `json:"tokensOut"`
	CacheWrites    int32    `json:"cacheWrites,omitempty"`
	CacheReads     int32    `json:"cacheReads,omitempty"`
	TotalCost      float64  `json:"totalCost"`
	Size           int64    `json:"size,omitempty"`
	IsFavorited    bool     `json:"isFavorited,omitempty"`
	WorkspacePaths []string `json:"workspacePaths,omitempty"`
}
