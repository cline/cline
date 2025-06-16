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
	cwdOnTaskInitialization?: string
	conversationHistoryDeletedRange?: [number, number]
	isFavorited?: boolean
	parentId?: string
	childTaskIds?: string[]
	status?: "pending" | "running" | "paused" | "completed" | "failed"
	activeChildTaskId?: string
	pendingChildTasks?: Array<{
		id: string
		prompt: string
		files?: string[]
		createdAt: number
	}>
}
