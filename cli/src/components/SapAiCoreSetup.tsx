/**
 * SAP AI Core Setup component
 * Multi-step wizard for configuring SAP AI Core provider credentials
 */

import { Box, Text } from "ink"
// biome-ignore lint/style/useImportType: React is used as a value by JSX (jsx: "react" in tsconfig)
import React, { useState } from "react"

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
 * Step states for the setup wizard
 */
type SapAiCoreStep = "client_id" | "client_secret" | "base_url" | "token_url" | "options"

/**
 * SAP AI Core Setup wizard component
 * Guides user through entering credentials and configuration options
 */
export const SapAiCoreSetup: React.FC<SapAiCoreSetupProps> = ({ isActive, onComplete, onCancel }) => {
	// Current step in the wizard
	const [step, setStep] = useState<SapAiCoreStep>("client_id")

	// Credential state
	const [clientId, setClientId] = useState("")
	const [clientSecret, setClientSecret] = useState("")
	const [baseUrl, setBaseUrl] = useState("")
	const [tokenUrl, setTokenUrl] = useState("")

	// Options state
	const [resourceGroup, setResourceGroup] = useState("")
	const [useOrchestrationMode, setUseOrchestrationMode] = useState(true) // Default: ON

	// TODO: Implement step rendering in subsequent commits

	return (
		<Box flexDirection="column">
			<Text color="white">SAP AI Core Setup</Text>
			<Text> </Text>
			<Text color="gray">Current step: {step}</Text>
			<Text> </Text>
			<Text color="gray">Esc to go back</Text>
		</Box>
	)
}
