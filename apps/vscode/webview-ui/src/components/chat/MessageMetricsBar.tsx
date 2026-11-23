import type { ClineApiReqInfo } from "@shared/ExtensionMessage"
import { ArrowDownIcon, ArrowUpIcon, ClockIcon, CpuIcon, DatabaseIcon, ZapIcon } from "lucide-react"
import { memo } from "react"

interface MessageMetricsBarProps {
	metrics?: ClineApiReqInfo
	contextWindow?: number
}

function formatCompactCount(n: number): string {
	if (n >= 1_000_000) {
		return `${(n / 1_000_000).toFixed(1)}M`
	}
	if (n >= 10_000) {
		return `${(n / 1000).toFixed(1)}k`
	}
	return n.toLocaleString()
}

function formatDuration(ms: number): string {
	if (ms < 1000) {
		return `${Math.round(ms)}ms`
	}
	return `${(ms / 1000).toFixed(1)}s`
}

function shortenModelId(modelId?: string): string | undefined {
	if (!modelId) {
		return undefined
	}
	const parts = modelId.split("/")
	return parts[parts.length - 1] || modelId
}

export const MessageMetricsBar = memo(({ metrics, contextWindow }: MessageMetricsBarProps) => {
	if (!metrics) {
		return null
	}

	const tokensIn = metrics.tokensIn ?? 0
	const tokensOut = metrics.tokensOut ?? 0
	const cacheReads = metrics.cacheReads ?? 0
	const cacheWrites = metrics.cacheWrites ?? 0
	const totalPromptTokens = tokensIn + cacheReads + cacheWrites
	const hasUsage = tokensIn > 0 || tokensOut > 0 || (metrics.tokensPerSecond ?? 0) > 0 || (metrics.durationMs ?? 0) > 0

	if (!hasUsage) {
		return null
	}

	const cacheHitPct = totalPromptTokens > 0 && cacheReads > 0 ? Math.round((cacheReads / totalPromptTokens) * 100) : undefined
	const ctxPct =
		contextWindow && contextWindow > 0 && totalPromptTokens + tokensOut > 0
			? Math.min(100, Math.round(((totalPromptTokens + tokensOut) / contextWindow) * 100))
			: undefined
	const shortModel = shortenModelId(metrics.modelId)

	return (
		<div
			className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2.5 pt-1.5 border-t border-white/[0.05] font-geist-mono text-[10.5px] tabular-nums text-[#6d737c] hover:text-[#adb3bc] select-none transition-colors"
			data-testid="message-metrics-bar">
			{metrics.tokensPerSecond !== undefined && metrics.tokensPerSecond > 0 && (
				<span className="inline-flex items-center gap-1 text-[#c5cad2] font-medium" title="Velocità di generazione">
					<ZapIcon size={10.5} strokeWidth={2} />
					{metrics.tokensPerSecond.toFixed(1)} tok/s
				</span>
			)}

			{(tokensIn > 0 || tokensOut > 0) && (
				<span className="inline-flex items-center gap-1.5" title={`Input: ${totalPromptTokens} | Output: ${tokensOut}`}>
					<span className="inline-flex items-center gap-0.5">
						<ArrowDownIcon size={10} strokeWidth={2} />
						{formatCompactCount(totalPromptTokens)}
					</span>
					<span className="opacity-40">/</span>
					<span className="inline-flex items-center gap-0.5">
						<ArrowUpIcon size={10} strokeWidth={2} />
						{formatCompactCount(tokensOut)}
					</span>
				</span>
			)}

			{metrics.durationMs !== undefined && metrics.durationMs > 0 && (
				<span
					className="inline-flex items-center gap-1"
					title={
						metrics.ttftMs !== undefined
							? `Durata totale: ${formatDuration(metrics.durationMs)} · TTFT: ${formatDuration(metrics.ttftMs)}`
							: `Durata totale: ${formatDuration(metrics.durationMs)}`
					}>
					<ClockIcon size={10} strokeWidth={2} />
					{formatDuration(metrics.durationMs)}
					{metrics.ttftMs !== undefined && metrics.ttftMs > 0 && (
						<span className="text-[#5a6069]">(TTFT {formatDuration(metrics.ttftMs)})</span>
					)}
				</span>
			)}

			{cacheHitPct !== undefined && (
				<span className="inline-flex items-center gap-1" title={`Cache hit: ${cacheReads.toLocaleString()} token`}>
					<DatabaseIcon size={10} strokeWidth={1.9} />
					cache {cacheHitPct}%
				</span>
			)}

			{ctxPct !== undefined && (
				<span title={`Utilizzo Context Window (${contextWindow?.toLocaleString()} token)`}>ctx {ctxPct}%</span>
			)}

			{metrics.cost !== undefined && metrics.cost > 0 && (
				<span title="Costo stimato richiesta">${metrics.cost.toFixed(4)}</span>
			)}

			{shortModel && (
				<span className="inline-flex items-center gap-1 ml-auto text-[#5e646e] truncate max-w-[200px]" title={metrics.modelId}>
					<CpuIcon size={10} strokeWidth={1.8} />
					{shortModel}
				</span>
			)}
		</div>
	)
})

MessageMetricsBar.displayName = "MessageMetricsBar"
