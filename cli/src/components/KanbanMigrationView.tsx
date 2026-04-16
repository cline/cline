import { Box, Text, useApp, useInput } from "ink"
import React, { useMemo, useState } from "react"
import { COLORS } from "../constants/colors"
import { StdinProvider, useStdinContext } from "../context/StdinContext"
import { isEnterKey } from "../utils/input"
import { type KanbanMigrationAction } from "../utils/kanban"
import { StaticRobotFrame } from "./AsciiMotionCli"
import { ErrorBoundary } from "./ErrorBoundary"

interface KanbanMigrationViewProps {
	isRawModeSupported: boolean
	onSelect: (action: KanbanMigrationAction) => void
}

interface MigrationMenuItem {
	label: string
	description: string
	value: KanbanMigrationAction
}

const InternalKanbanMigrationView: React.FC<Pick<KanbanMigrationViewProps, "onSelect">> = ({ onSelect }) => {
	const { exit } = useApp()
	const { isRawModeSupported } = useStdinContext()
	const items = useMemo<MigrationMenuItem[]>(
		() => [
			{
				label: "Open the new experience",
				description: "Launch Cline Kanban and start there by default.",
				value: "kanban",
			},
			{
				label: "Exit",
				description: "You can always run cline --tui for the terminal experience.",
				value: "exit",
			},
		],
		[],
	)
	const [selectedIndex, setSelectedIndex] = useState(0)

	useInput(
		(input, key) => {
			if (key.escape) {
				onSelect("exit")
				exit()
			} else if (key.upArrow) {
				setSelectedIndex((prev) => (prev > 0 ? prev - 1 : items.length - 1))
			} else if (key.downArrow) {
				setSelectedIndex((prev) => (prev < items.length - 1 ? prev + 1 : 0))
			} else if (isEnterKey(input, key)) {
				onSelect(items[selectedIndex].value)
				exit()
			}
		},
		{ isActive: isRawModeSupported },
	)

	return (
		<Box flexDirection="column" width="100%">
			<StaticRobotFrame />
			<Text> </Text>
			<Text bold color="white">
				Introducing Cline Kanban!
			</Text>
			<Text color="gray">A board for orchestrating coding agents across worktrees, right from your browser.</Text>
			<Text> </Text>
			{items.map((item, index) => {
				const isSelected = index === selectedIndex
				return (
					<Box flexDirection="column" key={item.value} marginBottom={1}>
						<Text color={isSelected ? COLORS.primaryBlue : undefined}>
							{isSelected ? "❯ " : "  "}
							{item.label}
						</Text>
						<Text color="gray"> {item.description}</Text>
					</Box>
				)
			})}
			<Text> </Text>
			<Text color="gray">Use arrow keys to navigate, Enter to select, Esc or Ctrl+C to exit</Text>
		</Box>
	)
}

export const KanbanMigrationView: React.FC<KanbanMigrationViewProps> = ({ isRawModeSupported, onSelect }) => {
	const { exit } = useApp()

	return (
		<ErrorBoundary exit={exit}>
			<StdinProvider isRawModeSupported={isRawModeSupported}>
				<InternalKanbanMigrationView onSelect={onSelect} />
			</StdinProvider>
		</ErrorBoundary>
	)
}
