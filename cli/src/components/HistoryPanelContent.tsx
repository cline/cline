/**
 * History panel content for inline display in ChatView
 * Shows task history with search and keyboard navigation
 */

import { StringRequest } from "@shared/proto/cline/common"
import { GetTaskHistoryRequest } from "@shared/proto/cline/task"
import { Box, Text, useInput } from "ink"
import React, { useCallback, useEffect, useMemo, useState } from "react"
import type { Controller } from "@/core/controller"
import { getTaskHistory } from "@/core/controller/task/getTaskHistory"
import { showTaskWithId } from "@/core/controller/task/showTaskWithId"
import { COLORS } from "../constants/colors"
import { useStdinContext } from "../context/StdinContext"
import { useTerminalSize } from "../hooks/useTerminalSize"
import { isMouseEscapeSequence } from "../utils/input"
import { Panel } from "./Panel"

interface TaskHistoryItem {
	id: string
	ts: number
	task: string
	totalCost: number
	tokensIn: number
	tokensOut: number
	isFavorited: boolean
}

interface HistoryPanelContentProps {
	onClose: () => void
	onSelectTask: (taskId: string) => void
	controller: Controller
}

function formatRelativeDate(ts: number): string {
	const now = Date.now()
	const diff = now - ts
	const minutes = Math.floor(diff / 60000)
	const hours = Math.floor(diff / 3600000)
	const days = Math.floor(diff / 86400000)

	if (minutes < 1) return "just now"
	if (minutes < 60) return `${minutes}m ago`
	if (hours < 24) return `${hours}h ago`
	if (days < 7) return `${days}d ago`
	return new Date(ts).toLocaleDateString()
}

function formatCost(cost: number): string {
	if (cost === 0) return ""
	return `$${cost.toFixed(2)}`
}

export const HistoryPanelContent: React.FC<HistoryPanelContentProps> = ({ onClose, onSelectTask, controller }) => {
	const { isRawModeSupported } = useStdinContext()
	const { rows: terminalRows } = useTerminalSize()
	const [items, setItems] = useState<TaskHistoryItem[]>([])
	const [searchQuery, setSearchQuery] = useState("")
	const [selectedIndex, setSelectedIndex] = useState(0)
	const [loading, setLoading] = useState(true)

	// Calculate how many items fit in the panel
	// Panel has border (2) + header (1) + separator (1) + search bar (1) + hint (1) = 6 lines overhead
	// Each item takes 2 lines (text + metadata)
	const panelHeight = Math.min(terminalRows - 6, 20) // Cap panel height
	const itemHeight = 2
	const maxVisible = Math.max(1, Math.floor((panelHeight - 4) / itemHeight) - 2) // 4 lines for search + hints + padding

	// Load history
	useEffect(() => {
		const load = async () => {
			setLoading(true)
			try {
				const request = GetTaskHistoryRequest.create({
					sortBy: "newest",
					searchQuery: searchQuery || undefined,
				})
				const result = await getTaskHistory(controller, request)
				setItems(
					result.tasks.map((t) => ({
						id: t.id,
						ts: t.ts,
						task: t.task,
						totalCost: t.totalCost,
						tokensIn: t.tokensIn,
						tokensOut: t.tokensOut,
						isFavorited: t.isFavorited,
					})),
				)
			} catch {
				setItems([])
			}
			setLoading(false)
		}
		load()
	}, [controller, searchQuery])

	// Reset selection when search changes
	useEffect(() => {
		setSelectedIndex(0)
	}, [searchQuery])

	const handleSelect = useCallback(
		async (item: TaskHistoryItem) => {
			try {
				await showTaskWithId(controller, StringRequest.create({ value: item.id }))
				onSelectTask(item.id)
			} catch (error) {
				console.error("Error opening task:", error)
			}
		},
		[controller, onSelectTask],
	)

	// Visible window
	const scrollOffset = useMemo(() => {
		const half = Math.floor(maxVisible / 2)
		let start = Math.max(0, selectedIndex - half)
		const end = Math.min(items.length, start + maxVisible)
		if (end - start < maxVisible) {
			start = Math.max(0, end - maxVisible)
		}
		return start
	}, [selectedIndex, maxVisible, items.length])

	const visibleItems = items.slice(scrollOffset, scrollOffset + maxVisible)
	const showUpIndicator = scrollOffset > 0
	const showDownIndicator = scrollOffset + maxVisible < items.length

	useInput(
		(input, key) => {
			if (isMouseEscapeSequence(input)) {
				return
			}

			if (key.escape) {
				if (searchQuery) {
					setSearchQuery("")
				} else {
					onClose()
				}
				return
			}

			if (key.return && items[selectedIndex]) {
				handleSelect(items[selectedIndex])
				return
			}

			if (key.upArrow) {
				setSelectedIndex((i) => Math.max(0, i - 1))
				return
			}
			if (key.downArrow) {
				setSelectedIndex((i) => Math.min(items.length - 1, i + 1))
				return
			}

			// Backspace for search
			if (key.backspace || key.delete) {
				setSearchQuery((q) => q.slice(0, -1))
				return
			}

			// Printable characters for search
			if (input && !key.ctrl && !key.meta && input.length === 1 && input.charCodeAt(0) >= 32) {
				setSearchQuery((q) => q + input)
			}
		},
		{ isActive: isRawModeSupported },
	)

	const renderContent = () => {
		if (loading) {
			return <Text color="gray">Loading history...</Text>
		}

		if (items.length === 0) {
			return <Text color="gray">{searchQuery ? "No tasks match your search." : "No task history."}</Text>
		}

		return (
			<Box flexDirection="column">
				<Text color="gray">{showUpIndicator ? "  ▲" : " "}</Text>
				{visibleItems.map((item, idx) => {
					const actualIndex = scrollOffset + idx
					const isSelected = actualIndex === selectedIndex
					const taskText = item.task.replace(/\n/g, " ")
					const meta = [formatRelativeDate(item.ts), formatCost(item.totalCost)].filter(Boolean).join(" · ")

					return (
						<Box flexDirection="column" key={item.id}>
							<Box overflow="hidden">
								<Text color={isSelected ? COLORS.primaryBlue : undefined} wrap="truncate">
									{isSelected ? "❯ " : "  "}
									{taskText}
								</Text>
							</Box>
							<Box>
								<Text color="gray">
									{"  "}
									{meta}
								</Text>
							</Box>
						</Box>
					)
				})}
				<Text color="gray">{showDownIndicator ? "  ▼" : " "}</Text>
			</Box>
		)
	}

	return (
		<Panel label="History">
			<Box>
				<Text color="gray">Search: </Text>
				<Text color="white">{searchQuery}</Text>
				<Text inverse> </Text>
			</Box>
			<Box>
				<Text color="gray">{searchQuery ? "Esc to clear" : "Enter to open · Esc to close"}</Text>
			</Box>
			{renderContent()}
		</Panel>
	)
}
