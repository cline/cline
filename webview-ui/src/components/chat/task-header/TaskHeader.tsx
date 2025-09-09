import { Tooltip } from "@heroui/react"
import { mentionRegexGlobal } from "@shared/context-mentions"
import { ClineMessage } from "@shared/ExtensionMessage"
import { StringRequest } from "@shared/proto/cline/common"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import React, { useCallback, useEffect, useRef, useState } from "react"
import { useWindowSize } from "react-use"
import HeroTooltip from "@/components/common/HeroTooltip"
import Thumbnails from "@/components/common/Thumbnails"
import { getModeSpecificFields, normalizeApiConfiguration } from "@/components/settings/utils/providerUtils"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { FileServiceClient, UiServiceClient } from "@/services/grpc-client"
import { formatLargeNumber, formatSize } from "@/utils/format"
import { validateSlashCommand } from "@/utils/slash-commands"
import CopyTaskButton from "./buttons/CopyTaskButton"
import DeleteTaskButton from "./buttons/DeleteTaskButton"
import OpenDiskTaskHistoryButton from "./buttons/OpenDiskTaskHistoryButton"
import { FocusChainContainer } from "./FocusChainContainer"
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

	const shouldShowPromptCacheInfo = (cacheReads && cacheReads > 0) || (cacheWrites && cacheWrites > 0)
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
					{formatLargeNumber(lastApiReqTotalTokens || 0)} of {formatLargeNumber(contextWindow || 0)} used
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

	// Context window component
	const ContextWindow = () => {
		if (!contextWindow) {
			return null
		}

		return (
			<div className="flex gap-1 flex-row @max-xs:flex-col @max-xs:items-start items-center text-sm">
				<div className="flex items-center gap-2 flex-[1] whitespace-nowrap">
					<HeroTooltip content="Current tokens used in this request">
						<span className="cursor-pointer">{formatLargeNumber(lastApiReqTotalTokens || 0)}</span>
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
							<span className="cursor-pointer">{formatLargeNumber(contextWindow || 0)}</span>
						</HeroTooltip>
					</div>
				</div>
			</div>
		)
	}

	// Action buttons component
	const ActionButtons = () => (
		<div className="flex items-center flex-wrap">
			{IS_DEV && <OpenDiskTaskHistoryButton taskId={currentTaskItem?.id} />}
			<CopyTaskButton taskText={task.text} />
			<DeleteTaskButton taskId={currentTaskItem?.id} taskSize={formatSize(currentTaskItem?.size)} />
		</div>
	)

	return (
		<div className="px-2.5 py-3 flex flex-col gap-2">
			<div className="bg-badge-background text-badge-foreground rounded-xs flex flex-col gap-1.5 relative z-10 p-2.5">
				<div className="flex justify-between items-center">
					<div className="flex items-center cursor-pointer select-none flex-grow min-w-0" onClick={toggleTaskExpanded}>
						<div className="flex items-center shrink-0">
							<span className={`codicon codicon-chevron-${isTaskExpanded ? "down" : "right"}`} />
						</div>
						<div className="ml-1.5 whitespace-nowrap overflow-hidden text-ellipsis flex-grow min-w-0">
							{isTaskExpanded ? (
								<ActionButtons />
							) : (
								<span className="ph-no-capture ml-1">{highlightText(task.text, false)}</span>
							)}
						</div>
					</div>

					{isCostAvailable && totalCost && (
						<div
							className="ml-2.5 px-1 py-0.5 rounded-full text-[11px] font-medium inline-block shrink-0"
							style={{
								backgroundColor: "color-mix(in srgb, var(--vscode-badge-foreground) 70%, transparent)",
								color: "var(--vscode-badge-background)",
							}}>
							${totalCost.toFixed(4)}
						</div>
					)}

					<VSCodeButton
						appearance="icon"
						aria-label="Close task"
						className="ml-1.5 shrink-0 hover:bg-transparent hover:opacity-70"
						onClick={onClose}
						title="Close task">
						<span className="codicon codicon-close" />
					</VSCodeButton>
				</div>

				{isTaskExpanded && (
					<div className="flex flex-col gap-2 mt-1">
						<div className={showSeeMore ? "cursor-pointer" : ""} ref={textContainerRef}>
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
									<div className="flex align-center">
										<span className="font-semibold">Tokens:</span>
									</div>
									<HeroTooltip content="Prompt Tokens">
										<span className="flex items-center gap-0.5 cursor-pointer">
											<i className="codicon codicon-arrow-up font-semibold" />
											{formatLargeNumber(tokensIn || 0)}
										</span>
									</HeroTooltip>
									<HeroTooltip content="Completion Tokens">
										<span className="flex items-center gap-0.5 cursor-pointer">
											<i className="codicon codicon-arrow-down font-semibold" />
											{formatLargeNumber(tokensOut || 0)}
										</span>
									</HeroTooltip>

									{shouldShowPromptCacheInfo && (
										<div className="flex items-center flex-wrap gap-0.5">
											{cacheWrites !== undefined && cacheWrites > 0 && (
												<HeroTooltip content="Tokens written to cache">
													<span className="flex items-center gap-[3px] cursor-pointer">
														<i className="codicon codicon-database font-semibold" />+
														{formatLargeNumber(cacheWrites || 0)}
													</span>
												</HeroTooltip>
											)}
											{cacheReads !== undefined && cacheReads > 0 && (
												<HeroTooltip content="Tokens read from cache">
													<span className="flex items-center gap-[3px] cursor-pointer">
														<i className="codicon codicon-arrow-right font-semibold mb-0" />
														{formatLargeNumber(cacheReads || 0)}
													</span>
												</HeroTooltip>
											)}
										</div>
									)}
								</div>

								<div className="opacity-60">{formatSize(currentTaskItem?.size)}</div>
							</div>

							<TaskTimeline messages={clineMessages} onBlockClick={onScrollToMessage} />

							<ContextWindow />
						</div>
					</div>
				)}
			</div>

			<FocusChainContainer currentTaskItemId={currentTaskItem?.id} lastProgressMessageText={lastProgressMessageText} />

			{checkpointManagerErrorMessage && (
				<div className="flex items-center gap-1 p-2 bg-[var(--vscode-inputValidation-errorBackground)] text-[var(--vscode-inputValidation-errorForeground)] rounded">
					<i className="codicon codicon-warning" />
					<span>
						{checkpointManagerErrorMessage.replace(/disabling checkpoints\.$/, "")}
						{checkpointManagerErrorMessage.endsWith("disabling checkpoints.") && (
							<button
								className="underline cursor-pointer bg-transparent border-0 p-0 text-inherit"
								onClick={handleCheckpointSettingsClick}>
								disabling checkpoints.
							</button>
						)}
						{checkpointManagerErrorMessage.includes("Git must be installed to use checkpoints.") && (
							<>
								{" "}
								<a
									className="text-inherit underline"
									href="https://github.com/cline/cline/wiki/Installing-Git-for-Checkpoints">
									See here for instructions.
								</a>
							</>
						)}
					</span>
				</div>
			)}
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
