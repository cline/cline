export type ApiRequestUsageMetrics = {
	inputTokens: number
	outputTokens: number
	cacheWriteTokens: number
	cacheReadTokens: number
	totalCost?: number
}

export type ApiRequestUsageSnapshot = {
	inputTokens?: number
	outputTokens?: number
	cacheWriteTokens?: number
	cacheReadTokens?: number
	totalCost?: number
}

export function applyUsageSnapshot(metrics: ApiRequestUsageMetrics, usage: ApiRequestUsageSnapshot) {
	const previous = {
		inputTokens: metrics.inputTokens,
		outputTokens: metrics.outputTokens,
		cacheWriteTokens: metrics.cacheWriteTokens,
		cacheReadTokens: metrics.cacheReadTokens,
		totalCost: metrics.totalCost,
	}

	metrics.inputTokens = usage.inputTokens ?? metrics.inputTokens
	metrics.outputTokens = usage.outputTokens ?? metrics.outputTokens
	metrics.cacheWriteTokens = usage.cacheWriteTokens ?? metrics.cacheWriteTokens
	metrics.cacheReadTokens = usage.cacheReadTokens ?? metrics.cacheReadTokens
	metrics.totalCost = usage.totalCost ?? metrics.totalCost

	return {
		inputTokens: Math.max(0, metrics.inputTokens - previous.inputTokens),
		outputTokens: Math.max(0, metrics.outputTokens - previous.outputTokens),
		cacheWriteTokens: Math.max(0, metrics.cacheWriteTokens - previous.cacheWriteTokens),
		cacheReadTokens: Math.max(0, metrics.cacheReadTokens - previous.cacheReadTokens),
		totalCost: metrics.totalCost === undefined ? undefined : Math.max(0, metrics.totalCost - (previous.totalCost ?? 0)),
	}
}
