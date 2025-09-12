import { ClineMessage } from "@shared/ExtensionMessage"
import { StringRequest } from "@shared/proto/cline/common"
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useWindowSize } from "react-use"
import Thumbnails from "@/components/common/Thumbnails"
import { getModeSpecificFields, normalizeApiConfiguration } from "@/components/settings/utils/providerUtils"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { UiServiceClient } from "@/services/grpc-client"
import { cn } from "@/utils/cn"
import CopyTaskButton from "./buttons/CopyTaskButton"
import DeleteTaskButton from "./buttons/DeleteTaskButton"
import OpenDiskTaskHistoryButton from "./buttons/OpenDiskTaskHistoryButton"
import RetryTaskButton from "./buttons/RetryTaskButton"
import { CheckpointError } from "./CheckpointError"
import ContextWindow from "./ContextWindow"
import { FocusChain } from "./FocusChain"
import { highlightText } from "./Highlights"
import TaskTimeline from "./TaskTimeline"

const IS_DEV = process.env.IS_DEV === '"true"'
interface TaskHeaderProps {
	task: ClineMessage
	tokensIn: number
	tokensOut: number
	doesModelSupportPromptCache: boolean
	cacheWrites?: number
	cacheReads?: number
	totalCost: number
	lastApiReqTotalTokens?: number
	lastProgressMessageText?: string
	onClose: () => void
	onScrollToMessage?: (messageIndex: number) => void
	onSendMessage?: (command: string, files: string[], images: string[]) => void
}

const BUTTON_CLASS = "max-h-3 border-0 font-bold bg-transparent hover:opacity-100 text-badge-foreground"

