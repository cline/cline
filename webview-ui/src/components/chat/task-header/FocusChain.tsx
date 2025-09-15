import { isCompletedFocusChainItem, isFocusChainItem } from "@shared/focus-chain-utils"
import { StringRequest } from "@shared/proto/cline/common"
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import React, { memo, useCallback, useMemo, useState } from "react"
import ChecklistRenderer from "@/components/common/ChecklistRenderer"
import { FileServiceClient } from "@/services/grpc-client"

// Optimized interface with readonly properties to prevent accidental mutations
interface TodoInfo {
	readonly currentTodo: { text: string; completed: boolean; index: number } | null
	readonly currentIndex: number
	readonly completedCount: number
	readonly totalCount: number
	readonly progressPercentage: number
}

interface FocusChainProps {
	readonly lastProgressMessageText?: string
	readonly currentTaskItemId?: string
}

// Static strings to avoid recreating them
const COMPLETED_MESSAGE = "All tasks have been completed!"
const TODO_LIST_LABEL = "To-Do list"
const NEW_STEPS_MESSAGE = "New steps will be generated if you continue the task"
const CLICK_TO_EDIT_TITLE = "Click to edit to-do list in file"

// Optimized header component with minimal re-renders
const ToDoListHeader = memo<{
	todoInfo: TodoInfo
	isExpanded: boolean
}>(({ todoInfo, isExpanded }) => {
	const { currentTodo, currentIndex, totalCount, completedCount, progressPercentage } = todoInfo
	const isCompleted = completedCount === totalCount

	// Pre-compute display text
	const displayText = isCompleted ? COMPLETED_MESSAGE : currentTodo?.text || TODO_LIST_LABEL

	return (
		<div className={`focus-chain-header ${isCompleted ? "completed" : ""} relative w-full h-full`}>
			<div
				className="absolute focus-chain-progress bottom-0 left-0 transition-[width] duration-300 ease-in-out pointer-events-none z-1"
				style={{
					width: `${progressPercentage}%`,
					height: "4px",
					opacity: progressPercentage > 0 && progressPercentage < 100 ? 1.0 : 0,
				}}
			/>
			<div className="flex items-center justify-between gap-2 z-10 py-2.5 px-1.5">
				<div className="flex items-center gap-1.5 flex-1 min-w-0">
					<span className="progress-chip px-2 py-0.25 text-xs rounded-full inline-block shrink-0 bg-badge-foreground/20 text-badge-foreground">
						{currentIndex}/{totalCount}
					</span>
					<span className="header-text text-xs font-medium break-words overflow-hidden text-ellipsis whitespace-nowrap max-w-[calc(100%-60px)]">
						{displayText}
					</span>
				</div>
				<div className="flex items-center justify-between">
					{isExpanded ? <ChevronDownIcon className="ml-0.25" size="16" /> : <ChevronRightIcon size="16" />}
				</div>
			</div>
		</div>
	)
})

ToDoListHeader.displayName = "ToDoListHeader"

// Cache for parsed todo info to avoid re-parsing identical text
const todoInfoCache = new Map<string, TodoInfo | null>()
const MAX_CACHE_SIZE = 100

