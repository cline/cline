/**
 * History view component
 * Displays task history with keyboard navigation
 */

import { Box, Text, useInput } from "ink"
import React, { useCallback, useState } from "react"
import { Controller } from "@/core/controller"
import { showTaskWithId } from "@/core/controller/task/showTaskWithId"
import { StringRequest } from "@/shared/proto/cline/common"

interface TaskHistoryItem {
	id: string
	ts: number
	task?: string
	totalCost?: number
	modelId?: string
}

interface HistoryViewProps {
	items: TaskHistoryItem[]
	visibleCount?: number
	controller: Controller
	onSelectTask?: (taskId: string) => void
}

/**
 * Format separator
 */
function formatSeparator(char: string = "─", width: number = 80): string {
	return char.repeat(Math.max(width, 10))
}

export const HistoryView: React.FC<HistoryViewProps> = ({ items, visibleCount = 10, controller, onSelectTask }) => {
	const [selectedIndex, setSelectedIndex] = useState(0)

	const onSelect = useCallback(
		(item: TaskHistoryItem) => {
			// Load the task via controller, then notify parent to switch views
			showTaskWithId(controller, StringRequest.create({ value: item.id }))
				.then(() => {
					onSelectTask?.(item.id)
				})
				.catch((error) => console.error("Error showing task:", error))
		},
		[controller, onSelectTask],
	)

	useInput((_input, key) => {
		if (key.upArrow) {
			setSelectedIndex((prev) => Math.max(0, prev - 1))
		} else if (key.downArrow) {
			setSelectedIndex((prev) => Math.min(items.length - 1, prev + 1))
		} else if (key.return && items[selectedIndex]) {
			onSelect(items[selectedIndex])
		}
	})

	// Calculate visible window around selected item
	const halfVisible = Math.floor(visibleCount / 2)
	let startIndex = Math.max(0, selectedIndex - halfVisible)
	const endIndex = Math.min(items.length, startIndex + visibleCount)
	// Adjust start if we're near the end
	if (endIndex - startIndex < visibleCount) {
		startIndex = Math.max(0, endIndex - visibleCount)
	}
	const visibleTasks = items.slice(startIndex, endIndex)

	const showUpIndicator = startIndex > 0
	const showDownIndicator = endIndex < items.length

	return (
		<Box flexDirection="column">
			<Text bold color="white">
				{"📜 Task History (" + items.length + " total)"}
			</Text>
			<Text dimColor>Use arrow keys to navigate, Enter to select</Text>
			<Text>{formatSeparator()}</Text>

			{items.length === 0 ? (
				<Text>No task history available.</Text>
			) : (
				<Box flexDirection="column">
					{showUpIndicator && <Text dimColor>{"  ↑ " + startIndex + " more above"}</Text>}
					{visibleTasks.map((task, index) => {
						const actualIndex = startIndex + index
						const isSelected = actualIndex === selectedIndex
						const date = new Date(task.ts).toLocaleString()
						const taskText = task.task?.substring(0, 60) || "Unknown task"
						const truncated = (task.task?.length || 0) > 60 ? "..." : ""

						return (
							<Box flexDirection="column" key={`${task.id}-${actualIndex}`} marginBottom={1}>
								<Box>
									<Text color={isSelected ? "green" : undefined}>{isSelected ? "> " : "  "}</Text>
									<Text dimColor>{date}</Text>
								</Box>
								<Box marginLeft={4}>
									<Text color="cyan">{task.id}</Text>
								</Box>
								<Box marginLeft={4}>
									<Text bold={isSelected} color={isSelected ? "white" : undefined}>
										{taskText}
										{truncated}
									</Text>
								</Box>
								{typeof task.totalCost === "number" && (
									<Box marginLeft={4}>
										<Text dimColor>Cost: ${task.totalCost ? task.totalCost.toFixed(4) : "0"}</Text>
									</Box>
								)}
								{task.modelId && (
									<Box marginLeft={4}>
										<Text dimColor>Model: {task.modelId}</Text>
									</Box>
								)}
							</Box>
						)
					})}
					{showDownIndicator && <Text dimColor>{"  ↓ " + (items.length - endIndex) + " more below"}</Text>}
				</Box>
			)}

			<Text>{formatSeparator()}</Text>
		</Box>
	)
}
