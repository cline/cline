/**
 * SAP AI Core Setup component
 * Multi-step wizard for configuring SAP AI Core provider credentials
 */

import { Box, Text, useInput } from "ink"
// biome-ignore lint/style/useImportType: React is used as a value by JSX (jsx: "react" in tsconfig)
import React, { useCallback, useState } from "react"
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
 * Step states for the setup wizard
 */
type SapAiCoreStep = "client_id" | "client_secret" | "base_url" | "token_url" | "options"

/**
 * Inline text input for credential fields
 * Similar to BedrockSetup's CredentialInput
 */
const CredentialInput: React.FC<{
	label: string
	value: string
	onChange: (value: string) => void
	onSubmit: () => void
	onCancel: () => void
	isActive: boolean
	isPassword?: boolean
	placeholder?: string
	hint?: string
}> = ({ label, value, onChange, onSubmit, onCancel, isActive, isPassword, placeholder, hint }) => {
	const { isRawModeSupported } = useStdinContext()

	useInput(
		(input, key) => {
			if (isMouseEscapeSequence(input)) return
			if (key.escape) {
				onCancel()
			} else if (key.return) {
				onSubmit()
			} else if (key.backspace || key.delete) {
				onChange(value.slice(0, -1))
			} else if (input && !key.ctrl && !key.meta) {
				onChange(value + input)
			}
		},
		{ isActive: isActive && isRawModeSupported },
	)

	const displayValue = isPassword && value ? "•".repeat(value.length) : value

	// Combine hint and placeholder into description shown above input
	const description = hint || (placeholder ? `e.g. ${placeholder}` : undefined)

	return (
		<Box flexDirection="column">
			<Text color="white">{label}</Text>
			{description && <Text color="gray">{description}</Text>}
			<Text> </Text>
			<Box>
				<Text color="white">{displayValue}</Text>
				<Text inverse> </Text>
			</Box>
			<Text> </Text>
			<Text color="gray">Enter to continue, Esc to go back</Text>
		</Box>
	)
}

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

	/**
	 * Navigate back to the previous step
	 */
	const goBack = useCallback(() => {
		switch (step) {
			case "client_id":
				onCancel()
				break
			case "client_secret":
				setStep("client_id")
				break
			case "base_url":
				setStep("client_secret")
				break
			case "token_url":
				setStep("base_url")
				break
			case "options":
				setStep("token_url")
				break
		}
	}, [step, onCancel])

	// Render Client ID step
	if (step === "client_id") {
		return (
			<CredentialInput
				hint="OAuth Client ID from your SAP AI Core service key"
				isActive={isActive}
				isPassword={false}
				label="SAP AI Core Client ID"
				onCancel={goBack}
				onChange={setClientId}
				onSubmit={() => {
					if (clientId.trim()) setStep("client_secret")
				}}
				placeholder="sb-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx!bxxxxx|aicore!bxxxxx"
				value={clientId}
			/>
		)
	}

	// Render Client Secret step
	if (step === "client_secret") {
		return (
			<CredentialInput
				hint="OAuth Client Secret from your SAP AI Core service key"
				isActive={isActive}
				isPassword={true}
				label="SAP AI Core Client Secret"
				onCancel={goBack}
				onChange={setClientSecret}
				onSubmit={() => {
					if (clientSecret.trim()) setStep("base_url")
				}}
				placeholder="Enter client secret..."
				value={clientSecret}
			/>
		)
	}

	// Render Base URL step
	if (step === "base_url") {
		return (
			<CredentialInput
				hint="API endpoint URL from your SAP AI Core service key (serviceurls.AI_API_URL)"
				isActive={isActive}
				isPassword={false}
				label="SAP AI Core Base URL"
				onCancel={goBack}
				onChange={setBaseUrl}
				onSubmit={() => {
					if (baseUrl.trim()) setStep("token_url")
				}}
				placeholder="https://api.ai.prod.eu-central-1.aws.ml.hana.ondemand.com/v2"
				value={baseUrl}
			/>
		)
	}

	// Render Token URL step
	if (step === "token_url") {
		return (
			<CredentialInput
				hint="OAuth token endpoint URL from your SAP AI Core service key (url + /oauth/token)"
				isActive={isActive}
				isPassword={false}
				label="OAuth Token URL"
				onCancel={goBack}
				onChange={setTokenUrl}
				onSubmit={() => {
					if (tokenUrl.trim()) setStep("options")
				}}
				placeholder="https://xxx.authentication.eu10.hana.ondemand.com/oauth/token"
				value={tokenUrl}
			/>
		)
	}

	// TODO: Implement options step in Commit 4

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
