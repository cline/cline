/**
 * Bedrock Custom Model Flow component
 * Two-step flow: ARN/custom model ID input → base model selection for capability detection.
 * Used by both AuthView (onboarding) and SettingsPanelContent (/settings).
 */

import { Box, Text, useInput } from "ink"
// biome-ignore lint/correctness/noUnusedImports: React is needed for JSX at runtime
import React, { useCallback, useState } from "react"
import { COLORS } from "../constants/colors"
import { useStdinContext } from "../context/StdinContext"
import { getModelList } from "./ModelPicker"
import { SearchableList } from "./SearchableList"

type FlowStep = "arn_input" | "base_model"

interface BedrockCustomModelFlowProps {
	/** Whether this component should capture keyboard input */
	isActive: boolean
	/** Called when the user completes both steps (ARN + base model selection) */
	onComplete: (arn: string, baseModelId: string) => void
	/** Called when the user presses Escape on the first step (ARN input) */
	onCancel: () => void
}

export const BedrockCustomModelFlow: React.FC<BedrockCustomModelFlowProps> = ({ isActive, onComplete, onCancel }) => {
	const { isRawModeSupported } = useStdinContext()
	const [step, setStep] = useState<FlowStep>("arn_input")
	const [customArn, setCustomArn] = useState("")

	const handleArnSubmit = useCallback(() => {
		if (customArn.trim()) {
			setStep("base_model")
		}
	}, [customArn])

	const handleBaseModelCancel = useCallback(() => {
		setStep("arn_input")
	}, [])

	useInput(
		(input, key) => {
			if (step === "arn_input") {
				if (key.escape) {
					onCancel()
				} else if (key.return) {
					handleArnSubmit()
				} else if (key.backspace || key.delete) {
					setCustomArn((prev) => prev.slice(0, -1))
				} else if (input && !key.ctrl && !key.meta) {
					setCustomArn((prev) => prev + input)
				}
				return
			}

			if (step === "base_model") {
				if (key.escape) {
					handleBaseModelCancel()
				}
				// Other input is handled by SearchableList
			}
		},
		{ isActive: isActive && isRawModeSupported },
	)

	if (step === "arn_input") {
		return (
			<Box flexDirection="column">
				<Text bold color={COLORS.primaryBlue}>
					Custom Model ID
				</Text>
				<Box marginTop={1}>
					<Text color="gray">Enter your Application Inference Profile ARN or custom model ID</Text>
				</Box>
				<Box marginTop={1}>
					{customArn ? (
						<Text color="white">{customArn}</Text>
					) : (
						<Text color="gray">e.g. arn:aws:bedrock:region:account:application-inference-profile/...</Text>
					)}
					<Text inverse> </Text>
				</Box>
				<Box marginTop={1}>
					<Text color="gray">Enter to continue, Esc to go back</Text>
				</Box>
			</Box>
		)
	}

	// step === "base_model"
	return (
		<Box flexDirection="column">
			<Text bold color={COLORS.primaryBlue}>
				Base Inference Model
			</Text>
			<Text color="gray">Select the base model your inference profile uses (for capability detection)</Text>
			<Box marginTop={1}>
				<SearchableList
					isActive={isActive && step === "base_model"}
					items={getModelList("bedrock").map((id) => ({ id, label: id }))}
					onSelect={(item) => {
						onComplete(customArn, item.id)
					}}
				/>
			</Box>
			<Box marginTop={1}>
				<Text color="gray">Type to search, arrows to navigate, Enter to select, Esc to go back</Text>
			</Box>
		</Box>
	)
}
