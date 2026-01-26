/**
 * Reusable API key input component
 * Shows a password-masked input field for entering API keys
 */

import { Box, Text, useInput } from "ink"
import React from "react"
import { useStdinContext } from "../context/StdinContext"

interface ApiKeyInputProps {
	providerName: string
	value: string
	onChange: (value: string) => void
	onSubmit: () => void
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
			if (key.escape) {
				onCancel()
				return
			}
			if (key.return) {
				onSubmit()
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
			<Text bold color="blueBright">
				{providerName} API Key
			</Text>
			<Box marginTop={1}>
				<Text color="gray">Paste your API key below</Text>
			</Box>
			<Box marginTop={1}>
				<Text color="white">{"•".repeat(value.length)}</Text>
				<Text color="gray">▌</Text>
			</Box>
			<Box marginTop={1}>
				<Text color="gray" dimColor>
					Enter to save, Esc to cancel
				</Text>
			</Box>
		</Box>
	)
}
