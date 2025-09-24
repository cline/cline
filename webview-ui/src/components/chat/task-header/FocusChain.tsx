import { cn } from "@heroui/react"
import { isCompletedFocusChainItem, isFocusChainItem } from "@shared/focus-chain-utils"
import { StringRequest } from "@shared/proto/cline/common"
import { ChevronDownIcon, ChevronRightIcon, PencilIcon } from "lucide-react"
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
	const { currentTodo, currentIndex, totalCount, completedCount } = todoInfo
	const isCompleted = completedCount === totalCount

	// Pre-compute display text
	const displayText = isCompleted ? COMPLETED_MESSAGE : currentTodo?.text || TODO_LIST_LABEL

	return (
		<div className="flex items-center justify-between gap-2 z-10 py-2.5 px-1.5 relative">
			<div className="flex items-center gap-1.5 flex-1 min-w-0">
				<span
					className={cn(
						"rounded-lg px-2 py-0.25 text-xs inline-block shrink-0 bg-badge-foreground/20 text-foreground",
						{
							"bg-success text-black": isCompleted,
						},
					)}>
					{currentIndex}/{totalCount}
				</span>
				<span className="header-text text-xs font-medium break-words overflow-hidden text-ellipsis whitespace-nowrap">
					{displayText}
				</span>
			</div>
			<div className="flex items-center justify-between text-foreground">
				{isExpanded ? <ChevronDownIcon className="ml-0.25" size="16" /> : <ChevronRightIcon size="16" />}
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
		const [isHoveringList, setIsHoveringList] = useState(false)

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
			<div
				className="relative flex flex-col gap-1.5 select-none overflow-hidden transition-[transform,box-shadow] duration-200 cursor-pointer hover:brightness-120"
				onClick={handleToggle}
				style={{
					backgroundColor: "color-mix(in srgb, var(--vscode-editorWidget-background) 60%, transparent)",
					borderTopLeftRadius: 0,
					borderTopRightRadius: 0,
					borderBottomLeftRadius: "4px",
					borderBottomRightRadius: "4px",
					borderLeft: "1px solid color-mix(in srgb, var(--vscode-editorWidget-border) 50%, transparent)",
					borderRight: "1px solid color-mix(in srgb, var(--vscode-editorWidget-border) 50%, transparent)",
					borderBottom: "1px solid color-mix(in srgb, var(--vscode-editorWidget-border) 50%, transparent)",
					width: "calc(100% - 8.5px)",
					marginLeft: "4px",
					marginTop: "-6px",
				}}
				title={CLICK_TO_EDIT_TITLE}>
				{/* Progress bar background */}
				<div
					className="absolute inset-0 pointer-events-none"
					style={{
						background: `linear-gradient(to right, var(--vscode-editorWidget-foreground) ${todoInfo.progressPercentage}%, transparent ${todoInfo.progressPercentage}%)`,
						opacity: 0.15,
						transition: "all 0.3s ease-in-out",
					}}
				/>
				{/* Content with higher z-index */}
				<div className="relative z-10">
					<ToDoListHeader isExpanded={isExpanded} todoInfo={todoInfo} />
					{isExpanded && (
						<div
							className="mx-1 pb-2 px-1 relative group cursor-pointer"
							onClick={handleEditClick}
							onMouseEnter={() => setIsHoveringList(true)}
							onMouseLeave={() => setIsHoveringList(false)}>
							<style>
								{`
									.focuschain-thin-scrollbar::-webkit-scrollbar {
										width: 2px;
									}
									.focuschain-thin-scrollbar::-webkit-scrollbar-track {
										background: transparent;
									}
									.focuschain-thin-scrollbar::-webkit-scrollbar-thumb {
										background: var(--vscode-scrollbarSlider-background);
										border-radius: 1px;
									}
									.focuschain-thin-scrollbar::-webkit-scrollbar-thumb:hover {
										background: var(--vscode-scrollbarSlider-hoverBackground);
									}
									.focuschain-thin-scrollbar {
										scrollbar-width: thin;
										scrollbar-color: var(--vscode-scrollbarSlider-background) transparent;
									}
								`}
							</style>
							<div className="focuschain-thin-scrollbar">
								<ChecklistRenderer text={lastProgressMessageText!} />
							</div>
							{/* {isCompleted && (
								<div className="mt-2 text-xs font-semibold text-muted-foreground">{NEW_STEPS_MESSAGE}</div>
							)} */}
							{/* Pencil icon on hover */}
							<div
								className={cn("absolute bottom-2 right-2", isHoveringList ? "opacity-60" : "opacity-0")}
								style={{
									pointerEvents: "none",
								}}>
								<PencilIcon className="text-foreground" size={14} />
							</div>
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
