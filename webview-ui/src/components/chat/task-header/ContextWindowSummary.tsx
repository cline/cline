import React, { memo, useMemo } from "react"
import { formatLargeNumber as formatTokenNumber } from "@/utils/format"

interface TokenUsageInfoProps {
	tokensIn?: number
	tokensOut?: number
	cacheWrites?: number
	cacheReads?: number
}

interface TokenDetail {
	title: string
	value?: number
	icon: string
}

interface TaskContextWindowButtonsProps extends TokenUsageInfoProps {
	percentage: number
	tokenUsed: string
	contextWindow: string
	autoCompactThreshold?: number
	isThresholdChanged?: boolean
	isThresholdFadingOut?: boolean
}

// New accordion item component
const AccordionItem = memo<{
	title: string
	value: React.ReactNode
	children?: React.ReactNode
}>(({ title, value, children }) => {
	return (
		<div className="flex flex-col text-xs">
			<div className="flex justify-between items-center gap-3 rounded px-1 transition-colors text-foreground">
				<div className="flex items-center gap-1">
					<div className="font-semibold text-xs">{title}</div>
				</div>
				<div className="text-muted-foreground text-xs">{value}</div>
			</div>
			{children && <div className="mt-2 mb-1 text-xs text-muted-foreground px-1.5">{children}</div>}
		</div>
	)
})
AccordionItem.displayName = "AccordionItem"

// Constants
const TOKEN_DETAILS_CONFIG: Omit<TokenDetail, "value">[] = [
	{ title: "Prompt:", icon: "codicon-arrow-up" },
	{ title: "Completion:", icon: "codicon-arrow-down" },
	{ title: "Cache Writes:", icon: "codicon-arrow-left" },
	{ title: "Cache Reads:", icon: "codicon-arrow-right" },
]

const TokenUsageDetails = memo<TokenUsageInfoProps>(({ tokensIn, tokensOut, cacheWrites, cacheReads }) => {
	const contextTokenDetails = useMemo(() => {
		const values = [tokensIn, tokensOut, cacheWrites || 0, cacheReads || 0]
		return TOKEN_DETAILS_CONFIG.map((config, index) => ({ ...config, value: values[index] })).filter((item) => item.value)
	}, [tokensIn, tokensOut, cacheWrites, cacheReads])

	if (!tokensIn) {
		return <div>No token usage data available</div>
	}

	return (
		<div className="space-y-1">
			{contextTokenDetails.map((item) => (
				<div className="flex justify-between">
					<span>{item.title}</span>
					<span className="font-mono">{formatTokenNumber(item.value || 0)}</span>
				</div>
			))}
		</div>
	)
})
TokenUsageDetails.displayName = "TokenUsageDetails"

export const ContextWindowSummary: React.FC<TaskContextWindowButtonsProps> = ({
	contextWindow,
	tokenUsed,
	tokensIn,
	tokensOut,
	cacheWrites,
	cacheReads,
	percentage,
	autoCompactThreshold = 0,
}) => {
	const totalTokens = (tokensIn || 0) + (tokensOut || 0)

	return (
		<div className="context-window-tooltip-content flex flex-col gap-2 p-1">
			{autoCompactThreshold > 0 && (
				<AccordionItem
					title="Auto Condense Threshold"
					value={<span className="text-muted-foreground">{`${(autoCompactThreshold * 100).toFixed(0)}%`}</span>}>
					<div className="space-y-1">
						<p className="text-xs leading-relaxed text-white">
							Click on the context window bar to set a new threshold.
						</p>
						<p className="text-xs leading-relaxed mt-0 mb-0">
							When the context window usage exceeds this threshold, the task will be automatically condensed.
						</p>
					</div>
				</AccordionItem>
			)}

			<AccordionItem title="Context Window" value={percentage ? `${percentage.toFixed(1)}% used` : contextWindow}>
				<div className="space-y-1">
					<div className="flex justify-between">
						<span>Used:</span>
						<span className="font-mono">{tokenUsed}</span>
					</div>
					<div className="flex justify-between">
						<span>Total:</span>
						<span className="font-mono">{contextWindow}</span>
					</div>
					<div className="flex justify-between">
						<span>Remaining:</span>
						<span className="font-mono">
							{formatTokenNumber(parseInt(contextWindow.replace(/,/g, "")) - parseInt(tokenUsed.replace(/,/g, "")))}
						</span>
					</div>
				</div>
			</AccordionItem>

			{totalTokens > 0 && (
				<AccordionItem title="Token Usage" value={`${formatTokenNumber(totalTokens)} total`}>
					<TokenUsageDetails
						cacheReads={cacheReads}
						cacheWrites={cacheWrites}
						tokensIn={tokensIn}
						tokensOut={tokensOut}
					/>
				</AccordionItem>
			)}
		</div>
	)
}
