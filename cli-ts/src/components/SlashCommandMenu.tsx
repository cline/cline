/**
 * Slash command menu component for CLI
 * Displays a list of matching slash commands when user types /
 */

import type { SlashCommandInfo } from "@shared/proto/cline/slash"
import { Box, Text } from "ink"
import React from "react"
import { COLORS } from "../constants/colors"
import { getVisibleWindow } from "../utils/slash-commands"

interface SlashCommandMenuProps {
	commands: SlashCommandInfo[]
	selectedIndex: number
	query: string
}

export const SlashCommandMenu: React.FC<SlashCommandMenuProps> = ({ commands, selectedIndex, query }) => {
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

				return (
					<Box flexWrap="nowrap" key={cmd.name}>
						<Text color={isSelected ? COLORS.primaryBlue : undefined} wrap="truncate">
							{isSelected ? "❯" : " "} /{cmd.name}
						</Text>
						{showDescription && cmd.description && (
							<Text color="gray" wrap="truncate">
								{" "}
								- {cmd.description}
							</Text>
						)}
					</Box>
				)
			})}
			{hasMoreBelow && <Text color="gray">{"  "}▼</Text>}
		</Box>
	)
}
