export type HistoryItem = {
	id: string
	ts: number
	task: string
	tokensIn: number
	tokensOut: number
	cacheWrites?: number
	cacheReads?: number
	totalCost: number

	size?: number
	shadowGitConfigWorkTree?: string
	conversationHistoryDeletedRange?: [number, number]
	workspaceRoot?: string // Add this field to identify the workspace
}
