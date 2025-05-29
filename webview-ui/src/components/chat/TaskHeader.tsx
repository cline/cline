import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import React, { memo, useEffect, useMemo, useRef, useState } from "react"
import { useWindowSize } from "react-use"
import { mentionRegexGlobal } from "@shared/context-mentions"
import { ClineMessage } from "@shared/ExtensionMessage"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { formatLargeNumber } from "@/utils/format"
import { formatSize } from "@/utils/format"
import { vscode } from "@/utils/vscode"
import Thumbnails from "@/components/common/Thumbnails"
import { normalizeApiConfiguration } from "@/components/settings/ApiOptions"
import { validateSlashCommand } from "@/utils/slash-commands"
import TaskTimeline from "./TaskTimeline"
import { TaskServiceClient, FileServiceClient, UiServiceClient } from "@/services/grpc-client"
import HeroTooltip from "@/components/common/HeroTooltip"

interface TaskHeaderProps {
	task: ClineMessage
	tokensIn: number
	tokensOut: number
	doesModelSupportPromptCache: boolean
	cacheWrites?: number
	cacheReads?: number
	totalCost: number
	lastApiReqTotalTokens?: number
	onClose: () => void
	onScrollToMessage?: (messageIndex: number) => void
}

const TaskHeader: React.FC<TaskHeaderProps> = ({
	task,
	tokensIn,
	tokensOut,
	doesModelSupportPromptCache,
	cacheWrites,
	cacheReads,
	totalCost,
	lastApiReqTotalTokens,
	onClose,
	onScrollToMessage,
}) => {
	const { apiConfiguration, currentTaskItem, checkpointTrackerErrorMessage, clineMessages, navigateToSettings } =
		useExtensionState()
	const [isTaskExpanded, setIsTaskExpanded] = useState(true)
	const [isTextExpanded, setIsTextExpanded] = useState(false)
	const [showSeeMore, setShowSeeMore] = useState(false)
	const textContainerRef = useRef<HTMLDivElement>(null)
	const textRef = useRef<HTMLDivElement>(null)

	const { selectedModelInfo } = useMemo(() => normalizeApiConfiguration(apiConfiguration), [apiConfiguration])
	const contextWindow = selectedModelInfo?.contextWindow

	// Open task header when checkpoint tracker error message is set
	const prevErrorMessageRef = useRef(checkpointTrackerErrorMessage)
	useEffect(() => {
		if (checkpointTrackerErrorMessage !== prevErrorMessageRef.current) {
			setIsTaskExpanded(true)
			prevErrorMessageRef.current = checkpointTrackerErrorMessage
		}
	}, [checkpointTrackerErrorMessage])

	// Reset isTextExpanded when task is collapsed
	useEffect(() => {
		if (!isTaskExpanded) {
			setIsTextExpanded(false)
		}
	}, [isTaskExpanded])

	/*
	When dealing with event listeners in React components that depend on state variables, we face a challenge. We want our listener to always use the most up-to-date version of a callback function that relies on current state, but we don't want to constantly add and remove event listeners as that function updates. This scenario often arises with resize listeners or other window events. Simply adding the listener in a useEffect with an empty dependency array risks using stale state, while including the callback in the dependencies can lead to unnecessary re-registrations of the listener. There are react hook libraries that provide a elegant solution to this problem by utilizing the useRef hook to maintain a reference to the latest callback function without triggering re-renders or effect re-runs. This approach ensures that our event listener always has access to the most current state while minimizing performance overhead and potential memory leaks from multiple listener registrations. 
	Sources
	- https://usehooks-ts.com/react-hook/use-event-listener
	- https://streamich.github.io/react-use/?path=/story/sensors-useevent--docs
	- https://github.com/streamich/react-use/blob/master/src/useEvent.ts
	- https://stackoverflow.com/questions/55565444/how-to-register-event-with-useeffect-hooks

	Before:
	
	const updateMaxHeight = useCallback(() => {
		if (isExpanded && textContainerRef.current) {
			const maxHeight = window.innerHeight * (3 / 5)
			textContainerRef.current.style.maxHeight = `${maxHeight}px`
		}
	}, [isExpanded])

	useEffect(() => {
		updateMaxHeight()
	}, [isExpanded, updateMaxHeight])

	useEffect(() => {
		window.removeEventListener("resize", updateMaxHeight)
		window.addEventListener("resize", updateMaxHeight)
		return () => {
			window.removeEventListener("resize", updateMaxHeight)
		}
	}, [updateMaxHeight])

	After:
	*/

	const { height: windowHeight, width: windowWidth } = useWindowSize()

	useEffect(() => {
		if (isTextExpanded && textContainerRef.current) {
			const maxHeight = windowHeight * (1 / 2)
			textContainerRef.current.style.maxHeight = `${maxHeight}px`
		}
	}, [isTextExpanded, windowHeight])

	useEffect(() => {
		if (isTaskExpanded && textRef.current && textContainerRef.current) {
			// Use requestAnimationFrame to ensure DOM is fully updated
			requestAnimationFrame(() => {
				// Check if refs are still valid
				if (textRef.current && textContainerRef.current) {
					let textContainerHeight = textContainerRef.current.clientHeight
					if (!textContainerHeight) {
						textContainerHeight = textContainerRef.current.getBoundingClientRect().height
					}
					const isOverflowing = textRef.current.scrollHeight > textContainerHeight

					setShowSeeMore(isOverflowing)
				}
			})
		}
	}, [task.text, windowWidth, isTaskExpanded])

	const isCostAvailable = useMemo(() => {
		const openAiCompatHasPricing =
			apiConfiguration?.apiProvider === "openai" &&
			apiConfiguration?.openAiModelInfo?.inputPrice &&
			apiConfiguration?.openAiModelInfo?.outputPrice
		if (openAiCompatHasPricing) {
			return true
		}
		return (
			apiConfiguration?.apiProvider !== "vscode-lm" &&
			apiConfiguration?.apiProvider !== "ollama" &&
			apiConfiguration?.apiProvider !== "lmstudio"
		)
	}, [apiConfiguration?.apiProvider, apiConfiguration?.openAiModelInfo])

	const shouldShowPromptCacheInfo = () => {
		return (
			doesModelSupportPromptCache &&
			((cacheReads !== undefined && cacheReads > 0) || (cacheWrites !== undefined && cacheWrites > 0))
		)
	}

	const ContextWindowComponent = (
		<>
			{isTaskExpanded && contextWindow && (
				<div
					style={{
						display: "flex",
						flexDirection: windowWidth < 270 ? "column" : "row",
						gap: "4px",
					}}>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: "3px",
							flex: 1,
							whiteSpace: "nowrap",
						}}>
						<HeroTooltip content="Current tokens used in this request">
							<span className="cursor-pointer">{formatLargeNumber(lastApiReqTotalTokens || 0)}</span>
						</HeroTooltip>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: "3px",
								flex: 1,
							}}>
							<HeroTooltip content="Context window usage">
								<div
									style={{
										flex: 1,
										height: "4px",
										backgroundColor: "color-mix(in srgb, var(--vscode-badge-foreground) 20%, transparent)",
										borderRadius: "2px",
										overflow: "hidden",
									}}
									className="cursor-pointer">
									<div
										style={{
											width: `${((lastApiReqTotalTokens || 0) / contextWindow) * 100}%`,
											height: "100%",
											backgroundColor: "var(--vscode-badge-foreground)",
											borderRadius: "2px",
										}}
									/>
								</div>
							</HeroTooltip>
							<HeroTooltip content="Maximum context window size for this model">
								<span className="cursor-pointer">{formatLargeNumber(contextWindow)}</span>
							</HeroTooltip>
						</div>
					</div>
				</div>
			)}
		</>
	)

	return (
		<div style={{ padding: "10px 13px 10px 13px" }}>
			<div
				style={{
					backgroundColor: "var(--vscode-badge-background)",
					color: "var(--vscode-badge-foreground)",
					borderRadius: "3px",
					padding: "9px 10px 9px 14px",
					display: "flex",
					flexDirection: "column",
					gap: 6,
					position: "relative",
					zIndex: 1,
				}}>
				<div
					style={{
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
					}}>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							cursor: "pointer",
							marginLeft: -2,
							userSelect: "none",
							WebkitUserSelect: "none",
							MozUserSelect: "none",
							msUserSelect: "none",
							flexGrow: 1,
							minWidth: 0, // This allows the div to shrink below its content size
						}}
						onClick={() => setIsTaskExpanded(!isTaskExpanded)}>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								flexShrink: 0,
							}}>
							<span className={`codicon codicon-chevron-${isTaskExpanded ? "down" : "right"}`}></span>
						</div>
						<div
							style={{
								marginLeft: 6,
								whiteSpace: "nowrap",
								overflow: "hidden",
								textOverflow: "ellipsis",
								flexGrow: 1,
								minWidth: 0, // This allows the div to shrink below its content size
							}}>
							<span style={{ fontWeight: "bold" }}>
								Task
								{!isTaskExpanded && ":"}
							</span>
							{!isTaskExpanded && (
								<span className="ph-no-capture" style={{ marginLeft: 4 }}>
									{highlightText(task.text, false)}
								</span>
							)}
						</div>
					</div>
					{isCostAvailable && (
						<div
							style={{
								marginLeft: 10,
								backgroundColor: "color-mix(in srgb, var(--vscode-badge-foreground) 70%, transparent)",
								color: "var(--vscode-badge-background)",
								padding: "2px 4px",
								borderRadius: "500px",
								fontSize: "11px",
								fontWeight: 500,
								display: "inline-block",
								flexShrink: 0,
							}}>
							${totalCost?.toFixed(4)}
						</div>
					)}
					<VSCodeButton appearance="icon" onClick={onClose} style={{ marginLeft: 6, flexShrink: 0 }}>
						<span className="codicon codicon-close"></span>
					</VSCodeButton>
				</div>
				{isTaskExpanded && (
					<>
						<div
							ref={textContainerRef}
							style={{
								marginTop: -2,
								fontSize: "var(--vscode-font-size)",
								overflowY: isTextExpanded ? "auto" : "hidden",
								wordBreak: "break-word",
								overflowWrap: "anywhere",
								position: "relative",
							}}>
							<div
								ref={textRef}
								style={{
									display: "-webkit-box",
									WebkitLineClamp: isTextExpanded ? "unset" : 2,
									WebkitBoxOrient: "vertical",
									overflow: "hidden",
									whiteSpace: "pre-wrap",
									wordBreak: "break-word",
									overflowWrap: "anywhere",
								}}>
								<span className="ph-no-capture">{highlightText(task.text, false)}</span>
							</div>
							{!isTextExpanded && showSeeMore && (
								<div
									style={{
										position: "absolute",
										right: 0,
										bottom: 0,
										display: "flex",
										alignItems: "center",
									}}>
									<div
										style={{
											width: 30,
											height: "1.2em",
											background: "linear-gradient(to right, transparent, var(--vscode-badge-background))",
										}}
									/>
									<div
										style={{
											cursor: "pointer",
											color: "var(--vscode-textLink-foreground)",
											paddingRight: 0,
											paddingLeft: 3,
											backgroundColor: "var(--vscode-badge-background)",
										}}
										onClick={() => setIsTextExpanded(!isTextExpanded)}>
										See more
									</div>
								</div>
							)}
						</div>
						{isTextExpanded && showSeeMore && (
							<div
								style={{
									cursor: "pointer",
									color: "var(--vscode-textLink-foreground)",
									marginLeft: "auto",
									textAlign: "right",
									paddingRight: 2,
								}}
								onClick={() => setIsTextExpanded(!isTextExpanded)}>
								See less
							</div>
						)}
						{((task.images && task.images.length > 0) || (task.files && task.files.length > 0)) && (
							<Thumbnails images={task.images ?? []} files={task.files ?? []} />
						)}

						<div
							style={{
								display: "flex",
								flexDirection: "column",
								gap: "2px",
							}}>
							<div
								style={{
									display: "flex",
									justifyContent: "space-between",
									alignItems: "center",
									flexWrap: "wrap",
								}}>
								<div
									style={{
										display: "flex",
										alignItems: "center",
										gap: "4px",
										flexWrap: "wrap",
									}}>
									<div style={{ display: "flex", alignItems: "center" }}>
										<span style={{ fontWeight: "bold" }}>Tokens:</span>
									</div>
									<HeroTooltip content="Prompt Tokens">
										<span className="flex items-center gap-[3px] cursor-pointer">
											<i
												className="codicon codicon-arrow-up"
												style={{
													fontSize: "12px",
													fontWeight: "bold",
													marginBottom: "-2px",
												}}
											/>
											{formatLargeNumber(tokensIn || 0)}
										</span>
									</HeroTooltip>
									<HeroTooltip content="Completion Tokens">
										<span className="flex items-center gap-[3px] cursor-pointer">
											<i
												className="codicon codicon-arrow-down"
												style={{
													fontSize: "12px",
													fontWeight: "bold",
													marginBottom: "-2px",
												}}
											/>
											{formatLargeNumber(tokensOut || 0)}
										</span>
									</HeroTooltip>
								</div>
								{!shouldShowPromptCacheInfo() && (
									<div className="flex items-center flex-wrap">
										<CopyButton taskText={task.text} />
										<DeleteButton taskSize={formatSize(currentTaskItem?.size)} taskId={currentTaskItem?.id} />
									</div>
								)}
							</div>
							{shouldShowPromptCacheInfo() && (
								<div
									style={{
										display: "flex",
										justifyContent: "space-between",
										alignItems: "center",
										flexWrap: "wrap",
									}}>
									<div
										style={{
											display: "flex",
											alignItems: "center",
											gap: "4px",
											flexWrap: "wrap",
										}}>
										<div style={{ display: "flex", alignItems: "center" }}>
											<span style={{ fontWeight: "bold" }}>Cache:</span>
										</div>
										{cacheWrites !== undefined && cacheWrites > 0 && (
											<HeroTooltip content="Tokens written to cache">
												<span className="flex items-center gap-[3px] cursor-pointer">
													<i
														className="codicon codicon-database"
														style={{
															fontSize: "12px",
															fontWeight: "bold",
															marginBottom: "-1px",
														}}
													/>
													+{formatLargeNumber(cacheWrites || 0)}
												</span>
											</HeroTooltip>
										)}
										{cacheReads !== undefined && cacheReads > 0 && (
											<HeroTooltip content="Tokens read from cache">
												<span className="flex items-center gap-[3px] cursor-pointer">
													<i
														className={"codicon codicon-arrow-right"}
														style={{
															fontSize: "12px",
															fontWeight: "bold",
															marginBottom: 0,
														}}
													/>
													{formatLargeNumber(cacheReads || 0)}
												</span>
											</HeroTooltip>
										)}
									</div>
									<div className="flex items-center flex-wrap">
										<CopyButton taskText={task.text} />
										<DeleteButton taskSize={formatSize(currentTaskItem?.size)} taskId={currentTaskItem?.id} />
									</div>
								</div>
							)}
							<div className="flex flex-col">
								<TaskTimeline messages={clineMessages} onBlockClick={onScrollToMessage} />
								{ContextWindowComponent}
							</div>
							{checkpointTrackerErrorMessage && (
								<div
									style={{
										display: "flex",
										alignItems: "center",
										gap: "8px",
										color: "var(--vscode-editorWarning-foreground)",
										fontSize: "11px",
									}}>
									<i className="codicon codicon-warning" />
									<span>
										{checkpointTrackerErrorMessage.replace(/disabling checkpoints\.$/, "")}
										{checkpointTrackerErrorMessage.endsWith("disabling checkpoints.") && (
											<>
												<button
													onClick={() => {
														// First open the settings panel using direct navigation
														navigateToSettings()

														// After a short delay, send a message to scroll to settings
														setTimeout(async () => {
															try {
																await UiServiceClient.scrollToSettings({ value: "features" })
															} catch (error) {
																console.error("Error scrolling to checkpoint settings:", error)
															}
														}, 300)
													}}
													className="underline cursor-pointer bg-transparent border-0 p-0 text-inherit font-inherit">
													disabling checkpoints.
												</button>
											</>
										)}
										{checkpointTrackerErrorMessage.includes("Git must be installed to use checkpoints.") && (
											<>
												{" "}
												<a
													href="https://github.com/cline/cline/wiki/Installing-Git-for-Checkpoints"
													style={{
														color: "inherit",
														textDecoration: "underline",
													}}>
													See here for instructions.
												</a>
											</>
										)}
									</span>
								</div>
							)}
						</div>
					</>
				)}
			</div>
			{/* {apiProvider === "" && (
				<div
					style={{
						backgroundColor: "color-mix(in srgb, var(--vscode-badge-background) 50%, transparent)",
						color: "var(--vscode-badge-foreground)",
						borderRadius: "0 0 3px 3px",
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
						padding: "4px 12px 6px 12px",
						fontSize: "0.9em",
						marginLeft: "10px",
						marginRight: "10px",
					}}>
					<div style={{ fontWeight: "500" }}>Credits Remaining:</div>
					<div>
						{formatPrice(Credits || 0)}
						{(Credits || 0) < 1 && (
							<>
								{" "}
								<VSCodeLink style={{ fontSize: "0.9em" }} href={getAddCreditsUrl(vscodeUriScheme)}>
									(get more?)
								</VSCodeLink>
							</>
						)}
					</div>
				</div>
			)} */}
		</div>
	)
}

