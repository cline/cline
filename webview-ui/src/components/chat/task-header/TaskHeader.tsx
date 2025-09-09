import { Tooltip } from "@heroui/react"
import { mentionRegexGlobal } from "@shared/context-mentions"
import { ClineMessage } from "@shared/ExtensionMessage"
import { StringRequest } from "@shared/proto/cline/common"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useWindowSize } from "react-use"
import HeroTooltip from "@/components/common/HeroTooltip"
import Thumbnails from "@/components/common/Thumbnails"
import { getModeSpecificFields, normalizeApiConfiguration } from "@/components/settings/utils/providerUtils"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { FileServiceClient, UiServiceClient } from "@/services/grpc-client"
import { formatLargeNumber as _formatLargeNumber, formatSize } from "@/utils/format"
import { validateSlashCommand } from "@/utils/slash-commands"
import CopyTaskButton from "./buttons/CopyTaskButton"
import DeleteTaskButton from "./buttons/DeleteTaskButton"
import OpenDiskTaskHistoryButton from "./buttons/OpenDiskTaskHistoryButton"
import { CheckpointError } from "./CheckpointError"
import { FocusChain } from "./FocusChain"
import TaskTimeline from "./TaskTimeline"

const IS_DEV = process.env.IS_DEV === '"true"'

function formatLargeNumber(num = 0): string {
	return _formatLargeNumber(num)
}

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

