import { cn, Progress, Tooltip } from "@heroui/react"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { FoldVerticalIcon } from "lucide-react"
import React, { memo, useCallback, useMemo, useState } from "react"
import HeroTooltip from "@/components/common/HeroTooltip"
import { updateSetting } from "@/components/settings/utils/settingsHandlers"
import { AutoCondenseMarker } from "./AutoCondenseMarker"
import { ContextWindowSummary } from "./ContextWindowSummary"
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

const ConfirmationDialog = memo<{
	onConfirm: (e: React.MouseEvent) => void
	onCancel: (e: React.MouseEvent) => void
}>(({ onConfirm, onCancel }) => (
	<div className="text-xs mt-1.5 pb-2 flex items-center gap-0 justify-between">
		<span className="font-semibold text-xs">Compact the current task?</span>
		<span className="flex gap-1">
			<VSCodeButton
				appearance="secondary"
				className="text-xs"
				onClick={onCancel}
				title="No, keep the task as is"
				type="button">
				Cancel
			</VSCodeButton>
			<VSCodeButton
				appearance="primary"
				className="text-xs"
				onClick={onConfirm}
				title="Yes, compact the task"
				type="button">
				Yes
			</VSCodeButton>
		</span>
	</div>
))
ConfirmationDialog.displayName = "ConfirmationDialog"

const ContextWindow: React.FC<ContextWindowProgressProps> = ({
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
	const [isOpened, setIsOpened] = useState(false)
	const [threshold, setThreshold] = useState(useAutoCondense ? autoCondenseThreshold : 0)
	const [confirmationNeeded, setConfirmationNeeded] = useState(false)

	const handleContextWindowBarClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
		const rect = event.currentTarget.getBoundingClientRect()
		const clickX = event.clientX - rect.left
		const percentage = Math.max(0, Math.min(1, clickX / rect.width))
		const newThreshold = Math.round(percentage * 100) / 100
		setConfirmationNeeded(false)
		setThreshold(newThreshold)
		updateSetting("autoCondenseThreshold", newThreshold)
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
		return {
			percentage: (lastApiReqTotalTokens / contextWindow) * 100,
			max: formatTokenNumber(contextWindow),
			used: formatTokenNumber(lastApiReqTotalTokens),
		}
	}, [contextWindow, lastApiReqTotalTokens])

	if (!tokenData) {
		return null
	}

	return (
		<div className="flex flex-col my-1.5" onMouseEnter={() => setIsOpened(true)} onMouseLeave={() => setIsOpened(false)}>
			<div className="flex gap-1 flex-row @max-xs:flex-col @max-xs:items-start items-center text-sm">
				<div className="flex items-center gap-1.5 flex-1 whitespace-nowrap text-xs">
					<span className="cursor-pointer" title="Current tokens used in this request">
						{tokenData.used}
					</span>
					<div className="flex relative items-center gap-1 flex-1 w-full h-full">
						<Tooltip
							closeDelay={1000}
							content={
								<ContextWindowSummary
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
							}
							isOpen={isOpened}
							placement="bottom"
							showArrow={true}>
							<div className="relative w-full text-badge-foreground context-window-progress brightness-100">
								<Progress
									aria-label="Context window usage progress"
									classNames={{
										base: "drop-shadow-md w-full cursor-pointer",
										track: cn("rounded max-h-2 h-3 bg-warning"),
										indicator: "bg-success rounded-r",
										label: "tracking-wider font-medium text-foreground/80",
										value: "text-description",
									}}
									color="success"
									onClick={handleContextWindowBarClick}
									size="md"
									value={tokenData.percentage}
								/>
								{useAutoCondense && (
									<AutoCondenseMarker key={threshold} threshold={threshold} usage={tokenData.percentage} />
								)}
							</div>
						</Tooltip>
					</div>
					<span className="cursor-pointer" title="Maximum context window size for this model">
						{tokenData.max}
					</span>
				</div>
				<HeroTooltip content="Summarize Task to Reduce Context Usage">
					<VSCodeButton
						appearance="icon"
						className="text-badge-foreground flex items-center text-sm font-bold hover:bg-transparent hover:opacity-80 -mt-1.5"
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

export default memo(ContextWindow)
