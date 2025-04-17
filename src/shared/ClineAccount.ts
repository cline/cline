export interface BalanceResponse {
	currentBalance: number
}

export interface UsageTransaction {
	spentAt: string
	credits: string
	modelProvider: string
	model: string
	promptTokens: string
	completionTokens: string
}

export interface ApiRequestHistoryEntry {
	timestamp: number // Unix timestamp (ms)
	provider: string
	model: string
	taskSnippet: string // First 50 chars of the task
	taskId: string
	inputTokens: number
	outputTokens: number
	cost?: number // Optional, as cost calculation might vary or fail
	workspace?: string // Optional, workspace identifier (e.g., folder name)
}

export interface PaymentTransaction {
	paidAt: string
	amountCents: string
	credits: string
}
