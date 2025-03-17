import React, { memo, useEffect, useMemo, useRef, useState } from "react"
import { useWindowSize } from "react-use"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import prettyBytes from "pretty-bytes"
import { useTranslation } from "react-i18next"

import { vscode } from "@/utils/vscode"
import { formatLargeNumber } from "@/utils/format"
import { calculateTokenDistribution, getMaxTokensForModel } from "@/utils/model-utils"
import { Button } from "@/components/ui"

import { ClineMessage } from "../../../../src/shared/ExtensionMessage"
import { mentionRegexGlobal } from "../../../../src/shared/context-mentions"
import { HistoryItem } from "../../../../src/shared/HistoryItem"

import { useExtensionState } from "../../context/ExtensionStateContext"
import Thumbnails from "../common/Thumbnails"
import { normalizeApiConfiguration } from "../settings/ApiOptions"
import { DeleteTaskDialog } from "../history/DeleteTaskDialog"

interface TaskHeaderProps {
	task: ClineMessage
	tokensIn: number
	tokensOut: number
	doesModelSupportPromptCache: boolean
	cacheWrites?: number
	cacheReads?: number
	totalCost: number
	contextTokens: number
	onClose: () => void
}

const TaskHeader: React.FC<TaskHeaderProps> = ({
	task,
	tokensIn,
	tokensOut,
	doesModelSupportPromptCache,
	cacheWrites,
	cacheReads,
	totalCost,
	contextTokens,
	onClose,
}) => {
	const { t } = useTranslation()
	const { apiConfiguration, currentTaskItem } = useExtensionState()
	const { selectedModelInfo } = useMemo(() => normalizeApiConfiguration(apiConfiguration), [apiConfiguration])
	const [isTaskExpanded, setIsTaskExpanded] = useState(true)
	const [isTextExpanded, setIsTextExpanded] = useState(false)
	const [showSeeMore, setShowSeeMore] = useState(false)
	const textContainerRef = useRef<HTMLDivElement>(null)
	const textRef = useRef<HTMLDivElement>(null)
	const contextWindow = selectedModelInfo?.contextWindow || 1

	/*
	When dealing with event listeners in React components that depend on state
	variables, we face a challenge. We want our listener to always use the most
	up-to-date version of a callback function that relies on current state, but
	we don't want to constantly add and remove event listeners as that function
	updates. This scenario often arises with resize listeners or other window
	events. Simply adding the listener in a useEffect with an empty dependency
	array risks using stale state, while including the callback in the
	dependencies can lead to unnecessary re-registrations of the listener. There
	are react hook libraries that provide a elegant solution to this problem by
	utilizing the useRef hook to maintain a reference to the latest callback
	function without triggering re-renders or effect re-runs. This approach
	ensures that our event listener always has access to the most current state
	while minimizing performance overhead and potential memory leaks from
	multiple listener registrations. 

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
		if (textRef.current && textContainerRef.current) {
			let textContainerHeight = textContainerRef.current.clientHeight
			if (!textContainerHeight) {
				textContainerHeight = textContainerRef.current.getBoundingClientRect().height
			}
			const isOverflowing = textRef.current.scrollHeight > textContainerHeight
			// necessary to show see more button again if user resizes window to expand and then back to collapse
			if (!isOverflowing) {
				setIsTextExpanded(false)
			}
			setShowSeeMore(isOverflowing)
		}
	}, [task.text, windowWidth])

	const isCostAvailable = useMemo(() => {
		return (
			apiConfiguration?.apiProvider !== "openai" &&
			apiConfiguration?.apiProvider !== "ollama" &&
			apiConfiguration?.apiProvider !== "lmstudio" &&
			apiConfiguration?.apiProvider !== "gemini"
		)
	}, [apiConfiguration?.apiProvider])

	const shouldShowPromptCacheInfo = doesModelSupportPromptCache && apiConfiguration?.apiProvider !== "openrouter"

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
						<div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
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
								{t("chat:task.title")}
								{!isTaskExpanded && ":"}
							</span>
							{!isTaskExpanded && (
								<span style={{ marginLeft: 4 }}>{highlightMentions(task.text, false)}</span>
							)}
						</div>
					</div>
					{!isTaskExpanded && isCostAvailable && (
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
					<VSCodeButton
						appearance="icon"
						onClick={onClose}
						style={{ marginLeft: 6, flexShrink: 0, color: "var(--vscode-badge-foreground)" }}
						title={t("chat:task.closeAndStart")}>
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
									WebkitLineClamp: isTextExpanded ? "unset" : 3,
									WebkitBoxOrient: "vertical",
									overflow: "hidden",
									whiteSpace: "pre-wrap",
									wordBreak: "break-word",
									overflowWrap: "anywhere",
								}}>
								{highlightMentions(task.text, false)}
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
											background:
												"linear-gradient(to right, transparent, var(--vscode-badge-background))",
										}}
									/>
									<div
										style={{
											cursor: "pointer",
											color: "var(--vscode-badge-foreground)",
											fontSize: "11px",
											paddingRight: 8,
											paddingLeft: 4,
											backgroundColor: "var(--vscode-badge-background)",
										}}
										onClick={() => setIsTextExpanded(!isTextExpanded)}>
										{t("chat:task.seeMore")}
									</div>
								</div>
							)}
						</div>
						{isTextExpanded && showSeeMore && (
							<div
								style={{
									cursor: "pointer",
									color: "var(--vscode-badge-foreground)",
									fontSize: "11px",
									marginLeft: "auto",
									textAlign: "right",
									paddingRight: 8,
								}}
								onClick={() => setIsTextExpanded(!isTextExpanded)}>
								{t("chat:task.seeLess")}
							</div>
						)}

						{task.images && task.images.length > 0 && <Thumbnails images={task.images} />}

						<div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
							<div className="flex justify-between items-center h-[20px]">
								<div style={{ display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" }}>
									<span style={{ fontWeight: "bold" }}>{t("chat:task.tokens")}</span>
									<span style={{ display: "flex", alignItems: "center", gap: "3px" }}>
										<i
											className="codicon codicon-arrow-up"
											style={{ fontSize: "12px", fontWeight: "bold", marginBottom: "-2px" }}
										/>
										{formatLargeNumber(tokensIn || 0)}
									</span>
									<span style={{ display: "flex", alignItems: "center", gap: "3px" }}>
										<i
											className="codicon codicon-arrow-down"
											style={{ fontSize: "12px", fontWeight: "bold", marginBottom: "-2px" }}
										/>
										{formatLargeNumber(tokensOut || 0)}
									</span>
								</div>
								{!isCostAvailable && <TaskActions item={currentTaskItem} />}
							</div>

							{isTaskExpanded && contextWindow > 0 && (
								<div
									className={`w-full flex ${windowWidth < 400 ? "flex-col" : "flex-row"} gap-1 h-auto`}>
									<ContextWindowProgress
										contextWindow={contextWindow}
										contextTokens={contextTokens || 0}
										maxTokens={getMaxTokensForModel(selectedModelInfo, apiConfiguration)}
									/>
								</div>
							)}

							{shouldShowPromptCacheInfo && (cacheReads !== undefined || cacheWrites !== undefined) && (
								<div className="flex items-center gap-1 flex-wrap h-[20px]">
									<span style={{ fontWeight: "bold" }}>{t("chat:task.cache")}</span>
									<span className="flex items-center gap-1">
										<i
											className="codicon codicon-database"
											style={{ fontSize: "12px", fontWeight: "bold" }}
										/>
										+{formatLargeNumber(cacheWrites || 0)}
									</span>
									<span className="flex items-center gap-1">
										<i
											className="codicon codicon-arrow-right"
											style={{ fontSize: "12px", fontWeight: "bold" }}
										/>
										{formatLargeNumber(cacheReads || 0)}
									</span>
								</div>
							)}

							{isCostAvailable && (
								<div className="flex justify-between items-center h-[20px]">
									<div className="flex items-center gap-1">
										<span className="font-bold">{t("chat:task.apiCost")}</span>
										<span>${totalCost?.toFixed(4)}</span>
									</div>
									<TaskActions item={currentTaskItem} />
								</div>
							)}
						</div>
					</>
				)}
			</div>
		</div>
	)
}

export const highlightMentions = (text?: string, withShadow = true) => {
	if (!text) return text
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
					onClick={() => vscode.postMessage({ type: "openMention", text: part })}>
					@{part}
				</span>
			)
		}
	})
}

const TaskActions = ({ item }: { item: HistoryItem | undefined }) => {
	const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null)
	const { t } = useTranslation()

	return (
		<div className="flex flex-row gap-1">
			<Button
				variant="ghost"
				size="sm"
				title={t("chat:task.export")}
				onClick={() => vscode.postMessage({ type: "exportCurrentTask" })}>
				<span className="codicon codicon-cloud-download" />
			</Button>
			{!!item?.size && item.size > 0 && (
				<>
					<Button
						variant="ghost"
						size="sm"
						title={t("chat:task.delete")}
						onClick={(e) => {
							e.stopPropagation()

							if (e.shiftKey) {
								vscode.postMessage({ type: "deleteTaskWithId", text: item.id })
							} else {
								setDeleteTaskId(item.id)
							}
						}}>
						<span className="codicon codicon-trash" />
						{prettyBytes(item.size)}
					</Button>
					{deleteTaskId && (
						<DeleteTaskDialog
							taskId={deleteTaskId}
							onOpenChange={(open) => !open && setDeleteTaskId(null)}
							open
						/>
					)}
				</>
			)}
		</div>
	)
}

interface ContextWindowProgressProps {
	contextWindow: number
	contextTokens: number
	maxTokens?: number
}

const ContextWindowProgress = ({ contextWindow, contextTokens, maxTokens }: ContextWindowProgressProps) => {
	const { t } = useTranslation()
	// Use the shared utility function to calculate all token distribution values
	const tokenDistribution = useMemo(
		() => calculateTokenDistribution(contextWindow, contextTokens, maxTokens),
		[contextWindow, contextTokens, maxTokens],
	)

	// Destructure the values we need
	const { currentPercent, reservedPercent, availableSize, reservedForOutput, availablePercent } = tokenDistribution

	// For display purposes
	const safeContextWindow = Math.max(0, contextWindow)
	const safeContextTokens = Math.max(0, contextTokens)

	return (
		<>
			<div className="flex items-center gap-1 flex-shrink-0">
				<span className="font-bold" data-testid="context-window-label">
					{t("chat:task.contextWindow")}
				</span>
			</div>
			<div className="flex items-center gap-2 flex-1 whitespace-nowrap px-2">
				<div data-testid="context-tokens-count">{formatLargeNumber(safeContextTokens)}</div>
				<div className="flex-1 relative">
					{/* Invisible overlay for hover area */}
					<div
						className="absolute w-full cursor-pointer"
						style={{
							height: "16px",
							top: "-7px",
							zIndex: 5,
						}}
						title={t("chat:tokenProgress.availableSpace", { amount: formatLargeNumber(availableSize) })}
						data-testid="context-available-space"
					/>

					{/* Main progress bar container */}
					<div className="flex items-center h-1 rounded-[2px] overflow-hidden w-full bg-[color-mix(in_srgb,var(--vscode-badge-foreground)_20%,transparent)]">
						{/* Current tokens container */}
						<div className="relative h-full" style={{ width: `${currentPercent}%` }}>
							{/* Invisible overlay for current tokens section */}
							<div
								className="absolute cursor-pointer"
								style={{
									height: "16px",
									top: "-7px",
									width: "100%",
									zIndex: 6,
								}}
								title={t("chat:tokenProgress.tokensUsed", {
									used: formatLargeNumber(safeContextTokens),
									total: formatLargeNumber(safeContextWindow),
								})}
								data-testid="context-tokens-used"
							/>
							{/* Current tokens used - darkest */}
							<div
								className="h-full w-full bg-[var(--vscode-badge-foreground)]"
								style={{
									transition: "width 0.3s ease-out",
								}}
							/>
						</div>

						{/* Container for reserved tokens */}
						<div className="relative h-full" style={{ width: `${reservedPercent}%` }}>
							{/* Invisible overlay for reserved section */}
							<div
								className="absolute cursor-pointer"
								style={{
									height: "16px",
									top: "-7px",
									width: "100%",
									zIndex: 6,
								}}
								title={t("chat:tokenProgress.reservedForResponse", {
									amount: formatLargeNumber(reservedForOutput),
								})}
								data-testid="context-reserved-tokens"
							/>
							{/* Reserved for output section - medium gray */}
							<div
								className="h-full w-full bg-[color-mix(in_srgb,var(--vscode-badge-foreground)_30%,transparent)]"
								style={{
									transition: "width 0.3s ease-out",
								}}
							/>
						</div>

						{/* Empty section (if any) */}
						{availablePercent > 0 && (
							<div className="relative h-full" style={{ width: `${availablePercent}%` }}>
								{/* Invisible overlay for available space */}
								<div
									className="absolute cursor-pointer"
									style={{
										height: "16px",
										top: "-7px",
										width: "100%",
										zIndex: 6,
									}}
									title={t("chat:tokenProgress.availableSpace", {
										amount: formatLargeNumber(availableSize),
									})}
									data-testid="context-available-space-section"
								/>
							</div>
						)}
					</div>
				</div>
				<div data-testid="context-window-size">{formatLargeNumber(safeContextWindow)}</div>
			</div>
		</>
	)
}

export default memo(TaskHeader)
