import { cn } from "@heroui/react"
import { isChecklistItem, isCompletedChecklistItem } from "@shared/checklist-utils"
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import React, { memo, useCallback, useMemo, useState } from "react"
import ChecklistRenderer from "@/components/common/ChecklistRenderer"
import LightMarkdown from "@/components/common/LightMarkdown"

interface ChecklistInfo {
	readonly currentItem: { text: string; completed: boolean; index: number } | null
	readonly currentIndex: number
	readonly completedCount: number
	readonly totalCount: number
	readonly progressPercentage: number
}

interface TaskProgressChecklistProps {
	readonly lastProgressMessageText?: string
	readonly showPlaceholderWhenEmpty?: boolean
}

const COMPLETED_MESSAGE = "All tasks have been completed!"
const CHECKLIST_LABEL = "Checklist"
const NEW_STEPS_MESSAGE = "New steps will be generated if you continue the task"

const ChecklistHeader = memo<{
	checklistInfo: ChecklistInfo
	isExpanded: boolean
}>(({ checklistInfo, isExpanded }) => {
	const { currentItem, currentIndex, totalCount, completedCount, progressPercentage } = checklistInfo
	const isCompleted = completedCount === totalCount

	const displayText = isCompleted ? COMPLETED_MESSAGE : currentItem?.text || CHECKLIST_LABEL

	return (
		<div
			className={cn("relative w-full h-full", {
				"text-success": isCompleted,
			})}>
			<div
				className={cn(
					"absolute bottom-0 left-0 transition-[width] duration-300 ease-in-out pointer-events-none z-1 h-1 bg-success",
					{
						"opacity-0": progressPercentage === 0 || progressPercentage === 100,
					},
				)}
				style={{
					width: `${progressPercentage}%`,
				}}
			/>
			<div className="flex items-center gap-2 z-10 py-2 px-2.5">
				<div className="flex items-center gap-1.5 flex-1 min-w-0 text-sm">
					<span
						className={cn(
							"rounded-lg px-2 py-0.25 inline-block shrink-0 bg-badge-foreground/20 text-foreground text-sm",
							{
								"bg-success text-black": isCompleted,
							},
						)}>
						{currentIndex}/{totalCount}
					</span>
					<div className="header-text flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium">
						<LightMarkdown compact text={displayText} />
					</div>
				</div>
				<div className="flex items-center text-foreground shrink-0">
					{isExpanded ? <ChevronDownIcon className="ml-0.25" size="16" /> : <ChevronRightIcon size="16" />}
				</div>
			</div>
		</div>
	)
})

ChecklistHeader.displayName = "ChecklistHeader"

const checklistInfoCache = new Map<string, ChecklistInfo | null>()
const MAX_CACHE_SIZE = 100

const parseCurrentChecklistInfo = (text: string): ChecklistInfo | null => {
	if (!text) {
		return null
	}

	const cached = checklistInfoCache.get(text)
	if (cached !== undefined) {
		return cached
	}

	let completedCount = 0
	let totalCount = 0
	let firstIncompleteIndex = -1
	let firstIncompleteText: string | null = null

	let lineStart = 0
	let lineEnd = text.indexOf("\n")

	while (lineStart < text.length) {
		const line = lineEnd === -1 ? text.substring(lineStart).trim() : text.substring(lineStart, lineEnd).trim()

		if (isChecklistItem(line)) {
			const isCompleted = isCompletedChecklistItem(line)

			if (isCompleted) {
				completedCount++
			} else if (firstIncompleteIndex === -1) {
				firstIncompleteIndex = totalCount
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
		checklistInfoCache.set(text, null)
		return null
	}

	const currentItem = firstIncompleteText ? { text: firstIncompleteText, completed: false, index: firstIncompleteIndex } : null

	const result: ChecklistInfo = {
		currentItem,
		currentIndex: firstIncompleteIndex >= 0 ? firstIncompleteIndex + 1 : totalCount,
		completedCount,
		totalCount,
		progressPercentage: (completedCount / totalCount) * 100,
	}

	if (checklistInfoCache.size >= MAX_CACHE_SIZE) {
		const firstKey = checklistInfoCache.keys().next().value
		if (firstKey) {
			checklistInfoCache.delete(firstKey)
		}
	}
	checklistInfoCache.set(text, result)
	return result
}

export const TaskProgressChecklist: React.FC<TaskProgressChecklistProps> = memo(
	({ lastProgressMessageText, showPlaceholderWhenEmpty }) => {
		const [isExpanded, setIsExpanded] = useState(false)

		const checklistInfo = useMemo(
			() => (lastProgressMessageText ? parseCurrentChecklistInfo(lastProgressMessageText) : null),
			[lastProgressMessageText],
		)

		const handleToggle = useCallback(() => setIsExpanded((prev) => !prev), [])

		if (!checklistInfo) {
			if (!showPlaceholderWhenEmpty) {
				return null
			}

			return (
				<div
					aria-hidden={true}
					className="relative rounded-sm bg-toolbar-hover/65 flex items-center gap-2 select-none overflow-hidden opacity-80 px-2.5 py-2">
					<span className="rounded-lg px-2 py-0.25 inline-block shrink-0 bg-badge-foreground/20 text-foreground text-sm">
						0/0
					</span>
					<span className="text-sm text-foreground/80 truncate">TODOs</span>
				</div>
			)
		}

		if (isExpanded && !lastProgressMessageText) {
			return null
		}

		const isCompleted = checklistInfo.completedCount === checklistInfo.totalCount

		return (
			<button
				aria-label={isExpanded ? "Collapse task progress checklist" : "Expand task progress checklist"}
				className="relative rounded-sm bg-toolbar-hover/65 flex flex-col gap-1.5 select-none hover:bg-toolbar-hover overflow-hidden opacity-80 hover:opacity-100 transition-[transform,box-shadow] duration-200 cursor-pointer bg-transparent border-0 text-left text-inherit w-full p-0"
				onClick={handleToggle}
				type="button">
				<ChecklistHeader checklistInfo={checklistInfo} isExpanded={isExpanded} />
				{isExpanded && lastProgressMessageText && (
					<div className="mx-1 pb-2 px-1 relative">
						<ChecklistRenderer text={lastProgressMessageText} />
						{isCompleted && (
							<div className="mt-2 text-xs font-semibold text-muted-foreground">{NEW_STEPS_MESSAGE}</div>
						)}
					</div>
				)}
			</button>
		)
	},
	(prevProps, nextProps) => {
		return (
			prevProps.lastProgressMessageText === nextProps.lastProgressMessageText &&
			prevProps.showPlaceholderWhenEmpty === nextProps.showPlaceholderWhenEmpty
		)
	},
)

TaskProgressChecklist.displayName = "TaskProgressChecklist"
