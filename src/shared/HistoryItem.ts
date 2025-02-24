export type HistoryItem = {
	id: string
	number: number
	ts: number
	task: string
	tokensIn: number
	tokensOut: number
	cacheWrites?: number
	cacheReads?: number
	totalCost: number
	size?: number
}
