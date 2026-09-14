import { UsageAnalyticsRequest } from "@shared/proto/cline/task"
import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import { TaskServiceClient } from "@/services/grpc-client"
import Section from "../Section"

type Period = "today" | "week" | "month" | "all"

interface AnalyticsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

interface UsageData {
	totalTokensIn: number
	totalTokensOut: number
	totalCacheReads: number
	totalCacheWrites: number
	totalCost: number
	totalApiCalls: number
	modelUsage: Array<{
		modelId: string
		tokensIn: number
		tokensOut: number
		cacheReads: number
		cacheWrites: number
		totalCost: number
		apiCalls: number
	}>
	dailyUsage: Array<{
		date: string
		tokensIn: number
		tokensOut: number
		cacheReads: number
		cacheWrites: number
		totalCost: number
		apiCalls: number
	}>
}

const PERIODS: { id: Period; label: string }[] = [
	{ id: "today", label: "Today" },
	{ id: "week", label: "This Week" },
	{ id: "month", label: "This Month" },
	{ id: "all", label: "All Time" },
]

function formatTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
	return String(n)
}

function formatCost(n: number): string {
	if (n === 0) return "$0"
	if (n < 0.01) return `$${n.toFixed(4)}`
	return `$${n.toFixed(2)}`
}

const AnalyticsSection = ({ renderSectionHeader }: AnalyticsSectionProps) => {
	const [period, setPeriod] = useState<Period>("week")
	const [data, setData] = useState<UsageData | null>(null)
	const [loading, setLoading] = useState(false)

	useEffect(() => {
		let cancelled = false
		setLoading(true)
		TaskServiceClient.getUsageAnalytics(UsageAnalyticsRequest.create({ period }))
			.then((response) => {
				if (cancelled) return
				setData({
					totalTokensIn: response.totalTokensIn,
					totalTokensOut: response.totalTokensOut,
					totalCacheReads: response.totalCacheReads,
					totalCacheWrites: response.totalCacheWrites,
					totalCost: response.totalCost,
					totalApiCalls: response.totalApiCalls,
					modelUsage: response.modelUsage.map((m) => ({
						modelId: m.modelId,
						tokensIn: m.tokensIn,
						tokensOut: m.tokensOut,
						cacheReads: m.cacheReads,
						cacheWrites: m.cacheWrites,
						totalCost: m.totalCost,
						apiCalls: m.apiCalls,
					})),
					dailyUsage: response.dailyUsage.map((d) => ({
						date: d.date,
						tokensIn: d.tokensIn,
						tokensOut: d.tokensOut,
						cacheReads: d.cacheReads,
						cacheWrites: d.cacheWrites,
						totalCost: d.totalCost,
						apiCalls: d.apiCalls,
					})),
				})
			})
			.catch((error) => {
				console.error("Failed to fetch usage analytics:", error)
			})
			.finally(() => {
				if (!cancelled) setLoading(false)
			})
		return () => {
			cancelled = true
		}
	}, [period])

	const hasData = data && data.totalApiCalls > 0
	const maxDailyTokens = data ? Math.max(...data.dailyUsage.map((d) => d.tokensIn + d.tokensOut), 1) : 1

	return (
		<div>
			{renderSectionHeader("analytics")}
			<Section>
				<div className="flex flex-col gap-2">
					{/* Period selector */}
					<div className="flex gap-1">
						{PERIODS.map((p) => (
							<button
								className={cn(
									"rounded px-3 py-1 text-xs font-medium transition-colors",
									period === p.id
										? "bg-cline text-cline-foreground"
										: "bg-muted/50 text-foreground hover:bg-muted",
								)}
								key={p.id}
								onClick={() => setPeriod(p.id)}
								type="button">
								{p.label}
							</button>
						))}
					</div>

					{loading ? (
						<p className="text-sm text-muted-foreground">Loading...</p>
					) : !hasData ? (
						<div className="flex flex-col items-center gap-2 py-8 text-center">
							<p className="text-sm text-muted-foreground">No usage data yet.</p>
							<p className="text-xs text-muted-foreground">Start a task to see token analytics.</p>
						</div>
					) : (
						<>
							{/* Summary cards */}
							<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
								<SummaryCard label="Input" value={formatTokens(data.totalTokensIn)} />
								<SummaryCard label="Output" value={formatTokens(data.totalTokensOut)} />
								<SummaryCard
									label="Cache R/W"
									value={`${formatTokens(data.totalCacheReads)} / ${formatTokens(data.totalCacheWrites)}`}
								/>
								<SummaryCard
									label="Cost"
									subtitle={`${data.totalApiCalls} calls`}
									value={formatCost(data.totalCost)}
								/>
							</div>

							{/* Per-model table */}
							{data.modelUsage.length > 0 && (
								<div className="overflow-x-auto">
									<table className="w-full text-xs">
										<thead>
											<tr className="border-b border-border-panel text-left text-muted-foreground">
												<th className="pb-1 pr-2">Model</th>
												<th className="pb-1 pr-2 text-right">In</th>
												<th className="pb-1 pr-2 text-right">Out</th>
												<th className="pb-1 pr-2 text-right">Cache R</th>
												<th className="pb-1 pr-2 text-right">Cache W</th>
												<th className="pb-1 pr-2 text-right">Cost</th>
												<th className="pb-1 text-right">Calls</th>
											</tr>
										</thead>
										<tbody>
											{data.modelUsage.map((m) => (
												<tr className="border-b border-border-panel" key={m.modelId}>
													<td className="py-1.5 pr-2 font-mono">{m.modelId}</td>
													<td className="py-1.5 pr-2 text-right">{formatTokens(m.tokensIn)}</td>
													<td className="py-1.5 pr-2 text-right">{formatTokens(m.tokensOut)}</td>
													<td className="py-1.5 pr-2 text-right">{formatTokens(m.cacheReads)}</td>
													<td className="py-1.5 pr-2 text-right">{formatTokens(m.cacheWrites)}</td>
													<td className="py-1.5 pr-2 text-right">{formatCost(m.totalCost)}</td>
													<td className="py-1.5 text-right">{m.apiCalls}</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							)}

							{/* Daily bar chart */}
							{data.dailyUsage.length > 0 && (
								<div>
									<h3 className="mb-2 text-xs font-medium text-muted-foreground">This Month</h3>
									<div className="flex h-24 items-end gap-px">
										{data.dailyUsage.map((d) => {
											const total = d.tokensIn + d.tokensOut
											const height = Math.max(3, (total / maxDailyTokens) * 96)
											return (
												<div
													className="flex-1 rounded-t bg-cline/70 transition-colors hover:bg-cline/90"
													key={d.date}
													style={{ height: `${height}px` }}
													title={`${d.date}: In ${formatTokens(d.tokensIn)}, Out ${formatTokens(d.tokensOut)}, Cost ${formatCost(d.totalCost)}`}
												/>
											)
										})}
									</div>
									<div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
										<span>{data.dailyUsage[0]?.date}</span>
										<span>{data.dailyUsage[data.dailyUsage.length - 1]?.date}</span>
									</div>
								</div>
							)}
						</>
					)}
				</div>
			</Section>
		</div>
	)
}

function SummaryCard({ label, value, subtitle }: { label: string; value: string; subtitle?: string }) {
	return (
		<div className="rounded-lg border border-border-panel bg-code/50 p-3">
			<div className="text-xs text-muted-foreground">{label}</div>
			<div className="mt-1 text-sm font-semibold">{value}</div>
			{subtitle && <div className="mt-0.5 text-[10px] text-muted-foreground">{subtitle}</div>}
		</div>
	)
}

export default AnalyticsSection