const CONTEXT_WINDOW_ACTIONS = [
	{ title: "Smol", command: "/smol" },
	{ title: "Compact", command: "/compact" },
]

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
	const { apiConfiguration, currentTaskItem, checkpointManagerErrorMessage, clineMessages, navigateToSettings, mode } =
		useExtensionState()

	const [isTaskExpanded, setIsTaskExpanded] = useState(true)
	const [isTextExpanded, setIsTextExpanded] = useState(false)
	const [showSeeMore, setShowSeeMore] = useState(false)

	// TODO: Persist this in settings
	const [autoCompactMarker, setAutoCompactMarker] = useState(75)

	const textContainerRef = useRef<HTMLDivElement>(null)
	const textRef = useRef<HTMLDivElement>(null)
	const prevErrorMessageRef = useRef(checkpointManagerErrorMessage)

	const { height: windowHeight } = useWindowSize()

	// Simplified computed values
	const { selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, mode)
	const contextWindow = selectedModelInfo?.contextWindow
	const modeFields = getModeSpecificFields(apiConfiguration, mode)

	const isCostAvailable =
		(modeFields.apiProvider === "openai" &&
			modeFields.openAiModelInfo?.inputPrice &&
			modeFields.openAiModelInfo?.outputPrice) ||
		(modeFields.apiProvider !== "vscode-lm" && modeFields.apiProvider !== "ollama" && modeFields.apiProvider !== "lmstudio")

	const usagePercentage = contextWindow ? ((lastApiReqTotalTokens || 0) / contextWindow) * 100 : 0

	// Event handlers
	const toggleTaskExpanded = useCallback(() => {
		setIsTaskExpanded((prev) => {
			if (prev) {
				setIsTextExpanded(false) // Reset text expansion when collapsing
			}
			return !prev
		})
	}, [])

	const toggleTextExpanded = useCallback(() => {
		setIsTextExpanded((prev) => !prev)
	}, [])

	const handleContextWindowBarClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
		const rect = event.currentTarget.getBoundingClientRect()
		const clickX = event.clientX - rect.left
		const percentage = Math.max(0, Math.min(100, (clickX / rect.width) * 100))
		setAutoCompactMarker(percentage)
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

	// Context window buttons component
	const ContextWindowButtons = () => (
		<div className="flex flex-col gap-2.5 bg-menu text-menu-foreground p-2 rounded shadow-sm">
			<header className="flex justify-between gap-3">
				<div>Context Window</div>
				<div className="text-muted-foreground">
					{formatLargeNumber(lastApiReqTotalTokens)} of {formatLargeNumber(contextWindow)} used
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

	// Context window component
	const ContextWindow = () => {
		if (!contextWindow) {
			return null
		}

		return (
			<div className="flex gap-1 flex-row @max-xs:flex-col @max-xs:items-start items-center text-sm">
				<div className="flex items-center gap-2 flex-[1] whitespace-nowrap">
					<HeroTooltip content="Current tokens used in this request">
						<span className="cursor-pointer">{formatLargeNumber(lastApiReqTotalTokens)}</span>
					</HeroTooltip>
					<div className="flex items-center gap-1 flex-[1]">
						<Tooltip closeDelay={100} content={<ContextWindowButtons />} placement="bottom" showArrow={true}>
							<div
								className="relative cursor-pointer flex-[1] h-1.5 border-[var(--vscode-charts-green)]/20 border-1 rounded overflow-hidden"
								onClick={handleContextWindowBarClick}>
								<div
									className="h-full w-full bg-[var(--vscode-charts-green)]"
									style={{ width: `${usagePercentage}%` }}
								/>
								<div
									className="absolute top-0 bottom-0 h-full w-1 bg-[var(--vscode-charts-yellow)] cursor-pointer"
									style={{ left: `${autoCompactMarker}%` }}
								/>
							</div>
						</Tooltip>
						<HeroTooltip content="Maximum context window size for this model">
							<span className="cursor-pointer">{formatLargeNumber(contextWindow)}</span>
						</HeroTooltip>
					</div>
				</div>
			</div>
		)
	}

	return (
		<div className="px-2.5 py-3 flex flex-col gap-2">
			{/* Task Header */}
			<div className="bg-badge-background text-badge-foreground rounded-xs flex flex-col gap-1.5 relative z-10 py-2 px-2.5">
				{/* Task Title */}
				<div className="flex justify-between items-center gap-2">
					<div className="flex items-center cursor-pointer select-none flex-grow min-w-0" onClick={toggleTaskExpanded}>
						<div className="flex items-center shrink-0">
							<span className={`codicon codicon-chevron-${isTaskExpanded ? "down" : "right"}`} />
						</div>
						<div className=" whitespace-nowrap overflow-hidden text-ellipsis flex-grow min-w-0">
							{isTaskExpanded ? (
								<div className="flex items-center flex-wrap">
									{IS_DEV && <OpenDiskTaskHistoryButton taskId={currentTaskItem?.id} />}
									<CopyTaskButton taskText={task.text} />
									<DeleteTaskButton taskId={currentTaskItem?.id} taskSize={formatSize(currentTaskItem?.size)} />
								</div>
							) : (
								<span className="ph-no-capture">{highlightText(task.text, false)}</span>
							)}
						</div>
					</div>
					{isCostAvailable && (
						<div className="px-1 py-0.5 rounded-full inline-block shrink-0 text-badge-background bg-badge-foreground/70">
							${totalCost?.toFixed(4)}
						</div>
					)}
					<VSCodeButton
						appearance="icon"
						aria-label="Close task"
						className="shrink-0 hover:bg-transparent hover:opacity-70"
						onClick={onClose}
						title="Close task">
						<span className="codicon codicon-close" />
					</VSCodeButton>
				</div>

				{/* Expand/Collapse Task Details */}
				{isTaskExpanded && (
					<div className="flex flex-col gap-2 mt-1">
						<div
							className="cursor-pointer"
							ref={textContainerRef}
							title={showSeeMore ? "Click to show more" : "Show less"}>
							<div
								className="ph-no-capture overflow-hidden whitespace-pre-wrap break-words"
								onClick={toggleTextExpanded}
								ref={textRef}
								style={{
									display: "-webkit-box",
									WebkitLineClamp: isTextExpanded ? "unset" : 2,
									WebkitBoxOrient: "vertical",
								}}>
								{highlightText(task.text, false)}
							</div>
						</div>

						{((task.images && task.images.length > 0) || (task.files && task.files.length > 0)) && (
							<Thumbnails files={task.files ?? []} images={task.images ?? []} />
						)}

						<div className="flex flex-col gap-1">
							<div className="flex items-center justify-between flex-wrap gap-2">
								<div className="flex items-center flex-wrap gap-1 text-sm">
									<div className="font-semibold">Tokens:</div>
									{contextTokenDetails.map((item) => (
										<HeroTooltip content={item.title}>
											<span className="flex items-center gap-0.5 cursor-pointer">
												<i className={`codicon ${item.icon} font-semibold`} />
												{formatLargeNumber(item.value)}
											</span>
										</HeroTooltip>
									))}
								</div>
								<HeroTooltip content="Task size on disk">
									<div className="opacity-80">{formatSize(currentTaskItem?.size)}</div>
								</HeroTooltip>
							</div>

							<TaskTimeline messages={clineMessages} onBlockClick={onScrollToMessage} />

							<ContextWindow />
						</div>
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
