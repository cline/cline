import { Progress, Tooltip } from "@heroui/react"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { FoldVerticalIcon } from "lucide-react"
import React, { memo, useCallback, useMemo, useState } from "react"
import HeroTooltip from "@/components/common/HeroTooltip"
import { updateSetting } from "@/components/settings/utils/settingsHandlers"
import { formatSize } from "@/utils/format"
import { formatTokenNumber } from "./util"

// Type definitions
interface ContextWindowInfoProps {
	tokensIn?: number
	tokensOut?: number
	cacheWrites?: number
	cacheReads?: number
	size?: number
}

interface ContextWindowProgressProps extends ContextWindowInfoProps {
	useAutoCondense: boolean
	lastApiReqTotalTokens?: number
	contextWindow?: number
	autoCondenseThreshold?: number
	onSendMessage?: (command: string, files: string[], images: string[]) => void
}

interface TaskContextWindowButtonsProps extends ContextWindowInfoProps {
	percentage: number
	tokenUsed: string
	contextWindow: string
	autoCompactThreshold?: number
}

interface TokenDetail {
	title: string
	value?: number
	icon: string
}

// Constants
const TOKEN_DETAILS_CONFIG: Omit<TokenDetail, "value">[] = [
	{ title: "Prompt Tokens", icon: "codicon-arrow-up" },
	{ title: "Completion Tokens", icon: "codicon-arrow-down" },
	{ title: "Tokens written to cache", icon: "codicon-arrow-left" },
	{ title: "Tokens read from cache", icon: "codicon-arrow-right" },
]

const PROGRESS_CLASSES = {
	base: "w-full cursor-pointer",
	track: "drop-shadow-md bg-[var(--vscode-charts-yellow)]/40 rounded max-h-2",
	indicator: "bg-success rounded-r",
	label: "tracking-wider font-medium text-foreground/80",
	value: "text-description",
} as const

// Memoized sub-components
const InfoRow = memo<{ label: string; value: React.ReactNode }>(({ label, value }) => (
	<div className="flex justify-between gap-3">
		<div>{label}</div>
		<div className="text-muted-foreground">{value}</div>
	</div>
))
InfoRow.displayName = "InfoRow"

const TokenDetailItem = memo<TokenDetail>(({ title, value, icon }) => (
	<HeroTooltip content={title} key={`${icon}-${value}`}>
		<span className="flex items-center gap-0.5 cursor-pointer">
			<i className={`codicon ${icon} font-semibold`} />
			{formatTokenNumber(value)}
		</span>
	</HeroTooltip>
))
TokenDetailItem.displayName = "TokenDetailItem"

const ContextWindowHover = memo<TaskContextWindowButtonsProps>(
	({ contextWindow, tokenUsed, tokensIn, tokensOut, cacheWrites, cacheReads, size, percentage, autoCompactThreshold = 0 }) => (
		<div className="flex flex-col gap-2.5 bg-menu text-menu-foreground p-2 rounded shadow-sm">
			<InfoRow label="Size" value={formatSize(size)} />
			{tokensIn && (
				<ContextWindowInfo
					cacheReads={cacheReads}
					cacheWrites={cacheWrites}
					size={size}
					tokensIn={tokensIn}
					tokensOut={tokensOut}
				/>
			)}
			<InfoRow label="Context Window" value={`${tokenUsed} of ${contextWindow} (${percentage.toFixed(2)}%) used`} />
			{autoCompactThreshold > 0 && (
				<InfoRow label="Auto Condense Threshold" value={`${autoCompactThreshold.toFixed(2)}%`} />
			)}
		</div>
	),
)
ContextWindowHover.displayName = "ContextWindowHover"

