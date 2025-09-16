import React, { memo, useEffect, useMemo, useState } from "react"
import HeroTooltip from "@/components/common/HeroTooltip"
import { cn } from "@/utils/cn"
import { formatSize } from "@/utils/format"
import { formatTokenNumber } from "./util"

interface TokenUsageInfoProps {
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

interface TaskContextWindowButtonsProps extends TokenUsageInfoProps {
	percentage: number
	tokenUsed: string
	contextWindow: string
	autoCompactThreshold?: number
	isThresholdChanged?: boolean
	isThresholdFadingOut?: boolean
}

const InfoRow = memo<{ label: string; value: React.ReactNode }>(({ label, value }) => (
	<div className="flex justify-between gap-3">
		<div className="font-semibold">{label}</div>
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

const TokenUsageInfo = memo<TokenUsageInfoProps>(({ tokensIn, tokensOut, cacheWrites, cacheReads }) => {
	const contextTokenDetails = useMemo(() => {
		const values = [tokensIn, tokensOut, cacheWrites || 0, cacheReads || 0]
		return TOKEN_DETAILS_CONFIG.map((config, index) => ({ ...config, value: values[index] })).filter((item) => item.value)
	}, [tokensIn, tokensOut, cacheWrites, cacheReads])

	const TokenDetailItem = memo<TokenDetail>(({ title, value, icon }) => (
		<HeroTooltip content={title} key={`${icon}-${value}`}>
			<span className="flex items-center gap-0.5 cursor-pointer text-muted-foreground">
				<i className={`codicon ${icon} font-semibold `} />
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
			<div className="font-semibold">Token Usage</div>
			<div className="flex items-center justify-between flex-wrap gap-1 opacity-80">
				{contextTokenDetails.map((item) => (
					<TokenDetailItem key={item.icon} {...item} />
				))}
			</div>
		</div>
	)
})
TokenUsageInfo.displayName = "TokenUsageInfo"

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
}) => {
	const [thresholdDisplay, setThresholdDisplay] = useState(autoCompactThreshold)
	const [isThresholdChanged, setIsThresholdChanged] = useState<"up" | "down" | undefined>(undefined)
	const [isThresholdFadingOut, setIsThresholdFadingOut] = useState(false)

	useEffect(() => {
		if (autoCompactThreshold !== thresholdDisplay) {
			const type = autoCompactThreshold > thresholdDisplay ? "up" : "down"
			setIsThresholdChanged(type)
			setThresholdDisplay(autoCompactThreshold)
			return () => {
				setTimeout(() => {
					setIsThresholdFadingOut(true)
					setTimeout(() => {
						setIsThresholdChanged(undefined)
						setIsThresholdFadingOut(false)
					}, 1000) // Duration of fade-out effect
				}, 2000) // Duration to show the changed value before starting fade-out
			}
		}
	}, [autoCompactThreshold, thresholdDisplay])

	return (
		<div className="flex flex-col gap-2.5 bg-menu rounded shadow-sm border border-menu-border z-100 min-w-xs p-4">
			{thresholdDisplay > 0 && (
				<InfoRow
					key={thresholdDisplay}
					label="Auto Condense Threshold"
					value={
						<span
							className={cn({
								"transition-all": !isThresholdChanged && !isThresholdFadingOut,
								"text-success/50 transition-discrete": isThresholdChanged === "up" && !isThresholdFadingOut,
								"text-error/50 transition-discrete": isThresholdChanged === "down" && !isThresholdFadingOut,
								"text-muted-foreground transition-all": isThresholdFadingOut,
							})}>{`${(thresholdDisplay * 100).toFixed(2)}%`}</span>
					}
				/>
			)}
			<InfoRow
				label="Context Window"
				value={percentage ? `${tokenUsed} of ${contextWindow} (${percentage.toFixed(2)}%) used` : contextWindow}
			/>
			<TokenUsageInfo
				cacheReads={cacheReads}
				cacheWrites={cacheWrites}
				size={size}
				tokensIn={tokensIn}
				tokensOut={tokensOut}
			/>
			<InfoRow label="Size" value={formatSize(size)} />
		</div>
	)
}
