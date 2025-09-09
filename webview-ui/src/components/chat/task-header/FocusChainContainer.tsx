import { isCompletedFocusChainItem, isFocusChainItem } from "@shared/focus-chain-utils"
import { StringRequest } from "@shared/proto/cline/common"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
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

interface FocusChainContainerProps {
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
				<div className="flex items-center gap-2 flex-1 min-w-0">
					<span className="bg-[color-mix(in_srgb,var(--vscode-badge-foreground)_20%,transparent)] text-[var(--vscode-badge-foreground)] py-0.5 px-1.5 rounded-[10px]">
						{todoInfo.currentIndex}/{todoInfo.totalCount}
					</span>
					{/* {todoInfo.currentTodo && (
						<span className="text-foreground text-sm font-medium break-words overflow-hidden text-ellipsis whitespace-nowrap max-w-[calc(100%-60px)]">
							{todoInfo.currentTodo.text}
						</span>
					)} */}
					<span className="text-foreground text-sm font-medium break-words overflow-hidden text-ellipsis whitespace-nowrap max-w-[calc(100%-60px)]">
						{todoInfo.isCompleted
							? `All ${todoInfo.totalCount} steps are completed!`
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
export const FocusChainContainer: React.FC<FocusChainContainerProps> = memo(({ currentTaskItemId, lastProgressMessageText }) => {
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
			className="flex flex-col gap-1.5 cursor-pointer select-none bg-[color-mix(in_srgb,var(--vscode-badge-foreground)_10%,transparent)]"
			onClick={handleToggle}>
			<ToDoListHeader currentTaskItemId={currentTaskItemId} isTodoExpanded={isTodoExpanded} todoInfo={todoInfo} />

			{isTodoExpanded && (
				<div className="m-1 pb-2 px-1 rounded relative">
					<ChecklistRenderer text={lastProgressMessageText} />
					<div className="flex justify-between items-center">
						<div className="mt-2 text-xs text-description">
							{todoInfo.isCompleted ? "New steps will be generated if you continue the task" : ""}
						</div>

						<VSCodeButton
							appearance="icon"
							className="text-xs opacity-70 hover:bg-transparent hover:opacity-100"
							onClick={handleEditClick}
							title="Edit focus chain list in markdown file">
							<span className="codicon codicon-edit" />
						</VSCodeButton>
					</div>
				</div>
			)}
		</div>
	)
})

FocusChainContainer.displayName = "FocusChainContainer"
