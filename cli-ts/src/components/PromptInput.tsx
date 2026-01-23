/**
 * Shared input component with bordered text field and mode toggle row
 * Used by WelcomeView and AskPrompt for consistent input UI
 */

import type { Mode } from "@shared/storage/types"
import { Box, Text } from "ink"
import React from "react"

interface PromptInputProps {
	/** Current text input value */
	textInput: string
	/** Current mode (act/plan) */
	mode: Mode
	/** Model ID to display */
	modelId: string
	/** Optional question/prompt to show above input */
	question?: React.ReactNode
	/** Optional icon for the question */
	questionIcon?: string
	/** Color for the question text */
	questionColor?: string
	/** Help text to show below */
	helpText?: React.ReactNode
	/** Whether to show the mode toggle (default: true) */
	showModeToggle?: boolean
	/** Children rendered after the input (e.g., file mention menu) */
	children?: React.ReactNode
}

export const PromptInput: React.FC<PromptInputProps> = ({
	textInput,
	mode,
	modelId,
	question,
	questionIcon,
	questionColor = "cyan",
	helpText,
	showModeToggle = true,
	children,
}) => {
	const borderColor = mode === "act" ? "blue" : "yellow"

	return (
		<Box flexDirection="column" width="100%">
			{/* Question/prompt above input */}
			{question && (
				<Box marginBottom={0}>
					{questionIcon && <Text>{questionIcon} </Text>}
					{typeof question === "string" ? <Text color={questionColor}>{question}</Text> : question}
				</Box>
			)}

			{/* Input field with border */}
			<Box
				borderColor={borderColor}
				borderStyle="round"
				flexDirection="row"
				marginTop={question ? 0 : 1}
				paddingLeft={1}
				paddingRight={1}
				width="100%">
				<Text>{textInput}</Text>
				<Text color="gray">▌</Text>
			</Box>

			{/* Model ID and Mode toggle row */}
			<Box justifyContent="space-between" width="100%">
				{/* Model ID on left */}
				<Text color="gray" dimColor>
					{modelId}
				</Text>

				{/* Mode toggle on right */}
				{showModeToggle && (
					<Box gap={1}>
						<Box>
							<Text bold={mode === "plan"} color={mode === "plan" ? "yellow" : "gray"}>
								{mode === "plan" ? "●" : "○"} Plan
							</Text>
						</Box>
						<Box>
							<Text bold={mode === "act"} color={mode === "act" ? "blue" : "gray"}>
								{mode === "act" ? "●" : "○"} Act
							</Text>
						</Box>
						<Text color="gray" dimColor>
							(Tab)
						</Text>
					</Box>
				)}
			</Box>

			{/* Additional content (e.g., file mention menu) */}
			{children}

			{/* Help text */}
			{helpText && (
				<Box>
					{typeof helpText === "string" ? (
						<Text color="gray" dimColor>
							{helpText}
						</Text>
					) : (
						helpText
					)}
				</Box>
			)}
		</Box>
	)
}
