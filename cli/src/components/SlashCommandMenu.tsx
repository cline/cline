/**
 * Slash command menu component for CLI
 * Displays a list of matching slash commands when user types /
 */

import type { SlashCommandInfo } from "@shared/proto/cline/slash"
import { Box, Text } from "ink"
import React from "react"
import { COLORS } from "../constants/colors"
import { useTerminalSize } from "../hooks/useTerminalSize"
import { getVisibleWindow } from "../utils/slash-commands"

interface SlashCommandMenuProps {
	commands: SlashCommandInfo[]
	selectedIndex: number
	query: string
}

export const SlashCommandMenu: React.FC<SlashCommandMenuProps> = ({ commands, selectedIndex, query }) => {
	const { columns: terminalWidth } = useTerminalSize()
	const contentWidth = Math.max(10, terminalWidth - 4)

	const truncateText = (text: string, maxLength: number): string => {
		if (maxLength <= 0) return ""
		if (text.length <= maxLength) return text
		if (maxLength <= 3) return text.slice(0, maxLength)
		return text.slice(0, maxLength - 3) + "..."
	}

	if (commands.length === 0) {
		return (
			<Box flexDirection="column" marginBottom={1} paddingLeft={1} paddingRight={1}>
				<Text color="gray">{query ? `No commands matching "/${query}"` : "Type to search commands..."}</Text>
			</Box>
		)
	}

	const { items: visibleCommands, startIndex } = getVisibleWindow(commands, selectedIndex)
	const hasMoreBelow = startIndex + visibleCommands.length < commands.length

	return (
		<Box flexDirection="column" marginBottom={1} paddingLeft={1} paddingRight={1}>
			{visibleCommands.map((cmd, idx) => {
				const isSelected = startIndex + idx === selectedIndex
				// Only show description for default commands (not workflows)
				const showDescription = cmd.section === "default" || !cmd.section
				const commandPrefix = `${isSelected ? "❯" : " "} /${cmd.name}`
				const truncatedCommand = truncateText(commandPrefix, contentWidth)
				const descriptionText = showDescription && cmd.description ? ` - ${cmd.description}` : ""
				const fullLine = truncateText(truncatedCommand + descriptionText, contentWidth)
				const commandText = fullLine.slice(0, Math.min(fullLine.length, truncatedCommand.length))
				const descText = fullLine.slice(commandText.length)

				return (
					<Box flexWrap="nowrap" key={cmd.name} width={contentWidth}>
						<Text color={isSelected ? COLORS.primaryBlue : undefined}>{commandText}</Text>
						{descText && <Text color="gray">{descText}</Text>}
					</Box>
				)
			})}
			{hasMoreBelow && <Text color="gray">{"  "}▼</Text>}
		</Box>
	)
}
