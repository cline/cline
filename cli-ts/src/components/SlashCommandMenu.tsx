/**
 * Slash command menu component for CLI
 * Displays a list of matching slash commands when user types /
 */

import type { SlashCommandInfo } from "@shared/proto/cline/slash"
import { Box, Text } from "ink"
import React from "react"

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

	// Show max 5 items, centered around selected item
	// Commands are already sorted (workflows first) by ChatView
	const maxVisible = 5
	let startIndex = 0
	let endIndex = commands.length

	if (commands.length > maxVisible) {
		const halfWindow = Math.floor(maxVisible / 2)
		startIndex = Math.max(0, selectedIndex - halfWindow)
		endIndex = Math.min(commands.length, startIndex + maxVisible)

		if (endIndex - startIndex < maxVisible) {
			startIndex = Math.max(0, endIndex - maxVisible)
		}
	}

	const visibleCommands = commands.slice(startIndex, endIndex)

	return (
		<Box flexDirection="column" marginBottom={1} paddingLeft={1} paddingRight={1}>
			{visibleCommands.map((cmd, idx) => {
				const actualIndex = startIndex + idx
				const isSelected = actualIndex === selectedIndex
				// Only show description for default commands (not workflows)
				const showDescription = cmd.section === "default" || !cmd.section

				return (
					<Box flexDirection="column" key={cmd.name}>
						<Box>
							<Text color={isSelected ? "blueBright" : undefined}>
								{isSelected ? "❯" : " "} /{cmd.name}
							</Text>
						</Box>
						{showDescription && cmd.description && (
							<Box paddingLeft={3}>
								<Text color="gray" dimColor>
									{cmd.description}
								</Text>
							</Box>
						)}
					</Box>
				)
			})}
		</Box>
	)
}
