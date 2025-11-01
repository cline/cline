import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import debounce from "debounce"
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { updateSetting } from "@/components/settings/utils/settingsHandlers"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { Progress } from "@/components/ui/progress"
import { formatLargeNumber as formatTokenNumber } from "@/utils/format"
import { AutoCondenseMarker } from "./AutoCondenseMarker"
import CompactTaskButton from "./buttons/CompactTaskButton"
import { ContextWindowSummary } from "./ContextWindowSummary"

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
	<div className="text-sm my-2 flex items-center gap-0 justify-between">
		<span className="font-semibold text-sm">Compact the current task?</span>
		<span className="flex gap-1">
			<VSCodeButton
				appearance="secondary"
				className="text-sm"
				onClick={onCancel}
				title="No, keep the task as is"
				type="button">
				Cancel
			</VSCodeButton>
			<VSCodeButton
				appearance="primary"
				autoFocus={true}
				className="text-sm"
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
}) => {
	const [isOpened, setIsOpened] = useState(false)
	const [threshold, setThreshold] = useState(useAutoCondense ? autoCondenseThreshold : 0)
	const [confirmationNeeded, setConfirmationNeeded] = useState(false)
	const progressBarRef = useRef<HTMLDivElement>(null)
	const [shouldAnimateMarker, setShouldAnimateMarker] = useState(false)

	// Trigger marker animation when component first mounts (TaskHeader expands)
	useEffect(() => {
		if (useAutoCondense && threshold > 0) {
			setShouldAnimateMarker(true)
			// Reset animation flag after animation completes
			const timer = setTimeout(() => {
				setShouldAnimateMarker(false)
			}, 1400) // Slightly longer than animation duration (1200ms + buffer)
			return () => clearTimeout(timer)
		}
	}, []) // Empty dependency array means this only runs on mount

	const handleContextWindowBarClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
		const rect = event.currentTarget.getBoundingClientRect()
		const clickX = event.clientX - rect.left
		const percentage = Math.max(0, Math.min(1, clickX / rect.width))
		const newThreshold = Math.round(percentage * 100) / 100
		setConfirmationNeeded(false)
		setThreshold(newThreshold)
		updateSetting("autoCondenseThreshold", newThreshold)
	}, [])

	const handleCompactClick = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault()
			e.stopPropagation()
			setConfirmationNeeded(!confirmationNeeded)
		},
		[confirmationNeeded],
	)

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
			max: contextWindow,
			used: lastApiReqTotalTokens,
		}
	}, [contextWindow, lastApiReqTotalTokens])

	const debounceCloseHover = useCallback((e: React.MouseEvent) => {
		e.preventDefault()
		e.stopPropagation()
		const showHover = debounce((open: boolean) => setIsOpened(open), 100)

		return showHover(false)
	}, [])

	// Keyboard event handlers
	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			if (!useAutoCondense) {
				return
			}

			const step = event.shiftKey ? 0.1 : 0.05 // Larger step with Shift
			let newThreshold = threshold

			switch (event.key) {
				case "ArrowLeft":
				case "ArrowDown":
					event.preventDefault()
					event.stopPropagation()
					setIsOpened(true) // Keep tooltip open on interaction
					newThreshold = Math.max(0, threshold - step)
					break
				case "ArrowRight":
				case "ArrowUp":
					event.preventDefault()
					event.stopPropagation()
					setIsOpened(true) // Keep tooltip open on interaction
					newThreshold = Math.min(1, threshold + step)
					break
				default:
					return
			}

			if (newThreshold !== threshold) {
				setThreshold(newThreshold)
				updateSetting("autoCondenseThreshold", newThreshold)
			}
		},
		[threshold, useAutoCondense, setIsOpened],
	)

	const handleFocus = useCallback(() => {
		setIsOpened(true)
	}, [])

	// Close tooltip when clicking outside
	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			const target = event.target as Element
			const isInsideProgressBar = progressBarRef.current && progressBarRef.current.contains(target as Node)

			// Check if click is inside any tooltip content by looking for our custom class
			const isInsideTooltipContent = target.closest(".context-window-tooltip-content") !== null

			if (!isInsideProgressBar && !isInsideTooltipContent) {
				setIsOpened(false)
			}
		}

		if (isOpened) {
			document.addEventListener("mousedown", handleClickOutside)
			return () => document.removeEventListener("mousedown", handleClickOutside)
		}
	}, [isOpened])

	if (!tokenData) {
		return null
	}

	return (
		<div className="flex flex-col my-1.5" onMouseLeave={debounceCloseHover}>
			<div className="flex gap-1 flex-row @max-xs:flex-col @max-xs:items-start items-center text-sm">
				<div className="flex items-center gap-1.5 flex-1 whitespace-nowrap">
					<span className="cursor-pointer text-sm" title="Current tokens used in this request">
						{formatTokenNumber(tokenData.used)}
					</span>
					<div className="flex relative items-center gap-1 flex-1 w-full h-full" onMouseEnter={() => setIsOpened(true)}>
						<HoverCard>
							<HoverCardContent className="bg-menu rounded-xs shadow-sm">
								<ContextWindowSummary
									autoCompactThreshold={useAutoCondense ? threshold : undefined}
									cacheReads={cacheReads}
									cacheWrites={cacheWrites}
									contextWindow={tokenData.max}
									percentage={tokenData.percentage}
									tokensIn={tokensIn}
									tokensOut={tokensOut}
									tokenUsed={tokenData.used}
								/>
							</HoverCardContent>
							<HoverCardTrigger asChild>
								<div
									aria-label="Auto condense threshold"
									aria-valuemax={100}
									aria-valuemin={0}
									aria-valuenow={Math.round(threshold * 100)}
									aria-valuetext={`${Math.round(threshold * 100)}% threshold`}
									className="relative w-full text-foreground context-window-progress brightness-100"
									onFocus={handleFocus}
									onKeyDown={handleKeyDown}
									ref={progressBarRef}
									role="slider"
									tabIndex={useAutoCondense ? 0 : -1}>
									<Progress
										aria-label="Context window usage progress"
										color="success"
										onClick={handleContextWindowBarClick}
										value={tokenData.percentage}
									/>
									{useAutoCondense && (
										<AutoCondenseMarker
											isContextWindowHoverOpen={isOpened}
											shouldAnimate={shouldAnimateMarker}
											threshold={threshold}
											usage={tokenData.percentage}
										/>
									)}
									{isOpened}
								</div>
							</HoverCardTrigger>
						</HoverCard>
					</div>
					<span className="cursor-pointer text-sm" title="Maximum context window size for this model">
						{formatTokenNumber(tokenData.max)}
					</span>
				</div>
				<CompactTaskButton onClick={handleCompactClick} />
			</div>
			{confirmationNeeded && <ConfirmationDialog onCancel={handleCancel} onConfirm={handleConfirm} />}
		</div>
	)
}

export default memo(ContextWindow)
