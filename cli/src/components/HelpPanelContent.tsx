/**
 * Help panel content for inline display in ChatView
 * Explains Cline CLI features and links to documentation
 */

import { Box, Text, useInput } from "ink"
import React from "react"
import { COLORS } from "../constants/colors"
import { useStdinContext } from "../context/StdinContext"
import { isMouseEscapeSequence } from "../utils/input"
import { Panel } from "./Panel"

interface HelpPanelContentProps {
	onClose: () => void
}

export const HelpPanelContent: React.FC<HelpPanelContentProps> = ({ onClose }) => {
	const { isRawModeSupported } = useStdinContext()

	useInput(
		(input, key) => {
			if (isMouseEscapeSequence(input)) {
				return
			}
			if (key.escape) {
				onClose()
			}
		},
		{ isActive: isRawModeSupported },
	)

	return (
		<Panel label="Help">
			<Box flexDirection="column" gap={1}>
				<Text>Cline can edit files, run terminal commands, use the browser, and more with your permission.</Text>

				<Box flexDirection="column">
					<Text bold>Plan vs Act Mode</Text>
					<Text>
						Use <Text color="yellow">Plan</Text> mode to discuss and strategize before making changes. Use{" "}
						<Text color={COLORS.primaryBlue}>Act</Text> mode when you're ready for Cline to edit files and run
						commands. Toggle between them with <Text color="white">Tab</Text>.
					</Text>
				</Box>

				<Box flexDirection="column">
					<Text bold>Keyboard Shortcuts</Text>
					<Text>
						{"  "}
						<Text color="white">Ctrl+U</Text> - Clear entire input (delete to start)
					</Text>
					<Text>
						{"  "}
						<Text color="white">Ctrl+K</Text> - Delete from cursor to end
					</Text>
					<Text>
						{"  "}
						<Text color="white">Ctrl+W</Text> - Delete word backwards
					</Text>
					<Text>
						{"  "}
						<Text color="white">Ctrl+A / Ctrl+E</Text> - Jump to start / end of input
					</Text>
					<Text>
						{"  "}
						<Text color="white">Alt/Option+←/→</Text> - Move by word
					</Text>
				</Box>

				<Box flexDirection="column">
					<Text bold>Slash Commands</Text>
					<Text>
						Type <Text color="white">/</Text> to see available commands. Key ones include:
					</Text>
					<Text>
						{"  "}
						<Text color="white">/settings</Text> - Configure your API provider and preferences
					</Text>
					<Text>
						{"  "}
						<Text color="white">/models</Text> - Switch AI models
					</Text>
					<Text>
						{"  "}
						<Text color="white">/history</Text> - Browse previous tasks
					</Text>
					<Text>
						{"  "}
						<Text color="white">/clear</Text> - Start a fresh task
					</Text>
				</Box>

				<Text>
					For more help: <Text color={COLORS.primaryBlue}>https://docs.cline.bot/cline-cli</Text>
				</Text>
			</Box>
		</Panel>
	)
}
