import type { HistoryItem } from "@shared/HistoryItem"

export function historyItemToSessionMetadata(item: HistoryItem, fallbackModelId?: string): Record<string, unknown> {
	return {
		title: item.task,
		isFavorited: item.isFavorited ?? false,
		size: item.size ?? 0,
		totalCost: item.totalCost ?? 0,
		tokensIn: item.tokensIn ?? 0,
		tokensOut: item.tokensOut ?? 0,
		cacheWrites: item.cacheWrites ?? 0,
		cacheReads: item.cacheReads ?? 0,
		modelId: item.modelId ?? fallbackModelId ?? "",
	}
}
