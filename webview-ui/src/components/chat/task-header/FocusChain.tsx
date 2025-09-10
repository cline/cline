import { isCompletedFocusChainItem, isFocusChainItem } from "@shared/focus-chain-utils"
import { StringRequest } from "@shared/proto/cline/common"
import React, { memo, useCallback, useMemo, useState } from "react"
import ChecklistRenderer from "@/components/common/ChecklistRenderer"
import { FileServiceClient } from "@/services/grpc-client"

interface TodoInfo {
	currentTodo: { text: string; completed: boolean; index: number } | null
	currentIndex: number
	completedCount: number
	totalCount: number
	hasItems: boolean
	isCompleted: boolean
	progressPercentage: number
}

interface FocusChainProps {
	lastProgressMessageText?: string
	currentTaskItemId?: string
}

// Memoized header component to prevent unnecessary re-renders
const ToDoListHeader = memo<{
	todoInfo: TodoInfo
	isTodoExpanded: boolean
	currentTaskItemId?: string
}>(({ todoInfo, isTodoExpanded }) => {
	if (!todoInfo.hasItems) {
		return null
	}

	// In-progress state
	return (
		<div className="relative w-full h-full">
			<div
				className="absolute top-0 left-0 h-full opacity-15 rounded-[3px] transition-[width] duration-300 ease-in-out pointer-events-none"
				style={{ width: `${todoInfo.progressPercentage}%` }}
			/>

			<div className="flex items-center justify-between gap-2 z-10 p-1.5">
				<div className="flex items-center gap-1.5 flex-1 min-w-0">
					<span className="px-2 py-0.25 text-xs rounded-full inline-block shrink-0  bg-badge-foreground/20 text-badge-foreground">
						{todoInfo.currentIndex}/{todoInfo.totalCount}
					</span>
					<span className="text-foreground text-sm font-medium break-words overflow-hidden text-ellipsis whitespace-nowrap max-w-[calc(100%-60px)]">
						{todoInfo.isCompleted
							? "All tasks have been completed!"
							: todoInfo.currentTodo && todoInfo.currentTodo.text}
					</span>
				</div>
				<div className="flex items-center justify-between">
					<div className={`shrink-0 codicon codicon-chevron-${isTodoExpanded ? "down" : "right"}`} />
				</div>
			</div>
		</div>
	)
})

ToDoListHeader.displayName = "ToDoListHeader"

// Optimized parsing function - single pass through lines
const parseCurrentTodoInfo = (text: string): TodoInfo | null => {
	if (!text) {
		return null
	}

	// Pre-allocate arrays for better performance
	const todoItems: Array<{ text: string; completed: boolean; index: number }> = []
	let completedCount = 0
	let currentTodoIndex = -1
	let lineIndex = 0

	// Single pass through lines
	const lines = text.split("\n")
	for (let i = 0, len = lines.length; i < len; i++) {
		const line = lines[i]
		const trimmedLine = line.trim()

		if (isFocusChainItem(trimmedLine)) {
			const completed = isCompletedFocusChainItem(trimmedLine)
			// Use slice instead of substring for better performance
			const itemText = trimmedLine.slice(5).trim()

			todoItems.push({ text: itemText, completed, index: lineIndex })

			if (completed) {
				completedCount++
			} else if (currentTodoIndex === -1) {
				// First incomplete item found
				currentTodoIndex = lineIndex
			}

			lineIndex++
		}
	}

	const totalCount = todoItems.length
	if (totalCount === 0) {
		return null
	}

	const currentTodo = currentTodoIndex >= 0 ? todoItems[currentTodoIndex] : null
	const currentIndex = currentTodoIndex >= 0 ? currentTodoIndex + 1 : totalCount
	const isCompleted = completedCount === totalCount
	const progressPercentage = totalCount > 0 ? (completedCount / totalCount) * 100 : 0

	return {
		currentTodo,
		currentIndex,
		completedCount,
		totalCount,
		hasItems: true,
		isCompleted,
		progressPercentage,
	}
}

// Main component with optimizations
export const FocusChain: React.FC<FocusChainProps> = memo(({ currentTaskItemId, lastProgressMessageText }) => {
	const [isTodoExpanded, setIsTodoExpanded] = useState(false)

	// Memoize parsed todo info
	const todoInfo = useMemo(
		() => (lastProgressMessageText ? parseCurrentTodoInfo(lastProgressMessageText) : null),
		[lastProgressMessageText],
	)

	// Memoize toggle handler
	const handleToggle = useCallback(() => {
		setIsTodoExpanded((prev) => !prev)
	}, [])

	// Memoize edit click handler
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
	if (!lastProgressMessageText || !todoInfo) {
		return null
	}

	return (
		<div
			className="flex flex-col gap-1.5 cursor-pointer rounded select-none bg-[color-mix(in_srgb,var(--vscode-badge-foreground)_10%,transparent)]"
			onClick={handleToggle}
			title="Click to edit to-do list in file">
			<ToDoListHeader currentTaskItemId={currentTaskItemId} isTodoExpanded={isTodoExpanded} todoInfo={todoInfo} />
			{isTodoExpanded && (
				<div className="mx-1 pb-2 px-1 rounded relative" onClick={handleEditClick}>
					<ChecklistRenderer text={lastProgressMessageText} />
					<div className="mt-2 text-xs text-description font-semibold">
						{todoInfo.isCompleted ? "New steps will be generated if you continue the task" : ""}
					</div>
				</div>
			)}
		</div>
	)
})

FocusChain.displayName = "FocusChainContainer"