/**
 * Highlights slash-command in this text if it exists
 */
const highlightSlashCommands = (text: string, withShadow = true) => {
	const match = text.match(/^\s*\/([a-zA-Z0-9_-]+)(\s*|$)/)
	if (!match) {
		return text
	}

	const commandName = match[1]
	const validationResult = validateSlashCommand(commandName)

	if (!validationResult || validationResult !== "full") {
		return text
	}

	const commandEndIndex = match[0].length
	const beforeCommand = text.substring(0, text.indexOf("/"))
	const afterCommand = match[2] + text.substring(commandEndIndex)

	return [
		beforeCommand,
		<span key="slashCommand" className={withShadow ? "mention-context-highlight-with-shadow" : "mention-context-highlight"}>
			/{commandName}
		</span>,
		afterCommand,
	]
}

/**
 * Highlights & formats all mentions inside this text
 */
export const highlightMentions = (text: string, withShadow = true) => {
	const parts = text.split(mentionRegexGlobal)

	return parts.map((part, index) => {
		if (index % 2 === 0) {
			// This is regular text
			return part
		} else {
			// This is a mention
			return (
				<span
					key={index}
					className={withShadow ? "mention-context-highlight-with-shadow" : "mention-context-highlight"}
					style={{ cursor: "pointer" }}
					onClick={() => FileServiceClient.openMention({ value: part })}>
					@{part}
				</span>
			)
		}
	})
}

