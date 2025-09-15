import React, { memo, useMemo } from "react"
import HeroTooltip from "@/components/common/HeroTooltip"
import { formatSize } from "@/utils/format"
import { formatTokenNumber } from "./util"

interface ContextWindowInfoProps {
	tokensIn?: number
	tokensOut?: number
	cacheWrites?: number
	cacheReads?: number
	size?: number
}

interface TokenDetail {
	title: string
	value?: number
	icon: string
}

interface TaskContextWindowButtonsProps extends ContextWindowInfoProps {
	percentage: number
	tokenUsed: string
	contextWindow: string
	autoCompactThreshold?: number
	isThresholdChanged?: boolean
	isThresholdFadingOut?: boolean
}

const InfoRow = memo<{ label: string; value: React.ReactNode }>(({ label, value }) => (
	<div className="flex justify-between gap-3">
		<div>{label}</div>
		<div className="text-muted-foreground">{value}</div>
	</div>
))
InfoRow.displayName = "InfoRow"

// Constants
const TOKEN_DETAILS_CONFIG: Omit<TokenDetail, "value">[] = [
	{ title: "Prompt Tokens", icon: "codicon-arrow-up" },
	{ title: "Completion Tokens", icon: "codicon-arrow-down" },
	{ title: "Tokens written to cache", icon: "codicon-arrow-left" },
	{ title: "Tokens read from cache", icon: "codicon-arrow-right" },
]

const ContextWindowInfo = memo<ContextWindowInfoProps>(({ tokensIn, tokensOut, cacheWrites, cacheReads }) => {
	const contextTokenDetails = useMemo(() => {
		const values = [tokensIn, tokensOut, cacheWrites || 0, cacheReads || 0]
		return TOKEN_DETAILS_CONFIG.map((config, index) => ({ ...config, value: values[index] })).filter((item) => item.value)
	}, [tokensIn, tokensOut, cacheWrites, cacheReads])

	const TokenDetailItem = memo<TokenDetail>(({ title, value, icon }) => (
		<HeroTooltip content={title} key={`${icon}-${value}`}>
			<span className="flex items-center gap-0.5 cursor-pointer">
				<i className={`codicon ${icon} font-semibold`} />
				{formatTokenNumber(value)}
			</span>
		</HeroTooltip>
	))
	TokenDetailItem.displayName = "TokenDetailItem"

	if (!tokensIn) {
		return null
	}

	return (
		<div className="flex items-center justify-between flex-wrap">
			<div className="font-semibold">Tokens</div>
			<div className="flex items-center justify-between flex-wrap gap-1 opacity-80">
				{contextTokenDetails.map((item) => (
					<TokenDetailItem key={item.icon} {...item} />
				))}
			</div>
		</div>
	)
})
ContextWindowInfo.displayName = "ContextWindowInfo"

export const ContextWindowSummary: React.FC<TaskContextWindowButtonsProps> = ({
	contextWindow,
	tokenUsed,
	tokensIn,
	tokensOut,
	cacheWrites,
	cacheReads,
	size,
	percentage,
	autoCompactThreshold = 0,
	isThresholdChanged = false,
	isThresholdFadingOut = false,
}) => {
	const getThresholdClass = () => {
		if (isThresholdChanged && !isThresholdFadingOut) {
			return "threshold-value-changed" // Instant green
		} else if (isThresholdChanged && isThresholdFadingOut) {
			return "threshold-value-fadeout" // Smooth fadeout
		}
		return "" // Normal color
	}

	return (
		<div className="flex flex-col gap-2.5 bg-menu text-menu-foreground p-2 rounded shadow-sm">
			<style>
				{`
					.threshold-value-changed {
						color: var(--vscode-charts-green) !important;
						transition: none;
					}
					.threshold-value-fadeout {
						transition: color 2s ease-out;
					}
				`}
			</style>
			{autoCompactThreshold > 0 && (
				<InfoRow
					label="Auto Condense Threshold"
					value={<span className={getThresholdClass()}>{`${(autoCompactThreshold * 100).toFixed(2)}%`}</span>}
				/>
			)}
			<ContextWindowInfo
				cacheReads={cacheReads}
				cacheWrites={cacheWrites}
				size={size}
				tokensIn={tokensIn}
				tokensOut={tokensOut}
			/>
			<InfoRow
				label="Context Window"
				value={percentage ? `${tokenUsed} of ${contextWindow} (${percentage.toFixed(2)}%) used` : contextWindow}
			/>
			<InfoRow label="Size" value={formatSize(size)} />
		</div>
	)
}