const TaskHeader: React.FC<TaskHeaderProps> = ({
	task,
	tokensIn,
	tokensOut,
	cacheWrites,
	cacheReads,
	totalCost,
	lastApiReqTotalTokens,
	lastProgressMessageText,
	onScrollToMessage,
	onSendMessage,
}) => {
	const {
		apiConfiguration,
		currentTaskItem,
		checkpointManagerErrorMessage,
		clineMessages,
		navigateToSettings,
		useAutoCondense,
		autoCondenseThreshold,
		mode,
	} = useExtensionState()

	const [isTaskExpanded, setIsTaskExpanded] = useState(true)
	const [isTextExpanded, setIsTextExpanded] = useState(false)
	const [showSeeMore, setShowSeeMore] = useState(false)

	const textContainerRef = useRef<HTMLDivElement>(null)
	const textRef = useRef<HTMLDivElement>(null)

	const { height: windowHeight } = useWindowSize()

	// Simplified computed values
	const { selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, mode)
	const modeFields = getModeSpecificFields(apiConfiguration, mode)

	const isCostAvailable =
		(totalCost &&
			modeFields.apiProvider === "openai" &&
			modeFields.openAiModelInfo?.inputPrice &&
			modeFields.openAiModelInfo?.outputPrice) ||
		(modeFields.apiProvider !== "vscode-lm" && modeFields.apiProvider !== "ollama" && modeFields.apiProvider !== "lmstudio")

	// Event handlers
	const toggleTaskExpanded = useCallback(() => {
		setIsTaskExpanded((prev) => {
			if (prev) {
				setIsTextExpanded(false) // Reset text expansion when collapsing
			}
			return !prev
		})
	}, [])

	const toggleTextExpanded = useCallback((e: React.MouseEvent) => {
		e?.preventDefault()
		e.stopPropagation()
		setIsTextExpanded((prev) => !prev)
	}, [])

	const handleCheckpointSettingsClick = useCallback(() => {
		navigateToSettings()
		setTimeout(async () => {
			try {
				await UiServiceClient.scrollToSettings(StringRequest.create({ value: "features" }))
			} catch (error) {
				console.error("Error scrolling to checkpoint settings:", error)
			}
		}, 300)
	}, [navigateToSettings])

	// Handle text overflow detection
	useEffect(() => {
		if (!isTaskExpanded) {
			return
		}

		const textContainer = textContainerRef.current
		const textElement = textRef.current
		if (!textContainer || !textElement) {
			return
		}

		// Update max height for expanded text
		if (isTextExpanded) {
			textContainer.style.maxHeight = `${windowHeight * 0.5}px`
		}

		// Check for overflow
		const containerHeight = textContainer.clientHeight || textContainer.getBoundingClientRect().height
		const isOverflowing = textElement.scrollHeight > containerHeight
		setShowSeeMore(isOverflowing)
	}, [task.text, windowHeight, isTaskExpanded, isTextExpanded])

	const highlightedText = useMemo(() => highlightText(task.text, false), [task.text])

	return (
		<div className="p-2 flex flex-col gap-1.5 text-badge-foreground">
			{/* Display Checkpoint Error */}
			<CheckpointError
				checkpointManagerErrorMessage={checkpointManagerErrorMessage}
				handleCheckpointSettingsClick={handleCheckpointSettingsClick}
				key={checkpointManagerErrorMessage}
			/>
			{/* Task Header */}
			<div className="bg-badge-background text-badge-foreground rounded-xs flex flex-col gap-1.5 relative z-10 py-1.5 px-2">
				{/* Task Title */}
				<div className="flex justify-between items-center cursor-pointer" onClick={toggleTaskExpanded}>
					<div className="flex justify-between items-center">
						{isTaskExpanded ? <ChevronDownIcon className="ml-0.25" size="16" /> : <ChevronRightIcon size="16" />}
						{isTaskExpanded && (
							<div className="mt-1 max-h-3 flex justify-end flex-wrap cursor-pointer opacity-80">
								<RetryTaskButton className={BUTTON_CLASS} text={task.text} />
								<DeleteTaskButton className={BUTTON_CLASS} taskId={currentTaskItem?.id} />
								<CopyTaskButton className={BUTTON_CLASS} taskText={task.text} />
								{IS_DEV && <OpenDiskTaskHistoryButton className={BUTTON_CLASS} taskId={currentTaskItem?.id} />}
							</div>
						)}
					</div>
					<div className="flex items-center select-none flex-grow min-w-0 gap-1 justify-between">
						{!isTaskExpanded && (
							<div className="text-sm whitespace-nowrap overflow-hidden text-ellipsis flex-grow min-w-0">
								<span className="ph-no-capture">{highlightText(task.text, false)}</span>
							</div>
						)}
					</div>
					<div>
						{isCostAvailable && (
							<div
								className="mr-1 px-1 py-0.25 rounded-full inline-block shrink-0 text-badge-background bg-badge-foreground/80"
								id="price-tag">
								<span className="text-xs">${totalCost?.toFixed(4)}</span>
							</div>
						)}
					</div>
				</div>

				{/* Expand/Collapse Task Details */}
				{isTaskExpanded && (
					<div className="flex flex-col gap-1.5 break-words">
						<div
							className="whitespace-nowrap overflow-hidden text-ellipsis flex-grow min-w-0"
							ref={isTaskExpanded ? textContainerRef : null}
							title={showSeeMore ? (isTextExpanded ? "Show less" : "Click to show more") : task.text}>
							<div
								className={cn(
									"max-h-20 ph-no-capture overflow-hidden whitespace-pre-wrap break-words p-0.5 text-sm",
									isTextExpanded ? "overflow-y-scroll" : "overflow-hidden",
								)}
								onClick={toggleTextExpanded}
								ref={textRef}
								style={{
									display: "-webkit-box",
									WebkitLineClamp: isTextExpanded ? "unset" : 2,
									WebkitBoxOrient: "vertical",
								}}>
								{highlightedText}
							</div>
						</div>

						{((task.images && task.images.length > 0) || (task.files && task.files.length > 0)) && (
							<Thumbnails files={task.files ?? []} images={task.images ?? []} />
						)}

						<div className="flex flex-col">
							<ContextWindow
								autoCondenseThreshold={autoCondenseThreshold}
								cacheReads={cacheReads}
								cacheWrites={cacheWrites}
								contextWindow={selectedModelInfo?.contextWindow}
								lastApiReqTotalTokens={lastApiReqTotalTokens}
								onSendMessage={onSendMessage}
								size={currentTaskItem?.size}
								tokensIn={tokensIn}
								tokensOut={tokensOut}
								useAutoCondense={useAutoCondense || false}
							/>
						</div>
						<TaskTimeline messages={clineMessages} onBlockClick={onScrollToMessage} />
					</div>
				)}
			</div>

			{/* Display Focus Chain To-Do List */}
			<FocusChain currentTaskItemId={currentTaskItem?.id} lastProgressMessageText={lastProgressMessageText} />
		</div>
	)
}

export default TaskHeader
