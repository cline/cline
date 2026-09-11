import { DailyUsage, ModelUsageSummary, UsageAnalyticsRequest, UsageAnalyticsResponse } from "@shared/proto/cline/task"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

/**
 * Returns aggregated token usage analytics for the requested period.
 * Reads from the UsageTracker's daily-usage.json (independent of task lifecycle).
 * @param controller The controller instance
 * @param request The analytics request with period filter
 * @returns UsageAnalyticsResponse with totals, per-model breakdown, and daily records
 */
export async function getUsageAnalytics(controller: Controller, request: UsageAnalyticsRequest): Promise<UsageAnalyticsResponse> {
	try {
		const allDays = controller.getUsageTracker().getAll()

		const cutoff = getPeriodCutoff(request.period)
		const periodDays = allDays.filter((d) => d.date >= cutoff)

		// Sum totals for the period
		const totals = periodDays.reduce(
			(acc, d) => ({
				tokensIn: acc.tokensIn + d.tokensIn,
				tokensOut: acc.tokensOut + d.tokensOut,
				cacheReads: acc.cacheReads + d.cacheReads,
				cacheWrites: acc.cacheWrites + d.cacheWrites,
				totalCost: acc.totalCost + d.totalCost,
				apiCalls: acc.apiCalls + d.apiCalls,
			}),
			{ tokensIn: 0, tokensOut: 0, cacheReads: 0, cacheWrites: 0, totalCost: 0, apiCalls: 0 },
		)

		// Per-model aggregation (sum byModel entries across all days in period)
		const modelMap = new Map<
			string,
			{ tokensIn: number; tokensOut: number; cacheReads: number; cacheWrites: number; totalCost: number; apiCalls: number }
		>()
		for (const day of periodDays) {
			for (const [modelId, entry] of Object.entries(day.byModel ?? {})) {
				const existing = modelMap.get(modelId) ?? {
					tokensIn: 0,
					tokensOut: 0,
					cacheReads: 0,
					cacheWrites: 0,
					totalCost: 0,
					apiCalls: 0,
				}
				existing.tokensIn += entry.tokensIn
				existing.tokensOut += entry.tokensOut
				existing.cacheReads += entry.cacheReads
				existing.cacheWrites += entry.cacheWrites
				existing.totalCost += entry.totalCost
				existing.apiCalls += entry.apiCalls
				modelMap.set(modelId, existing)
			}
		}
		const modelUsage = [...modelMap.entries()]
			.sort(([, a], [, b]) => b.totalCost - a.totalCost)
			.map(([modelId, v]) => ModelUsageSummary.create({ modelId, ...v }))

		// Daily records for chart: current calendar month (1st through end of month)
		const now = new Date()
		const year = now.getUTCFullYear()
		const month = now.getUTCMonth() // 0-indexed
		const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
		const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`
		const dateMap = new Map(allDays.filter((d) => d.date.startsWith(monthPrefix)).map((d) => [d.date, d]))
		const dailyUsage: DailyUsage[] = []
		for (let day = 1; day <= daysInMonth; day++) {
			const dateStr = `${monthPrefix}-${String(day).padStart(2, "0")}`
			const d = dateMap.get(dateStr)
			dailyUsage.push(
				DailyUsage.create({
					date: dateStr,
					tokensIn: d?.tokensIn ?? 0,
					tokensOut: d?.tokensOut ?? 0,
					cacheReads: d?.cacheReads ?? 0,
					cacheWrites: d?.cacheWrites ?? 0,
					totalCost: d?.totalCost ?? 0,
					apiCalls: d?.apiCalls ?? 0,
				}),
			)
		}

		return UsageAnalyticsResponse.create({
			totalTokensIn: totals.tokensIn,
			totalTokensOut: totals.tokensOut,
			totalCacheReads: totals.cacheReads,
			totalCacheWrites: totals.cacheWrites,
			totalCost: totals.totalCost,
			totalApiCalls: totals.apiCalls,
			modelUsage,
			dailyUsage,
		})
	} catch (error) {
		Logger.error("Error in getUsageAnalytics:", error)
		throw error
	}
}

function getPeriodCutoff(period: string): string {
	const daysAgo = period === "today" ? 0 : period === "week" ? 7 : period === "month" ? 30 : 99999
	return getDaysAgo(daysAgo)
}

function getDaysAgo(n: number): string {
	const d = new Date()
	d.setDate(d.getDate() - n)
	return d.toISOString().slice(0, 10)
}
