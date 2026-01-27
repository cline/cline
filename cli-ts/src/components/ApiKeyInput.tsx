/**
 * Reusable API key input component
 * Shows a password-masked input field for entering API keys
 */

import { Box, Text, useInput } from "ink"
import React from "react"
import { COLORS } from "../constants/colors"
import { useStdinContext } from "../context/StdinContext"
import { isMouseEscapeSequence } from "../utils/input"

interface ApiKeyInputProps {
	providerName: string
	value: string
	onChange: (value: string) => void
	onSubmit: (value: string) => void
	onCancel: () => void
	isActive?: boolean
}

export const ApiKeyInput: React.FC<ApiKeyInputProps> = ({
	providerName,
	value,
	onChange,
	onSubmit,
	onCancel,
	isActive = true,
}) => {
	const { isRawModeSupported } = useStdinContext()

	useInput(
		(input, key) => {
			// Filter out mouse escape sequences
			if (isMouseEscapeSequence(input)) {
				return
			}

			if (key.escape) {
				onCancel()
				return
			}
			if (key.return) {
				onSubmit(value)
				return
			}
			if (key.backspace || key.delete) {
				onChange(value.slice(0, -1))
				return
			}
			if (input && !key.ctrl && !key.meta) {
				onChange(value + input)
			}
		},
		{ isActive: isRawModeSupported && isActive },
	)

	return (
		<Box flexDirection="column">
			<Text bold color={COLORS.primaryBlue}>
				{providerName} API Key
			</Text>
			<Box marginTop={1}>
				<Text color="gray">Paste your API key below</Text>
			</Box>
			<Box marginTop={1}>
				<Text color="white">{"•".repeat(value.length)}</Text>
				<Text inverse> </Text>
			</Box>
			<Box marginTop={1}>
				<Text color="gray">Enter to save, Esc to cancel</Text>
			</Box>
		</Box>
	)
}