/**
 * Handles parsing both mentions and slash-commands
 */
export const highlightText = (text?: string, withShadow = true) => {
	if (!text) {
		return text
	}

	const resultWithSlashHighlighting = highlightSlashCommands(text, withShadow)

	if (resultWithSlashHighlighting === text) {
		// no highlighting done
		return highlightMentions(resultWithSlashHighlighting, withShadow)
	}

	if (Array.isArray(resultWithSlashHighlighting) && resultWithSlashHighlighting.length === 3) {
		const [beforeCommand, commandElement, afterCommand] = resultWithSlashHighlighting as [string, JSX.Element, string]

		return [beforeCommand, commandElement, ...highlightMentions(afterCommand, withShadow)]
	}

	return [text]
}

const CopyButton: React.FC<{
	taskText?: string
}> = ({ taskText }) => {
	const [copied, setCopied] = useState(false)

	const handleCopy = () => {
		if (!taskText) return

		navigator.clipboard.writeText(taskText).then(() => {
			setCopied(true)
			setTimeout(() => setCopied(false), 1500)
		})
	}

	return (
		<HeroTooltip content="Copy Task">
			<VSCodeButton
				appearance="icon"
				onClick={handleCopy}
				style={{ padding: "0px 0px" }}
				className="p-0"
				aria-label="Copy Task">
				<div className="flex items-center gap-[3px] text-[8px] font-bold opacity-60">
					<i className={`codicon codicon-${copied ? "check" : "copy"}`} />
				</div>
			</VSCodeButton>
		</HeroTooltip>
	)
}

const DeleteButton: React.FC<{
	taskSize: string
	taskId?: string
}> = ({ taskSize, taskId }) => (
	<HeroTooltip content="Delete Task & Checkpoints">
		<VSCodeButton
			appearance="icon"
			onClick={() => taskId && TaskServiceClient.deleteTasksWithIds({ value: [taskId] })}
			style={{ padding: "0px 0px" }}>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: "3px",
					fontSize: "10px",
					fontWeight: "bold",
					opacity: 0.6,
				}}>
				<i className={`codicon codicon-trash`} />
				{taskSize}
			</div>
		</VSCodeButton>
	</HeroTooltip>
)

// const ExportButton = () => (
// 	<VSCodeButton
// 		appearance="icon"
// 		onClick={() => vscode.postMessage({ type: "exportCurrentTask" })}
// 		style={
// 			{
// 				// marginBottom: "-2px",
// 				// marginRight: "-2.5px",
// 			}
// 		}>
// 		<div style={{ fontSize: "10.5px", fontWeight: "bold", opacity: 0.6 }}>EXPORT</div>
// 	</VSCodeButton>
// )

export default memo(TaskHeader)