// Highly optimized parsing with minimal allocations
const parseCurrentTodoInfo = (text: string): TodoInfo | null => {
	if (!text) {
		return null
	}

	// Check cache first
	const cached = todoInfoCache.get(text)
	if (cached !== undefined) {
		return cached
	}

	let completedCount = 0
	let totalCount = 0
	let firstIncompleteIndex = -1
	let firstIncompleteText: string | null = null

	// Process text line by line without creating intermediate arrays
	let lineStart = 0
	let lineEnd = text.indexOf("\n")

	while (lineStart < text.length) {
		const line = lineEnd === -1 ? text.substring(lineStart).trim() : text.substring(lineStart, lineEnd).trim()

		if (isFocusChainItem(line)) {
			const isCompleted = isCompletedFocusChainItem(line)

			if (isCompleted) {
				completedCount++
			} else if (firstIncompleteIndex === -1) {
				firstIncompleteIndex = totalCount
				// Extract text only for the first incomplete item
				firstIncompleteText = line.substring(5).trim()
			}

			totalCount++
		}

		if (lineEnd === -1) {
			break
		}
		lineStart = lineEnd + 1
		lineEnd = text.indexOf("\n", lineStart)
	}

	if (totalCount === 0) {
		todoInfoCache.set(text, null)
		return null
	}

	const currentTodo = firstIncompleteText ? { text: firstIncompleteText, completed: false, index: firstIncompleteIndex } : null

	const result: TodoInfo = {
		currentTodo,
		currentIndex: firstIncompleteIndex >= 0 ? firstIncompleteIndex + 1 : totalCount,
		completedCount,
		totalCount,
		progressPercentage: (completedCount / totalCount) * 100,
	}

	// Cache the result with size management
	if (todoInfoCache.size >= MAX_CACHE_SIZE) {
		// Remove oldest entry (first key)
		const firstKey = todoInfoCache.keys().next().value
		if (firstKey) {
			todoInfoCache.delete(firstKey)
		}
	}
	todoInfoCache.set(text, result)
	return result
}

// Main component with aggressive optimization
export const FocusChain: React.FC<FocusChainProps> = memo(
	({ currentTaskItemId, lastProgressMessageText }) => {
		const [isExpanded, setIsExpanded] = useState(false)

		// Parse todo info with caching
		const todoInfo = useMemo(
			() => (lastProgressMessageText ? parseCurrentTodoInfo(lastProgressMessageText) : null),
			[lastProgressMessageText],
		)

		// Static callbacks that don't change
		const handleToggle = useCallback(() => setIsExpanded((prev) => !prev), [])

		const handleEditClick = useCallback(
			(e: React.MouseEvent) => {
				e.preventDefault()
				e.stopPropagation()
				if (currentTaskItemId) {
					FileServiceClient.openFocusChainFile(StringRequest.create({ value: currentTaskItemId }))
				}
			},
			[currentTaskItemId],
		)

		// Early return for no content
		if (!todoInfo) {
			return null
		}

		const isCompleted = todoInfo.completedCount === todoInfo.totalCount

		return (
			<div>
				<style>
					{`
						.focus-chain-container {
							background-color: color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 65%, transparent);
							border-radius: 4px;
							position: relative;
							overflow: hidden;
							opacity: 0.8;
							cursor: pointer;
							transition: all 0.2s ease;
						}
						.focus-chain-container:hover {
							background-color: color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 100%, transparent);
							opacity: 1;
						}
						.focus-chain-progress {
							background: linear-gradient(to right, var(--vscode-charts-green) 0%, var(--vscode-charts-green) 75%, transparent 100%);
						}
						.focus-chain-header.completed .header-text {
							color: var(--vscode-charts-green);
						}
						.focus-chain-header.completed .progress-chip {
							background-color: var(--vscode-charts-green);
							color: black;
						}
					`}
				</style>
				<div
					className="focus-chain-container flex flex-col gap-1.5 select-none"
					onClick={handleToggle}
					title={CLICK_TO_EDIT_TITLE}>
					<ToDoListHeader isExpanded={isExpanded} todoInfo={todoInfo} />
					{isExpanded && (
						<div className="mx-1 pb-2 px-1 rounded relative" onClick={handleEditClick}>
							<ChecklistRenderer text={lastProgressMessageText!} />
							{isCompleted && <div className="mt-2 text-xs font-semibold">{NEW_STEPS_MESSAGE}</div>}
						</div>
					)}
				</div>
			</div>
		)
	},
	(prevProps, nextProps) => {
		// Custom comparison for better performance
		return (
			prevProps.lastProgressMessageText === nextProps.lastProgressMessageText &&
			prevProps.currentTaskItemId === nextProps.currentTaskItemId
		)
	},
)

FocusChain.displayName = "FocusChain"
