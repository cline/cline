/**
 * Welcome view component
 * Shows an interactive prompt when user starts cline without a command
 */

import { Box, Text, useInput } from "ink"
import React, { useState } from "react"

interface WelcomeViewProps {
	onSubmit: (prompt: string) => void
	onExit?: () => void
}

/**
 * Format separator
 */
function formatSeparator(char: string = "─", width: number = 60): string {
	return char.repeat(Math.max(width, 10))
}

export const WelcomeView: React.FC<WelcomeViewProps> = ({ onSubmit, onExit }) => {
	const [textInput, setTextInput] = useState("")

	useInput((input, key) => {
		if (key.return) {
			if (textInput.trim()) {
				onSubmit(textInput.trim())
			}
		} else if (key.escape) {
			onExit?.()
		} else if (key.backspace || key.delete) {
			setTextInput((prev) => prev.slice(0, -1))
		} else if (input && !key.ctrl && !key.meta) {
			setTextInput((prev) => prev + input)
		}
	})

	return (
		<Box flexDirection="column">
			<Text bold color="cyan">
				✻ Welcome to Cline
			</Text>
			<Text color="gray">{formatSeparator()}</Text>
			<Text> </Text>
			<Text color="white">Start a new Cline task</Text>
			<Box flexDirection="column" marginTop={1}>
				<Text color="cyan">┃ What would you like Cline to help you with?</Text>
				<Box>
					<Text color="green">&gt; </Text>
					<Text>{textInput}</Text>
					<Text color="gray">▌</Text>
				</Box>
			</Box>
			<Text> </Text>
			<Text color="gray" dimColor>
				(Type your task and press Enter, or press Escape to exit)
			</Text>
		</Box>
	)
}
