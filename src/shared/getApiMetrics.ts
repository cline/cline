import { ClineMessage } from "./ExtensionMessage"

export interface ClineApiReqInfo {
	request?: string
	tokensIn?: number
	tokensOut?: number
	cacheWrites?: number
	cacheReads?: number
	cost?: number
}

export interface DetailedReqMetrics {
	reqIndex: number
	tokensIn: number
	tokensOut: number
	cacheWrites: number
	cacheReads: number
	cost: number
	cumulativeTokensIn: number
	cumulativeTokensOut: number
	cumulativeCost: number
}

export interface DetailedApiMetrics {
	totals: ApiMetrics
	perReq: DetailedReqMetrics[]
}

interface ApiMetrics {
	totalTokensIn: number
	totalTokensOut: number
	totalCacheWrites?: number
	totalCacheReads?: number
	totalCost: number
}

/**
 * Calculates API metrics from an array of ClineMessages.
 *
 * This function processes 'api_req_started' messages that have been combined with their
 * corresponding 'api_req_finished' messages by the combineApiRequests function. It also takes into account 'deleted_api_reqs' messages, which are aggregated from deleted messages.
 * It extracts and sums up the tokensIn, tokensOut, cacheWrites, cacheReads, and cost from these messages.
 *
 * @param messages - An array of ClineMessage objects to process.
 * @returns An ApiMetrics object containing totalTokensIn, totalTokensOut, totalCacheWrites, totalCacheReads, and totalCost.
 *
 * @example
 * const messages = [
 *   { type: "say", say: "api_req_started", text: '{"request":"GET /api/data","tokensIn":10,"tokensOut":20,"cost":0.005}', ts: 1000 }
 * ];
 * const { totalTokensIn, totalTokensOut, totalCost } = getApiMetrics(messages);
 * // Result: { totalTokensIn: 10, totalTokensOut: 20, totalCost: 0.005 }
 */
export function getApiMetrics(messages: ClineMessage[]): ApiMetrics {
	const detailed = getDetailedApiMetrics(messages)
	return detailed.totals
}

export function getDetailedApiMetrics(messages: ClineMessage[]): DetailedApiMetrics {
	const totals: ApiMetrics = {
		totalTokensIn: 0,
		totalTokensOut: 0,
		totalCacheWrites: undefined,
		totalCacheReads: undefined,
		totalCost: 0,
	}
	const perReq: DetailedReqMetrics[] = []

	let cumIn = 0
	let cumOut = 0
	let _cumWrites = 0
	let _cumReads = 0
	let cumCost = 0
	let reqIndex = 0

	messages.forEach((message) => {
		if (message.type === "say" && (message.say === "api_req_started" || message.say === "deleted_api_reqs") && message.text) {
			try {
				const parsedData: ClineApiReqInfo = JSON.parse(message.text)
				const { tokensIn = 0, tokensOut = 0, cacheWrites = 0, cacheReads = 0, cost = 0 } = parsedData

				cumIn += tokensIn
				cumOut += tokensOut
				_cumWrites += cacheWrites
				_cumReads += cacheReads
				cumCost += cost

				perReq.push({
					reqIndex: reqIndex++,
					tokensIn,
					tokensOut,
					cacheWrites,
					cacheReads,
					cost,
					cumulativeTokensIn: cumIn,
					cumulativeTokensOut: cumOut,
					cumulativeCost: cumCost,
				})

				totals.totalTokensIn += tokensIn
				totals.totalTokensOut += tokensOut
				totals.totalCacheWrites = (totals.totalCacheWrites ?? 0) + cacheWrites
				totals.totalCacheReads = (totals.totalCacheReads ?? 0) + cacheReads
				totals.totalCost += cost
			} catch (error) {
				console.error("Error parsing JSON:", error)
			}
		}
	})

	return { totals, perReq }
}
