/**
 * SAP AI Core Setup component
 * Form-style layout for configuring SAP AI Core provider credentials
 * All fields visible on one screen with arrow key navigation
 */

import { Box, Text, useInput } from "ink"
// biome-ignore lint/correctness/noUnusedImports: React is required for JSX transformation (tsconfig jsx: react)
import type React from "react"
import { useCallback, useState } from "react"
import { COLORS } from "../constants/colors"
import { useStdinContext } from "../context/StdinContext"
import { isMouseEscapeSequence } from "../utils/input"

/**
 * SAP AI Core configuration interface
 * Contains all fields needed to authenticate with SAP AI Core
 */
export interface SapAiCoreConfig {
	clientId: string // OAuth Client ID (required)
	clientSecret: string // OAuth Client Secret (required)
	baseUrl: string // SAP AI Core base URL (required)
	tokenUrl: string // OAuth Token URL (required)
	resourceGroup?: string // Resource group (optional)
	useOrchestrationMode: boolean // Whether to use orchestration mode (default: true)
}

/**
 * Props for SapAiCoreSetup component
 */
interface SapAiCoreSetupProps {
	isActive: boolean
	onComplete: (config: SapAiCoreConfig) => void
	onCancel: () => void
}

/**
 * Field definitions for the form
 */
type FieldId = "clientId" | "clientSecret" | "baseUrl" | "tokenUrl" | "resourceGroup" | "orchestrationMode" | "done"

interface FieldConfig {
	id: FieldId
	label: string
	hint?: string
	placeholder?: string
	isPassword?: boolean
	isToggle?: boolean
	isButton?: boolean
	required?: boolean
}

const FIELDS: FieldConfig[] = [
	{
		id: "clientId",
		label: "Client ID",
		hint: "OAuth Client ID from your SAP AI Core service key",
		isPassword: true,
		required: true,
	},
	{
		id: "clientSecret",
		label: "Client Secret",
		hint: "OAuth Client Secret from your SAP AI Core service key",
		isPassword: true,
		required: true,
	},
	{
		id: "baseUrl",
		label: "Base URL",
		hint: "API endpoint URL (serviceurls.AI_API_URL)",
		placeholder: "https://api.ai.prod.eu-central-1.aws.ml.hana.ondemand.com/v2",
		required: true,
	},
	{
		id: "tokenUrl",
		label: "Token URL",
		hint: "OAuth token endpoint URL (url field from service key)",
		placeholder: "https://xxx.authentication.eu10.hana.ondemand.com",
		required: true,
	},
	{
		id: "resourceGroup",
		label: "Resource Group",
		hint: "Optional: Leave empty for default",
		placeholder: "default",
		required: false,
	},
	{
		id: "orchestrationMode",
		label: "Orchestration Mode",
		hint: "Recommended: Yes (simpler setup, no deployment IDs needed)",
		isToggle: true,
	},
	{
		id: "done",
		label: "Done",
		isButton: true,
	},
]

/**
 * SAP AI Core Setup form component
 * Displays all fields on one screen with arrow key navigation
 */
