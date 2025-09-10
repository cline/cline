import { mentionRegexGlobal } from "@shared/context-mentions"
import { ClineMessage } from "@shared/ExtensionMessage"
import { StringRequest } from "@shared/proto/cline/common"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useWindowSize } from "react-use"
import Thumbnails from "@/components/common/Thumbnails"
import { getModeSpecificFields, normalizeApiConfiguration } from "@/components/settings/utils/providerUtils"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { FileServiceClient, UiServiceClient } from "@/services/grpc-client"
import { formatSize } from "@/utils/format"
import { validateSlashCommand } from "@/utils/slash-commands"
import CopyTaskButton from "./buttons/CopyTaskButton"
import DeleteTaskButton from "./buttons/DeleteTaskButton"
import OpenDiskTaskHistoryButton from "./buttons/OpenDiskTaskHistoryButton"
import RetryTaskButton from "./buttons/RetryTaskButton"
import { CheckpointError } from "./CheckpointError"
import ContextWindowProgress from "./ContextWindowProgress"
import { FocusChain } from "./FocusChain"
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

const TaskHeader: React.FC<TaskHeaderProps> = ({
	task,
	tokensIn,
	tokensOut,
	cacheWrites,
	cacheReads,
	totalCost,
	lastApiReqTotalTokens,
	lastProgressMessageText,
	onClose,
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
	const prevErrorMessageRef = useRef(checkpointManagerErrorMessage)

	const { height: windowHeight } = useWindowSize()

	// Simplified computed values
	const { selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, mode)
	const modeFields = getModeSpecificFields(apiConfiguration, mode)

	const isCostAvailable =
		(modeFields.apiProvider === "openai" &&
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

	// Handle checkpoint error message changes
	useEffect(() => {
		if (checkpointManagerErrorMessage !== prevErrorMessageRef.current) {
			setIsTaskExpanded(true)
			prevErrorMessageRef.current = checkpointManagerErrorMessage
		}
	}, [checkpointManagerErrorMessage])

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
		<div className="p-2 flex flex-col gap-2">
			{/* Task Header */}
			<div className="bg-button-background text-button-foreground rounded-xs flex flex-col gap-1.5 relative z-10 py-1.5 px-2">
				{/* Task Title */}
				<div className="flex justify-between items-center" onClick={toggleTaskExpanded}>
					<div className="flex items-center cursor-pointer select-none flex-grow min-w-0 gap-1">
						<VSCodeButton appearance="icon" className="flex items-center shrink-0 bg-transparent">
							<span className={`codicon codicon-chevron-${isTaskExpanded ? "down" : "right"}`} />
						</VSCodeButton>

						{isTaskExpanded && (
							<div className="flex items-center flex-wrap cursor-pointer">
								{IS_DEV && <OpenDiskTaskHistoryButton taskId={currentTaskItem?.id} />}
								<RetryTaskButton text={task.text} />
								<CopyTaskButton taskText={task.text} />
								<DeleteTaskButton taskId={currentTaskItem?.id} taskSize={formatSize(currentTaskItem?.size)} />
							</div>
						)}

						{!isTaskExpanded && (
							<div
								className=" whitespace-nowrap overflow-hidden text-ellipsis flex-grow min-w-0"
								onClick={toggleTextExpanded}>
								<span className="ph-no-capture">{highlightedText}</span>
							</div>
						)}
					</div>

					{isCostAvailable ? (
						<div className="text-xs px-1 py-0.25 rounded-full inline-block shrink-0 text-badge-background bg-badge-foreground/70">
							<span className="text-xs">${totalCost?.toFixed(4)}</span>
						</div>
					) : (
						<VSCodeButton
							appearance="icon"
							aria-label="Close task"
							className="shrink-0 hover:bg-transparent hover:opacity-70"
							onClick={onClose}
							title="Close task">
							<span className="codicon codicon-close" />
						</VSCodeButton>
					)}
				</div>

				{/* Expand/Collapse Task Details */}
				{isTaskExpanded && (
					<div className="flex flex-col gap-1.5 break-words">
						<div
							className="whitespace-nowrap overflow-hidden text-ellipsis flex-grow min-w-0"
							ref={textContainerRef}
							title={showSeeMore ? (isTextExpanded ? "Show less" : "Click to show more") : task.text}>
							<div
								className="ph-no-capture overflow-hidden whitespace-pre-wrap break-words p-0.5"
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
							<ContextWindowProgress
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

			{/* Display Checkpoint Error */}
			<CheckpointError
				checkpointManagerErrorMessage={checkpointManagerErrorMessage}
				handleCheckpointSettingsClick={handleCheckpointSettingsClick}
			/>
		</div>
	)
}

// Optimized highlighting functions
const highlightSlashCommands = (text: string, withShadow = true) => {
	const match = text.match(/^\s*\/([a-zA-Z0-9_-]+)(\s*|$)/)
	if (!match || validateSlashCommand(match[1]) !== "full") {
		return text
	}

	const commandName = match[1]
	const commandEndIndex = match[0].length
	const beforeCommand = text.substring(0, text.indexOf("/"))
	const afterCommand = match[2] + text.substring(commandEndIndex)

	return [
		beforeCommand,
		<span className={withShadow ? "mention-context-highlight-with-shadow" : "mention-context-highlight"} key="slashCommand">
			/{commandName}
		</span>,
		afterCommand,
	]
}

export const highlightMentions = (text: string, withShadow = true) => {
	if (!mentionRegexGlobal.test(text)) {
		return text
	}

	const parts = text.split(mentionRegexGlobal)
	const result: (string | JSX.Element)[] = []

	for (let i = 0; i < parts.length; i++) {
		if (i % 2 === 0) {
			if (parts[i]) {
				result.push(parts[i])
			}
		} else {
			result.push(
				<span
					className={`${withShadow ? "mention-context-highlight-with-shadow" : "mention-context-highlight"} cursor-pointer`}
					key={`mention-${Math.floor(i / 2)}`}
					onClick={() => FileServiceClient.openMention(StringRequest.create({ value: parts[i] }))}>
					@{parts[i]}
				</span>,
			)
		}
	}

	return result.length === 1 ? result[0] : result
}

export const highlightText = (text?: string, withShadow = true) => {
	if (!text) {
		return text
	}

	const slashResult = highlightSlashCommands(text, withShadow)

	if (slashResult === text) {
		return highlightMentions(text, withShadow)
	}

	if (Array.isArray(slashResult) && slashResult.length === 3) {
		const [beforeCommand, commandElement, afterCommand] = slashResult as [string, JSX.Element, string]
		const mentionResult = highlightMentions(afterCommand, withShadow)

		return Array.isArray(mentionResult)
			? [beforeCommand, commandElement, ...mentionResult]
			: [beforeCommand, commandElement, mentionResult]
	}

	return slashResult
}

export default TaskHeader