const ContextWindowInfo = memo<ContextWindowInfoProps>(({ tokensIn, tokensOut, cacheWrites, cacheReads }) => {
	const contextTokenDetails = useMemo(() => {
		const values = [tokensIn, tokensOut, cacheWrites || 0, cacheReads || 0]
		return TOKEN_DETAILS_CONFIG.map((config, index) => ({ ...config, value: values[index] })).filter((item) => item.value)
	}, [tokensIn, tokensOut, cacheWrites, cacheReads])

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

const AutoCondenseMarker = memo<{ threshold: number; percentage: number }>(({ threshold, percentage }) => {
	if (!threshold) {
		return null
	}

	const markerPosition = useMemo(() => {
		if (threshold <= percentage) {
			return {
				start: `${threshold}%`,
				rounded: threshold.toFixed(0),
				end: `${percentage - threshold}%`,
			}
		}

		return {
			start: `${percentage}%`,
			rounded: threshold.toFixed(0),
			end: `${threshold - percentage}%`,
		}
	}, [threshold])

	return (
		<div
			className="absolute top-0 bottom-0 h-full w-1 bg-warning cursor-pointer pointer-events-none z-10"
			style={{ left: markerPosition.start, width: markerPosition.end }}
			title={`Auto compact threshold at ${markerPosition.rounded}%`}
		/>
	)
})
AutoCondenseMarker.displayName = "AutoCondenseMarker"

const ConfirmationDialog = memo<{
	onConfirm: (e: React.MouseEvent) => void
	onCancel: (e: React.MouseEvent) => void
}>(({ onConfirm, onCancel }) => (
	<div className="mt-1 flex items-center gap-1 justify-between">
		<span className="font-semibold">Compact the current task?</span>
		<span className="flex gap-1">
			<VSCodeButton className="bg-[green]/80" onClick={onConfirm} title="Yes, condense the task" type="button">
				Yes
			</VSCodeButton>
			<VSCodeButton
				className="bg-background/30 text-foreground"
				onClick={onCancel}
				title="No, keep the task as is"
				type="button">
				Cancel
			</VSCodeButton>
		</span>
	</div>
))
ConfirmationDialog.displayName = "ConfirmationDialog"

const ContextWindowProgress: React.FC<ContextWindowProgressProps> = ({
	contextWindow = 0,
	lastApiReqTotalTokens = 0,
	autoCondenseThreshold = 0.75,
	onSendMessage,
	useAutoCondense,
	tokensIn,
	tokensOut,
	cacheWrites,
	cacheReads,
	size,
}) => {
	const [threshold, setThreshold] = useState(() => autoCondenseThreshold * 100)
	const [confirmationNeeded, setConfirmationNeeded] = useState(false)

	const handleContextWindowBarClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
		const rect = event.currentTarget.getBoundingClientRect()
		const clickX = event.clientX - rect.left
		const percentage = Math.max(0, Math.min(100, (clickX / rect.width) * 100))
		setThreshold(percentage)
		updateSetting("autoCondenseThreshold", percentage / 100) // Convert to decimal for settings
	}, [])

	const handleCompactClick = useCallback((e: React.MouseEvent) => {
		e.preventDefault()
		e.stopPropagation()
		setConfirmationNeeded(true)
	}, [])

	const handleConfirm = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault()
			e.stopPropagation()
			onSendMessage?.("/compact", [], [])
			setConfirmationNeeded(false)
		},
		[onSendMessage],
	)

	const handleCancel = useCallback((e: React.MouseEvent) => {
		e.preventDefault()
		e.stopPropagation()
		setConfirmationNeeded(false)
	}, [])

	const tokenData = useMemo(() => {
		if (!contextWindow) {
			return null
		}
		const percentage = (lastApiReqTotalTokens / contextWindow) * 100
		return {
			percentage,
			max: formatTokenNumber(contextWindow),
			used: formatTokenNumber(lastApiReqTotalTokens),
		}
	}, [contextWindow, lastApiReqTotalTokens])

	if (!tokenData) {
		return null
	}

	const tooltipContent = (
		<ContextWindowHover
			autoCompactThreshold={threshold}
			cacheReads={cacheReads}
			cacheWrites={cacheWrites}
			contextWindow={tokenData.max}
			percentage={tokenData.percentage}
			size={size}
			tokensIn={tokensIn}
			tokensOut={tokensOut}
			tokenUsed={tokenData.used}
		/>
	)

	const progressClassNames = { ...PROGRESS_CLASSES }
	if (useAutoCondense) {
		progressClassNames.track += " bg-success/20"
	}

	return (
		<div className="flex flex-col">
			<div className="flex gap-1 flex-row @max-xs:flex-col @max-xs:items-start items-center text-sm">
				<div className="flex items-center gap-1.5 flex-1 whitespace-nowrap">
					<HeroTooltip content="Current tokens used in this request">
						<span className="cursor-pointer">{tokenData.used}</span>
					</HeroTooltip>
					<div className="flex relative items-center gap-1 flex-1 w-full">
						<Tooltip closeDelay={100} content={tooltipContent} placement="bottom" showArrow={true}>
							<div className="relative w-full" onClick={handleContextWindowBarClick}>
								<Progress
									aria-label="Context window usage"
									classNames={PROGRESS_CLASSES}
									color="success"
									key={`${tokenData.percentage}-${threshold}`}
									size="md"
									value={tokenData.percentage}
								/>
								{useAutoCondense && (
									<AutoCondenseMarker percentage={tokenData.percentage} threshold={threshold} />
								)}
							</div>
						</Tooltip>
					</div>
					<HeroTooltip content="Maximum context window size for this model">
						<span className="cursor-pointer">{tokenData.max}</span>
					</HeroTooltip>
				</div>
				<HeroTooltip content="Summarize Task to Reduce Context Usage">
					<VSCodeButton
						appearance="icon"
						className="flex items-center text-sm font-bold hover:bg-transparent hover:opacity-80"
						onClick={handleCompactClick}
						title="Summarize Task to Reduce Context Usage"
						type="button">
						<FoldVerticalIcon size={12} />
					</VSCodeButton>
				</HeroTooltip>
			</div>
			{confirmationNeeded && <ConfirmationDialog onCancel={handleCancel} onConfirm={handleConfirm} />}
		</div>
	)
}

export default memo(ContextWindowProgress)