export const SapAiCoreSetup: React.FC<SapAiCoreSetupProps> = ({ isActive, onComplete, onCancel }) => {
	const { isRawModeSupported } = useStdinContext()

	// Form state
	const [clientId, setClientId] = useState("")
	const [clientSecret, setClientSecret] = useState("")
	const [baseUrl, setBaseUrl] = useState("")
	const [tokenUrl, setTokenUrl] = useState("")
	const [resourceGroup, setResourceGroup] = useState("")
	const [useOrchestrationMode, setUseOrchestrationMode] = useState(true)

	// Currently focused field index
	const [focusedIndex, setFocusedIndex] = useState(0)

	// Get value for a field
	const getFieldValue = useCallback(
		(id: FieldId): string => {
			switch (id) {
				case "clientId":
					return clientId
				case "clientSecret":
					return clientSecret
				case "baseUrl":
					return baseUrl
				case "tokenUrl":
					return tokenUrl
				case "resourceGroup":
					return resourceGroup
				default:
					return ""
			}
		},
		[clientId, clientSecret, baseUrl, tokenUrl, resourceGroup],
	)

	// Set value for a field
	const setFieldValue = useCallback((id: FieldId, value: string) => {
		switch (id) {
			case "clientId":
				setClientId(value)
				break
			case "clientSecret":
				setClientSecret(value)
				break
			case "baseUrl":
				setBaseUrl(value)
				break
			case "tokenUrl":
				setTokenUrl(value)
				break
			case "resourceGroup":
				setResourceGroup(value)
				break
		}
	}, [])

	// Check if all required fields are filled
	const isFormValid = useCallback(() => {
		return clientId.trim() && clientSecret.trim() && baseUrl.trim() && tokenUrl.trim()
	}, [clientId, clientSecret, baseUrl, tokenUrl])

	// Complete the setup
	const completeSetup = useCallback(() => {
		if (!isFormValid()) return

		onComplete({
			clientId: clientId.trim(),
			clientSecret: clientSecret.trim(),
			baseUrl: baseUrl.trim(),
			tokenUrl: tokenUrl.trim(),
			resourceGroup: resourceGroup.trim() || undefined,
			useOrchestrationMode,
		})
	}, [onComplete, clientId, clientSecret, baseUrl, tokenUrl, resourceGroup, useOrchestrationMode, isFormValid])

	// Handle keyboard input
	useInput(
		(input, key) => {
			if (isMouseEscapeSequence(input)) return

			const currentField = FIELDS[focusedIndex]

			if (key.escape) {
				onCancel()
				return
			}

			// Navigation
			if (key.upArrow) {
				setFocusedIndex((i) => (i > 0 ? i - 1 : FIELDS.length - 1))
				return
			}
			if (key.downArrow || (key.return && !currentField.isButton && !currentField.isToggle)) {
				setFocusedIndex((i) => (i < FIELDS.length - 1 ? i + 1 : 0))
				return
			}

			// Handle toggle field
			if (currentField.isToggle) {
				if (key.return || input === " ") {
					setUseOrchestrationMode((prev) => !prev)
				}
				return
			}

			// Handle button field
			if (currentField.isButton) {
				if (key.return) {
					completeSetup()
				}
				return
			}

			// Text input for regular fields
			if (key.backspace || key.delete) {
				const currentValue = getFieldValue(currentField.id)
				setFieldValue(currentField.id, currentValue.slice(0, -1))
			} else if (input && !key.ctrl && !key.meta) {
				const currentValue = getFieldValue(currentField.id)
				setFieldValue(currentField.id, currentValue + input)
			}
		},
		{ isActive: isActive && isRawModeSupported },
	)

	return (
		<Box flexDirection="column">
			<Text bold color="white">
				SAP AI Core Configuration
			</Text>
			<Text> </Text>

			{FIELDS.map((field, index) => {
				const isFocused = index === focusedIndex
				const value = getFieldValue(field.id)
				const displayValue = field.isPassword && value ? "•".repeat(value.length) : value

				// Toggle field - show both options with selection indicator
				if (field.isToggle) {
					return (
						<Box flexDirection="column" key={field.id} marginBottom={1}>
							<Box>
								<Text color={isFocused ? COLORS.primaryBlue : "white"}>
									{isFocused ? "❯ " : "  "}
									{field.label}:{" "}
								</Text>
								<Text color={useOrchestrationMode ? (isFocused ? COLORS.primaryBlue : "green") : "gray"}>
									{useOrchestrationMode ? "● Yes" : "○ Yes"}
								</Text>
								<Text color="gray"> / </Text>
								<Text color={!useOrchestrationMode ? (isFocused ? COLORS.primaryBlue : "green") : "gray"}>
									{!useOrchestrationMode ? "● No" : "○ No"}
								</Text>
							</Box>
							{field.hint && (
								<Box paddingLeft={2}>
									<Text color="gray">{field.hint}</Text>
								</Box>
							)}
							{isFocused && (
								<Box paddingLeft={2}>
									<Text color="gray">Press Enter or Space to toggle</Text>
								</Box>
							)}
						</Box>
					)
				}

				// Button field
				if (field.isButton) {
					const canSubmit = isFormValid()
					return (
						<Box key={field.id} marginTop={1}>
							<Text
								bold={isFocused}
								color={isFocused ? (canSubmit ? COLORS.primaryBlue : "red") : canSubmit ? "green" : "gray"}>
								{isFocused ? "❯ " : "  "}
								{canSubmit ? "[Submit]" : "[Fill required fields]"}
							</Text>
						</Box>
					)
				}

				// Text input field
				return (
					<Box flexDirection="column" key={field.id} marginBottom={1}>
						<Box>
							<Text color={isFocused ? COLORS.primaryBlue : "white"}>
								{isFocused ? "❯ " : "  "}
								{field.label}
								{field.required ? "*" : ""}:{" "}
							</Text>
							<Text color={isFocused ? "white" : "gray"}>
								{displayValue || (field.placeholder ? `(${field.placeholder})` : "")}
							</Text>
							{isFocused && <Text inverse> </Text>}
						</Box>
						{field.hint && isFocused && (
							<Box paddingLeft={2}>
								<Text color="gray">{field.hint}</Text>
							</Box>
						)}
					</Box>
				)
			})}

			<Text> </Text>
			<Text color="gray">↑↓ Navigate • Type to edit • Enter to move/submit • Esc to cancel</Text>
		</Box>
	)
}
