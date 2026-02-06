/**
 * SAP AI Core Setup component
 * Form-style layout for configuring SAP AI Core provider credentials
 * All fields visible on one screen with arrow key navigation
 */

import { Box, Text, useInput } from "ink"
// biome-ignore lint/correctness/noUnusedImports: React is required for JSX transformation (tsconfig jsx: react)
import React, { useCallback, useState } from "react"
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
	/** Initial configuration values to pre-fill the form */
	initialConfig?: Partial<SapAiCoreConfig>
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
		hint: "API endpoint URL (serviceurls.AI_API_URL from service key)",
		required: true,
	},
	{
		id: "tokenUrl",
		label: "Token URL",
		hint: "OAuth token endpoint URL (url from service key)",
		required: true,
	},
	{
		id: "resourceGroup",
		label: "Resource Group",
		hint: "Optional: Leave empty for default",
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
export const SapAiCoreSetup: React.FC<SapAiCoreSetupProps> = ({ isActive, onComplete, onCancel, initialConfig }) => {
	const { isRawModeSupported } = useStdinContext()

	// Form state - pre-fill with initial values if provided
	// Note: useState only runs the initializer once, so we use useEffect to sync
	const [clientId, setClientId] = useState("")
	const [clientSecret, setClientSecret] = useState("")
	const [baseUrl, setBaseUrl] = useState("")
	const [tokenUrl, setTokenUrl] = useState("")
	const [resourceGroup, setResourceGroup] = useState("")
	const [useOrchestrationMode, setUseOrchestrationMode] = useState(true)
	const [initialized, setInitialized] = useState(false)

	// Initialize form with initial values (once)
	React.useEffect(() => {
		if (!initialized && initialConfig) {
			setClientId(initialConfig.clientId || "")
			setClientSecret(initialConfig.clientSecret || "")
			setBaseUrl(initialConfig.baseUrl || "")
			setTokenUrl(initialConfig.tokenUrl || "")
			setResourceGroup(initialConfig.resourceGroup || "")
			setUseOrchestrationMode(initialConfig.useOrchestrationMode ?? true)
			setInitialized(true)
		}
	}, [initialized, initialConfig])

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

			// Handle toggle field - left/right arrows or space to toggle, enter moves down
			if (currentField.isToggle) {
				if (key.leftArrow || key.rightArrow || input === " ") {
					setUseOrchestrationMode((prev) => !prev)
					return
				}
				// Enter moves to next field (handled below with other fields)
			}

			// Navigation
			if (key.upArrow) {
				setFocusedIndex((i) => (i > 0 ? i - 1 : FIELDS.length - 1))
				return
			}
			if (key.downArrow || (key.return && !currentField.isButton)) {
				setFocusedIndex((i) => (i < FIELDS.length - 1 ? i + 1 : 0))
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
									<Text color="gray">←→ or Space to toggle, Enter to continue</Text>
								</Box>
							)}
						</Box>
					)
				}

				// Button field
				if (field.isButton) {
					const canSubmit = Boolean(isFormValid())
					return (
						<Box flexDirection="column" key={field.id} marginTop={1}>
							<Box>
								<Text
									bold={isFocused && canSubmit}
									color={isFocused && canSubmit ? COLORS.primaryBlue : canSubmit ? "green" : "gray"}>
									{isFocused ? "❯ " : "  "}
									[Submit]
								</Text>
							</Box>
							{!canSubmit && (
								<Box paddingLeft={2}>
									<Text color="gray">Fill all required fields (*) to continue</Text>
								</Box>
							)}
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
