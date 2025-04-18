import React, { memo, useMemo, useRef, useState } from "react"
import { useWindowSize } from "react-use"
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
import { cn } from "@/lib/utils"
import { VSCodeBadge } from "@vscode/webview-ui-toolkit/react"

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
	const [isTaskExpanded, setIsTaskExpanded] = useState(false)

	const textContainerRef = useRef<HTMLDivElement>(null)
	const textRef = useRef<HTMLDivElement>(null)
	const contextWindow = selectedModelInfo?.contextWindow || 1

	const { width: windowWidth } = useWindowSize()

	const shouldShowPromptCacheInfo = doesModelSupportPromptCache && apiConfiguration?.apiProvider !== "openrouter"

	return (
		<div className="py-2 px-3">
			<div
				className={cn(
					"rounded-xs p-2.5 flex flex-col gap-1.5 relative z-1 border",
					!!isTaskExpanded
						? "border-vscode-panel-border text-vscode-foreground"
						: "border-vscode-panel-border/80 text-vscode-foreground/80",
				)}>
				<div className="flex justify-between items-center gap-2">
					<div
						className="flex items-center cursor-pointer -ml-0.5 select-none grow min-w-0"
						onClick={() => setIsTaskExpanded(!isTaskExpanded)}>
						<div className="flex items-center shrink-0">
							<span className={`codicon codicon-chevron-${isTaskExpanded ? "down" : "right"}`}></span>
						</div>
						<div className="ml-1.5 whitespace-nowrap overflow-hidden text-ellipsis grow min-w-0">
							<span className="font-bold">
								{t("chat:task.title")}
								{!isTaskExpanded && ":"}
							</span>
							{!isTaskExpanded && <span className="ml-1">{highlightMentions(task.text, false)}</span>}
						</div>
					</div>
					<Button
						variant="ghost"
						size="icon"
						onClick={onClose}
						title={t("chat:task.closeAndStart")}
						className="shrink-0 w-5 h-5">
						<span className="codicon codicon-close" />
					</Button>
				</div>
				{/* Collapsed state: Track context and cost if we have any */}
				{!isTaskExpanded && contextWindow > 0 && (
					<div className={`w-full flex flex-row gap-1 h-auto`}>
						<ContextWindowProgress
							contextWindow={contextWindow}
							contextTokens={contextTokens || 0}
							maxTokens={getMaxTokensForModel(selectedModelInfo, apiConfiguration)}
						/>
						{!!totalCost && <VSCodeBadge>${totalCost.toFixed(2)}</VSCodeBadge>}
					</div>
				)}
				{/* Expanded state: Show task text and images */}
				{isTaskExpanded && (
					<>
						<div
							ref={textContainerRef}
							className="-mt-0.5 text-vscode-font-size overflow-y-auto break-words break-anywhere relative">
							<div
								ref={textRef}
								className="overflow-auto max-h-80 whitespace-pre-wrap break-words break-anywhere"
								style={{
									display: "-webkit-box",
									WebkitLineClamp: "unset",
									WebkitBoxOrient: "vertical",
								}}>
								{highlightMentions(task.text, false)}
							</div>
						</div>
						{task.images && task.images.length > 0 && <Thumbnails images={task.images} />}

						<div className="flex flex-col gap-1">
							{isTaskExpanded && contextWindow > 0 && (
								<div
									className={`w-full flex ${windowWidth < 400 ? "flex-col" : "flex-row"} gap-1 h-auto`}>
									<div className="flex items-center gap-1 flex-shrink-0">
										<span className="font-bold" data-testid="context-window-label">
											{t("chat:task.contextWindow")}
										</span>
									</div>
									<ContextWindowProgress
										contextWindow={contextWindow}
										contextTokens={contextTokens || 0}
										maxTokens={getMaxTokensForModel(selectedModelInfo, apiConfiguration)}
									/>
								</div>
							)}
							<div className="flex justify-between items-center h-[20px]">
								<div className="flex items-center gap-1 flex-wrap">
									<span className="font-bold">{t("chat:task.tokens")}</span>
									<span className="flex items-center gap-[3px]">
										<i className="codicon codicon-arrow-up text-xs font-bold -mb-0.5" />
										{formatLargeNumber(tokensIn || 0)}
									</span>
									<span className="flex items-center gap-[3px]">
										<i className="codicon codicon-arrow-down text-xs font-bold -mb-0.5" />
										{formatLargeNumber(tokensOut || 0)}
									</span>
								</div>
								{!totalCost && <TaskActions item={currentTaskItem} />}
							</div>

							{shouldShowPromptCacheInfo && (cacheReads !== undefined || cacheWrites !== undefined) && (
								<div className="flex items-center gap-1 flex-wrap h-[20px]">
									<span className="font-bold">{t("chat:task.cache")}</span>
									<span className="flex items-center gap-1">
										<i className="codicon codicon-database text-xs font-bold" />+
										{formatLargeNumber(cacheWrites || 0)}
									</span>
									<span className="flex items-center gap-1">
										<i className="codicon codicon-arrow-right text-xs font-bold" />
										{formatLargeNumber(cacheReads || 0)}
									</span>
								</div>
							)}

							{!!totalCost && (
								<div className="flex justify-between items-center h-[20px]">
									<div className="flex items-center gap-1">
										<span className="font-bold">{t("chat:task.apiCost")}</span>
										<span>${totalCost?.toFixed(2)}</span>
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
					className={`${withShadow ? "mention-context-highlight-with-shadow" : "mention-context-highlight"} cursor-pointer`}
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
			<div className="flex items-center gap-2 flex-1 whitespace-nowrap px-2">
				<div data-testid="context-tokens-count">{formatLargeNumber(safeContextTokens)}</div>
				<div className="flex-1 relative">
					{/* Invisible overlay for hover area */}
					<div
						className="absolute w-full h-4 -top-[7px] z-5"
						title={t("chat:tokenProgress.availableSpace", { amount: formatLargeNumber(availableSize) })}
						data-testid="context-available-space"
					/>

					{/* Main progress bar container */}
					<div className="flex items-center h-1 rounded-[2px] overflow-hidden w-full bg-[color-mix(in_srgb,var(--vscode-foreground)_20%,transparent)]">
						{/* Current tokens container */}
						<div className="relative h-full" style={{ width: `${currentPercent}%` }}>
							{/* Invisible overlay for current tokens section */}
							<div
								className="absolute h-4 -top-[7px] w-full z-6"
								title={t("chat:tokenProgress.tokensUsed", {
									used: formatLargeNumber(safeContextTokens),
									total: formatLargeNumber(safeContextWindow),
								})}
								data-testid="context-tokens-used"
							/>
							{/* Current tokens used - darkest */}
							<div className="h-full w-full bg-[var(--vscode-foreground)] transition-width duration-300 ease-out" />
						</div>

						{/* Container for reserved tokens */}
						<div className="relative h-full" style={{ width: `${reservedPercent}%` }}>
							{/* Invisible overlay for reserved section */}
							<div
								className="absolute h-4 -top-[7px] w-full z-6"
								title={t("chat:tokenProgress.reservedForResponse", {
									amount: formatLargeNumber(reservedForOutput),
								})}
								data-testid="context-reserved-tokens"
							/>
							{/* Reserved for output section - medium gray */}
							<div className="h-full w-full bg-[color-mix(in_srgb,var(--vscode-foreground)_30%,transparent)] transition-width duration-300 ease-out" />
						</div>

						{/* Empty section (if any) */}
						{availablePercent > 0 && (
							<div className="relative h-full" style={{ width: `${availablePercent}%` }}>
								{/* Invisible overlay for available space */}
								<div
									className="absolute h-4 -top-[7px] w-full z-6"
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
