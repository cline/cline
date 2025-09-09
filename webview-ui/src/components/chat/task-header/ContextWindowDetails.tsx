import { Tooltip } from "@heroui/react"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import React, { useCallback, useState } from "react"
import HeroTooltip from "@/components/common/HeroTooltip"
import { updateSetting } from "@/components/settings/utils/settingsHandlers"
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
	onSendMessage?: (command: string, files: string[], images: string[]) => void
}

const CONTEXT_WINDOW_ACTIONS = [
	{ title: "Smol", command: "/smol", tooltip: "Reduce prompt token usage" },
	{ title: "Compact", command: "/compact", tooltip: "Summarize the current task" },
]

const ContextWindowProgressBar: React.FC<ContextWindowProgressBarProps> = ({
	contextWindow = 0,
	lastApiReqTotalTokens = 0,
	autoCondenseThreshold,
	onSendMessage,
	useAutoCondense,
}) => {
	const [autoCompactMarker, setAutoCompactMarker] = useState(autoCondenseThreshold)

	const handleContextWindowBarClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
		const rect = event.currentTarget.getBoundingClientRect()
		const clickX = event.clientX - rect.left
		const percentage = Math.max(0, Math.min(100, (clickX / rect.width) * 100))
		console.log("Setting auto compact marker to", percentage)
		updateSetting("autoCondenseThreshold", percentage)
		setAutoCompactMarker(percentage)
	}, [])

	if (!contextWindow) {
		return null
	}

	const usagePercentage = contextWindow ? ((lastApiReqTotalTokens || 0) / contextWindow) * 100 : 0
	const formattedContextWindow = formatTokenNumber(contextWindow)
	const tokenUsed = formatTokenNumber(lastApiReqTotalTokens)

	const TaskContextWindowButtons: React.FC<TaskContextWindowButtonsProps> = ({ contextWindow, tokenUsed, onSendMessage }) => {
		return (
			<div className="flex flex-col gap-2.5 bg-menu text-menu-foreground p-2 rounded shadow-sm">
				<header className="flex justify-between gap-3">
					<div>Context Window</div>
					<div className="text-muted-foreground">
						{tokenUsed} of {contextWindow} used
					</div>
				</header>
				<div className="flex items-center gap-2 justify-evenly">
					{CONTEXT_WINDOW_ACTIONS.map((action) => (
						<VSCodeButton
							appearance="secondary"
							className="rounded-sm grow cursor-pointer"
							key={action.command}
							onClick={(e) => {
								e.preventDefault()
								e.stopPropagation()
								onSendMessage?.(action.command, [], [])
							}}
							type="button">
							{action.title}
						</VSCodeButton>
					))}
				</div>
			</div>
		)
	}

	return (
		<div className="flex gap-1 flex-row @max-xs:flex-col @max-xs:items-start items-center text-sm">
			<div className="flex items-center gap-2 flex-[1] whitespace-nowrap">
				<HeroTooltip content="Current tokens used in this request">
					<span className="cursor-pointer">{tokenUsed}</span>
				</HeroTooltip>
				<div className="flex items-center gap-1 flex-[1]">
					<Tooltip
						closeDelay={100}
						content={
							<TaskContextWindowButtons
								contextWindow={formattedContextWindow}
								onSendMessage={onSendMessage}
								tokenUsed={tokenUsed}
							/>
						}
						placement="bottom"
						showArrow={true}>
						<div
							className="relative cursor-pointer flex-[1] h-1.5 border-[var(--vscode-charts-green)]/20 border-1 rounded overflow-hidden"
							onClick={handleContextWindowBarClick}>
							<div
								className="h-full w-full bg-[var(--vscode-charts-green)]"
								style={{ width: `${usagePercentage}%` }}
							/>
							{useAutoCondense && (
								<div
									className="absolute top-0 bottom-0 h-full w-1 bg-[var(--vscode-charts-yellow)] cursor-pointer"
									style={{ left: `${autoCompactMarker}%` }}
									title={`Auto compact threshold at ${autoCompactMarker?.toFixed(0)}%`}
								/>
							)}
						</div>
					</Tooltip>
					<HeroTooltip content="Maximum context window size for this model">
						<span className="cursor-pointer">{formattedContextWindow}</span>
					</HeroTooltip>
				</div>
			</div>
		</div>
	)
}

export default ContextWindowProgressBar
