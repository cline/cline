import type { TokenUsage, ClineMessage } from "@roo-code/types"

export type ParsedApiReqStartedTextType = {
	tokensIn: number
	tokensOut: number
	cacheWrites: number
	cacheReads: number
	cost?: number // Only present if combineApiRequests has been called
}

/**
 * Calculates API metrics from an array of ClineMessages.
 *
 * This function processes 'condense_context' messages and 'api_req_started' messages that have been
 * combined with their corresponding 'api_req_finished' messages by the combineApiRequests function.
 * It extracts and sums up the tokensIn, tokensOut, cacheWrites, cacheReads, and cost from these messages.
 *
 * @param messages - An array of ClineMessage objects to process.
 * @returns An ApiMetrics object containing totalTokensIn, totalTokensOut, totalCacheWrites, totalCacheReads, totalCost, and contextTokens.
 *
 * @example
 * const messages = [
 *   { type: "say", say: "api_req_started", text: '{"request":"GET /api/data","tokensIn":10,"tokensOut":20,"cost":0.005}', ts: 1000 }
 * ];
 * const { totalTokensIn, totalTokensOut, totalCost } = getApiMetrics(messages);
 * // Result: { totalTokensIn: 10, totalTokensOut: 20, totalCost: 0.005 }
 */
export function getApiMetrics(messages: ClineMessage[]) {
	const result: TokenUsage = {
		totalTokensIn: 0,
		totalTokensOut: 0,
		totalCacheWrites: undefined,
		totalCacheReads: undefined,
		totalCost: 0,
		contextTokens: 0,
	}

	// Calculate running totals
	messages.forEach((message) => {
		if (message.type === "say" && message.say === "api_req_started" && message.text) {
			try {
				const parsedText: ParsedApiReqStartedTextType = JSON.parse(message.text)
				const { tokensIn, tokensOut, cacheWrites, cacheReads, cost } = parsedText

				if (typeof tokensIn === "number") {
					result.totalTokensIn += tokensIn
				}
				if (typeof tokensOut === "number") {
					result.totalTokensOut += tokensOut
				}
				if (typeof cacheWrites === "number") {
					result.totalCacheWrites = (result.totalCacheWrites ?? 0) + cacheWrites
				}
				if (typeof cacheReads === "number") {
					result.totalCacheReads = (result.totalCacheReads ?? 0) + cacheReads
				}
				if (typeof cost === "number") {
					result.totalCost += cost
				}
			} catch (error) {
				console.error("Error parsing JSON:", error)
			}
		} else if (message.type === "say" && message.say === "condense_context") {
			result.totalCost += message.contextCondense?.cost ?? 0
		}
	})

	// Calculate context tokens, from the last API request started or condense context message
	result.contextTokens = 0
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i]
		if (message.type === "say" && message.say === "api_req_started" && message.text) {
			try {
				const parsedText: ParsedApiReqStartedTextType = JSON.parse(message.text)
				const { tokensIn, tokensOut, cacheWrites, cacheReads } = parsedText
				result.contextTokens = (tokensIn || 0) + (tokensOut || 0) + (cacheWrites || 0) + (cacheReads || 0)
			} catch (error) {
				console.error("Error parsing JSON:", error)
				continue
			}
		} else if (message.type === "say" && message.say === "condense_context") {
			result.contextTokens = message.contextCondense?.newContextTokens ?? 0
		}
		if (result.contextTokens) {
			break
		}
	}

	return result
}
