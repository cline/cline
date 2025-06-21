export interface BalanceResponse {
	currentBalance: number
}

export interface UsageTransaction {
	spentAt: string
	creatorId: string
	credits: number
	modelProvider: string
	model: string
	promptTokens: number
	completionTokens: number
	totalTokens: number
}

export interface PaymentTransaction {
	paidAt: string
	creatorId: string
	amountCents: number
	credits: number
}
