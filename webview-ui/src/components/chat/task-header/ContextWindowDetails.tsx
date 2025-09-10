import { Progress, Tooltip } from "@heroui/react"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { FoldVerticalIcon } from "lucide-react"
import React, { useCallback, useMemo, useState } from "react"
import HeroTooltip from "@/components/common/HeroTooltip"
import { updateSetting } from "@/components/settings/utils/settingsHandlers"
import { formatSize } from "@/utils/format"
import { formatTokenNumber } from "./util"

interface ContextWindowProgressBarProps {
	useAutoCondense: boolean
	lastApiReqTotalTokens?: number
	contextWindow?: number
	autoCondenseThreshold?: number
	onSendMessage?: (command: string, files: string[], images: string[]) => void
}

interface TaskContextWindowButtonsProps {
	tokenUsed: string
	contextWindow: string
	autoCompactThreshold?: number
}

const ContextWindowHover: React.FC<TaskContextWindowButtonsProps> = ({ contextWindow, tokenUsed, autoCompactThreshold = 0 }) => {
	return (
		<div className="flex flex-col gap-2.5 bg-menu text-menu-foreground p-2 rounded shadow-sm">
			<header className="flex justify-between gap-3">
				<div>Context Window</div>
				<div className="text-muted-foreground">
					{tokenUsed} of {contextWindow} used
				</div>
			</header>
			{autoCompactThreshold > 0 && <div className="flex">Auto condense at {autoCompactThreshold.toFixed(2)}%</div>}
		</div>
	)
}

interface ContextWindowInfoProps {
	tokensIn?: number
	tokensOut?: number
	cacheWrites?: number
	cacheReads?: number
	size?: number
}

export const ContextWindowInfo: React.FC<ContextWindowInfoProps> = ({ tokensIn, tokensOut, cacheWrites, cacheReads, size }) => {
	const contextTokenDetails = useMemo(
		() =>
			[
				{ title: "Prompt Tokens", value: tokensIn, icon: "codicon-arrow-up" },
				{ title: "Completion Tokens", value: tokensOut, icon: "codicon-arrow-down" },
				{
					title: "Tokens written to cache",
					value: cacheWrites || 0,
					icon: "codicon-arrow-left",
				},
				{
					title: "Tokens read from cache",
					value: cacheReads || 0,
					icon: "codicon-arrow-right",
				},
			].filter((item) => item.value),
		[tokensIn, tokensOut, cacheWrites, cacheReads],
	)

	if (!tokensIn) {
		return null
	}

	return (
		<div className="flex items-center justify-between flex-wrap gap-2 text-xs">
			<div className="flex items-center flex-wrap gap-1 opacity-80">
				<div className="font-semibold">Tokens:</div>
				{contextTokenDetails.map((item) => (
					<HeroTooltip content={item.title}>
						<span className="flex items-center gap-0.5 cursor-pointer">
							<i className={`codicon ${item.icon} font-semibold`} />
							{formatTokenNumber(item.value)}
						</span>
					</HeroTooltip>
				))}
			</div>
			<HeroTooltip content="Task size on disk">
				<div className="opacity-80 mr-1">{formatSize(size)}</div>
			</HeroTooltip>
		</div>
	)
}

const AutoCondenseMarker: React.FC<{
	threshold: number
}> = ({ threshold }) => {
	if (!threshold) {
		return null
	}
	return (
		<div
			className="absolute top-0 bottom-0 h-full w-1 bg-[var(--vscode-charts-yellow)] cursor-pointer pointer-events-none z-10"
			style={{ left: `${threshold}%` }}
			title={`Auto compact threshold at ${threshold?.toFixed(0)}%`}
		/>
	)
}

const ContextWindowProgressBar: React.FC<ContextWindowProgressBarProps> = ({
	contextWindow = 0,
	lastApiReqTotalTokens = 0,
	autoCondenseThreshold = 0.75,
	onSendMessage,
	useAutoCondense,
}) => {
	const [autoCompactMarker, setAutoCompactMarker] = useState(autoCondenseThreshold * 100)
	const [confirmationNeeded, setConfirmationNeeded] = useState(false)

	const handleContextWindowBarClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
		const rect = event.currentTarget.getBoundingClientRect()
		const clickX = event.clientX - rect.left
		const percentage = Math.max(0, Math.min(100, (clickX / rect.width) * 100))
		setAutoCompactMarker(percentage)
		updateSetting("autoCondenseThreshold", percentage)
	}, [])

	const token = useMemo(() => {
		const percentage = contextWindow ? (lastApiReqTotalTokens / contextWindow) * 100 : 0
		const max = formatTokenNumber(contextWindow)
		const used = formatTokenNumber(lastApiReqTotalTokens)
		return { percentage, max, used }
	}, [contextWindow, lastApiReqTotalTokens])

	if (!contextWindow) {
		return null
	}

	return (
		<div className="flex flex-col">
			<div className="flex gap-1 flex-row @max-xs:flex-col @max-xs:items-start items-center text-sm">
				<ContextWindowInfo />
				<div className="flex items-center gap-1.5 flex-1 whitespace-nowrap">
					<HeroTooltip content="Current tokens used in this request">
						<span className="cursor-pointer">{token.used}</span>
					</HeroTooltip>
					<div className="flex relative items-center gap-1 flex-1 w-full">
						<Tooltip
							closeDelay={100}
							content={
								<ContextWindowHover
									autoCompactThreshold={autoCompactMarker}
									contextWindow={token.max}
									tokenUsed={token.used}
								/>
							}
							placement="bottom"
							showArrow={true}>
							<div className="relative w-full" onClick={handleContextWindowBarClick}>
								<Progress
									aria-label="Context window usage"
									classNames={{
										base: "w-full cursor-pointer",
										track: "drop-shadow-md bg-success/20 rounded",
										indicator: "bg-success",
										label: "tracking-wider font-medium text-foreground/80",
										value: "text-foreground/60",
									}}
									color="success"
									size="md"
									value={token.percentage}
								/>
								{useAutoCondense && <AutoCondenseMarker key={autoCompactMarker} threshold={autoCompactMarker} />}
							</div>
						</Tooltip>
					</div>
					<HeroTooltip content="Maximum context window size for this model">
						<span className="cursor-pointer">{token.max}</span>
					</HeroTooltip>
				</div>
				<VSCodeButton
					appearance="icon"
					className="m-0"
					key="compact"
					onClick={(e) => {
						e.preventDefault()
						e.stopPropagation()
						setConfirmationNeeded(true)
					}}
					title="Summarize Task to Reduce Context Usage"
					type="button">
					<FoldVerticalIcon size={12} />
				</VSCodeButton>
			</div>
			{confirmationNeeded && (
				<div className="mt-1 flex items-center gap-2 justify-between">
					<span className="font-semibold">Compact the current task?</span>
					<span className="flex gap-2">
						<VSCodeButton
							onClick={(e) => {
								e.preventDefault()
								e.stopPropagation()
								onSendMessage?.("/compact", [], [])
								setConfirmationNeeded(false)
							}}
							title="Yes, condense the task"
							type="button">
							Yes
						</VSCodeButton>
						<VSCodeButton
							appearance="secondary"
							onClick={(e) => {
								e.preventDefault()
								e.stopPropagation()
								setConfirmationNeeded(false)
							}}
							title="No, keep the task as is"
							type="button">
							Cancel
						</VSCodeButton>
					</span>
				</div>
			)}
		</div>
	)
}

export default ContextWindowProgressBar
