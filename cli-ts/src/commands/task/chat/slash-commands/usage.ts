/**
 * Usage command handler
 *
 * Displays token usage and cost for the current conversation
 */

import type { ClineMessage } from "@shared/ExtensionMessage"
import { getApiMetrics } from "@shared/getApiMetrics"
import type { CommandContext, CommandHandler } from "./types.js"

/**
 * Count API requests from messages
 */
function countApiRequests(messages: ClineMessage[]): number {
	return messages.filter((msg) => msg.type === "say" && msg.say === "api_req_started").length
}

/**
 * Format number with commas
 */
function formatNumber(n: number): string {
	return n.toLocaleString()
}

/**
 * Handle /usage, /u commands
 */
export const handleUsage: CommandHandler = async (_args: string[], ctx: CommandContext): Promise<boolean> => {
	// Get messages from the current session
	const messages = ctx.controller.task?.messageStateHandler.getClineMessages() || []

	if (messages.length === 0) {
		ctx.fmt.warn("No messages in current conversation")
		return true
	}

	const metrics = getApiMetrics(messages)
	const requestCount = countApiRequests(messages)

	ctx.fmt.raw("")
	ctx.fmt.info("📊 Token Usage & Cost")
	ctx.fmt.raw("")
	ctx.fmt.raw(`  Input tokens:  ${formatNumber(metrics.totalTokensIn)}`)
	ctx.fmt.raw(`  Output tokens: ${formatNumber(metrics.totalTokensOut)}`)
	ctx.fmt.raw(`  Total tokens:  ${formatNumber(metrics.totalTokensIn + metrics.totalTokensOut)}`)

	// Show cache metrics if available
	if (metrics.totalCacheWrites !== undefined || metrics.totalCacheReads !== undefined) {
		ctx.fmt.raw("")
		ctx.fmt.raw(`  Cache writes:  ${formatNumber(metrics.totalCacheWrites ?? 0)}`)
		ctx.fmt.raw(`  Cache reads:   ${formatNumber(metrics.totalCacheReads ?? 0)}`)
	}

	ctx.fmt.raw("")
	ctx.fmt.raw(`  API requests:  ${requestCount}`)
	ctx.fmt.raw(`  Total cost:    $${metrics.totalCost.toFixed(4)}`)
	ctx.fmt.raw("")

	return true
}
