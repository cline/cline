/**
 * Auth view component
 * Handles interactive authentication and provider configuration
 */

import { Box, Text, useApp, useInput } from "ink"
import React, { useCallback, useEffect, useMemo, useState } from "react"
import { StateManager } from "@/core/storage/StateManager"
import { AuthService } from "@/services/auth/AuthService"
import { API_PROVIDERS_LIST } from "@/shared/api"
import { LoadingSpinner } from "./Spinner"

type AuthStep = "menu" | "provider" | "apikey" | "modelid" | "baseurl" | "saving" | "success" | "error" | "cline_auth"

interface AuthViewProps {
	controller: any
	onComplete?: () => void
	onError?: () => void
	// Quick setup options
	quickSetup?: {
		provider?: string
		apikey?: string
		modelid?: string
		baseurl?: string
	}
}

interface SelectItem {
	label: string
	value: string
}

/**
 * Format separator
 */
function formatSeparator(char: string = "─", width: number = 60): string {
	return char.repeat(Math.max(width, 10))
}

/**
 * Capitalize provider name for display
 */
function capitalize(str: string): string {
	return str
		.split("-")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ")
}

/**
 * Select component with keyboard navigation
 */
const Select: React.FC<{
	items: SelectItem[]
	onSelect: (value: string) => void
	label?: string
}> = ({ items, onSelect, label }) => {
	const [selectedIndex, setSelectedIndex] = useState(0)

	useInput((input, key) => {
		if (key.upArrow) {
			setSelectedIndex((prev) => (prev > 0 ? prev - 1 : items.length - 1))
		} else if (key.downArrow) {
			setSelectedIndex((prev) => (prev < items.length - 1 ? prev + 1 : 0))
		} else if (key.return) {
			onSelect(items[selectedIndex].value)
		}
	})

	return (
		<Box flexDirection="column">
			{label && (
				<Text bold color="cyan">
					{label}
				</Text>
			)}
			{items.map((item, index) => (
				<Box key={item.value}>
					<Text color={index === selectedIndex ? "green" : undefined}>
						{index === selectedIndex ? "❯ " : "  "}
						{item.label}
					</Text>
				</Box>
			))}
			<Text color="gray" dimColor>
				(Use arrow keys to navigate, Enter to select)
			</Text>
		</Box>
	)
}

/**
 * Text input component
 */
const TextInput: React.FC<{
	value: string
	onChange: (value: string) => void
	onSubmit: (value: string) => void
	label: string
	placeholder?: string
	isPassword?: boolean
}> = ({ value, onChange, onSubmit, label, placeholder, isPassword }) => {
	useInput((input, key) => {
		if (key.return) {
			onSubmit(value)
		} else if (key.backspace || key.delete) {
			onChange(value.slice(0, -1))
		} else if (input && !key.ctrl && !key.meta) {
			onChange(value + input)
		}
	})

	const displayValue = isPassword ? "•".repeat(value.length) : value

	return (
		<Box flexDirection="column">
			<Text bold color="cyan">
				{label}
			</Text>
			<Box>
				<Text color="white">{displayValue || placeholder || ""}</Text>
				<Text color="gray">▌</Text>
			</Box>
			<Text color="gray" dimColor>
				(Type your input and press Enter{value ? "" : ", or press Enter to skip"})
			</Text>
		</Box>
	)
}

export const AuthView: React.FC<AuthViewProps> = ({ controller, onComplete, onError, quickSetup }) => {
	const { exit } = useApp()
	const [step, setStep] = useState<AuthStep>(quickSetup ? "saving" : "menu")
	const [selectedProvider, setSelectedProvider] = useState<string>("")
	const [apiKey, setApiKey] = useState("")
	const [modelId, setModelId] = useState("")
	const [baseUrl, setBaseUrl] = useState("")
	const [errorMessage, setErrorMessage] = useState("")
	const [authStatus, setAuthStatus] = useState<string>("")

	// Sort providers alphabetically
	const sortedProviders = useMemo(() => API_PROVIDERS_LIST.slice().sort(), [])

	// Mapping from provider to their API key field name
	const providerToApiKeyField: Record<string, string | string[]> = useMemo(
		() => ({
			anthropic: "apiKey",
			openrouter: "openRouterApiKey",
			bedrock: ["awsAccessKey", "awsBedrockApiKey"],
			openai: "openAiApiKey",
			gemini: "geminiApiKey",
			"openai-native": "openAiNativeApiKey",
			ollama: "ollamaApiKey",
			requesty: "requestyApiKey",
			together: "togetherApiKey",
			deepseek: "deepSeekApiKey",
			qwen: "qwenApiKey",
			"qwen-code": "qwenApiKey",
			doubao: "doubaoApiKey",
			mistral: "mistralApiKey",
			litellm: "liteLlmApiKey",
			moonshot: "moonshotApiKey",
			nebius: "nebiusApiKey",
			fireworks: "fireworksApiKey",
			asksage: "asksageApiKey",
			xai: "xaiApiKey",
			sambanova: "sambanovaApiKey",
			cerebras: "cerebrasApiKey",
			groq: "groqApiKey",
			huggingface: "huggingFaceApiKey",
			"huawei-cloud-maas": "huaweiCloudMaasApiKey",
			dify: "difyApiKey",
			baseten: "basetenApiKey",
			"vercel-ai-gateway": "vercelAiGatewayApiKey",
			zai: "zaiApiKey",
			oca: "ocaApiKey",
			aihubmix: "aihubmixApiKey",
			minimax: "minimaxApiKey",
			hicap: "hicapApiKey",
			nousResearch: "nousResearchApiKey",
			sapaicore: ["sapAiCoreClientId", "sapAiCoreClientSecret"],
			cline: "clineAccountId",
		}),
		[],
	)

	// Get configured providers (those with API keys set)
	const configuredProviders = useMemo(() => {
		try {
			const config = StateManager.get().getApiConfiguration()
			const configured = new Set<string>()

			for (const provider of sortedProviders) {
				const keyField = providerToApiKeyField[provider]
				if (!keyField) {
					continue
				}

				const fields = Array.isArray(keyField) ? keyField : [keyField]
				const hasKey = fields.some((field) => {
					const value = (config as Record<string, unknown>)[field]
					return value !== undefined && value !== null && value !== ""
				})

				if (hasKey) {
					configured.add(provider)
				}
			}

			return configured
		} catch {
			return new Set<string>()
		}
	}, [sortedProviders, providerToApiKeyField])

	// Main menu items
	const mainMenuItems: SelectItem[] = [
		{ label: "Sign in to Cline", value: "cline_auth" },
		{ label: "Configure BYO API provider", value: "configure_byo" },
		{ label: "Exit", value: "exit" },
	]

	// Provider menu items
	const providerItems: SelectItem[] = useMemo(
		() =>
			sortedProviders.map((p: string) => ({
				label: `${capitalize(p)}${configuredProviders.has(p) ? " (configured)" : ""}`,
				value: p,
			})),
		[sortedProviders, configuredProviders],
	)

	// Handle quick setup
	useEffect(() => {
		if (quickSetup && step === "saving") {
			handleQuickSetup()
		}
	}, [quickSetup, step])

	// Subscribe to auth status updates when in cline_auth step
	useEffect(() => {
		if (step !== "cline_auth") {
			return
		}

		let cancelled = false

		// Create a streaming response handler that receives auth state updates
		const responseHandler = async (authState: { user?: { email?: string } }, _isLast?: boolean) => {
			if (cancelled) {
				return
			}

			if (authState.user && authState.user.email) {
				// Auth succeeded - transition to success
				setSelectedProvider("cline")
				setModelId("anthropic/claude-sonnet-4.5")
				setStep("success")
			}
		}

		// Subscribe to auth status updates
		const authService = AuthService.getInstance(controller)
		authService.subscribeToAuthStatusUpdate(controller, {}, responseHandler, `cli-auth-${Date.now()}`)

		return () => {
			cancelled = true
		}
	}, [step, controller])

	const handleQuickSetup = async () => {
		if (!quickSetup) {
			return
		}

		try {
			const { provider, apikey, modelid, baseurl } = quickSetup

			// Validate required parameters
			if (!provider || !apikey || !modelid) {
				setErrorMessage("Quick setup requires --provider, --apikey, and --modelid flags")
				setStep("error")
				return
			}

			const normalizedProvider = provider.toLowerCase().trim()

			if (!sortedProviders.includes(normalizedProvider)) {
				setErrorMessage(`Invalid provider '${provider}'. Supported providers: ${sortedProviders.join(", ")}`)
				setStep("error")
				return
			}

			if (normalizedProvider === "bedrock") {
				setErrorMessage(
					"Bedrock provider is not supported for quick setup due to complex authentication requirements. Please use interactive setup.",
				)
				setStep("error")
				return
			}

			if (baseurl && !["openai", "openai-native"].includes(normalizedProvider)) {
				setErrorMessage("Base URL is only supported for OpenAI and OpenAI-compatible providers")
				setStep("error")
				return
			}

			// Save configuration
			const stateManager = StateManager.get()
			const config: Record<string, string> = {
				actModeApiProvider: normalizedProvider,
				planModeApiProvider: normalizedProvider,
				actModeApiModelId: modelid,
				planModeApiModelId: modelid,
				apiKey: apikey,
			}

			if (baseurl) {
				config.openAiBaseUrl = baseurl
			}

			stateManager.setApiConfiguration(config)

			setSelectedProvider(normalizedProvider)
			setModelId(modelid)
			setBaseUrl(baseurl || "")
			setStep("success")
		} catch (error) {
			setErrorMessage(error instanceof Error ? error.message : String(error))
			setStep("error")
		}
	}

	const handleMainMenuSelect = useCallback(
		(value: string) => {
			if (value === "exit") {
				exit()
				onComplete?.()
			} else if (value === "cline_auth") {
				setStep("cline_auth")
				setAuthStatus("Starting authentication...")
				AuthService.getInstance(controller).createAuthRequest()
			} else if (value === "configure_byo") {
				setStep("provider")
			}
		},
		[exit, onComplete, controller],
	)

	const handleProviderSelect = useCallback(
		(value: string) => {
			setSelectedProvider(value)
			if (value === "cline") {
				setStep("cline_auth")
				setAuthStatus("Starting authentication...")
				AuthService.getInstance(controller).createAuthRequest()
			} else {
				setStep("apikey")
			}
		},
		[controller],
	)

	const handleApiKeySubmit = useCallback((value: string) => {
		setApiKey(value)
		setStep("modelid")
	}, [])

	const handleModelIdSubmit = useCallback(
		(value: string) => {
			if (!value.trim()) {
				// Don't allow empty model ID
				return
			}
			setModelId(value)
			// Only show baseurl step for OpenAI-like providers
			if (["openai", "openai-native"].includes(selectedProvider)) {
				setStep("baseurl")
			} else {
				setStep("saving")
				saveConfiguration(value, "")
			}
		},
		[selectedProvider],
	)

	const handleBaseUrlSubmit = useCallback(
		(value: string) => {
			setBaseUrl(value)
			setStep("saving")
			saveConfiguration(modelId, value)
		},
		[modelId],
	)

	const saveConfiguration = async (model: string, base: string) => {
		try {
			const stateManager = StateManager.get()
			const config: Record<string, string> = {
				actModeApiProvider: selectedProvider,
				planModeApiProvider: selectedProvider,
				actModeApiModelId: model,
				planModeApiModelId: model,
			}

			if (apiKey) {
				config.apiKey = apiKey
			}

			if (base) {
				config.openAiBaseUrl = base
			}

			await stateManager.setApiConfiguration(config)
			setStep("success")
		} catch (error) {
			setErrorMessage(error instanceof Error ? error.message : String(error))
			setStep("error")
		}
	}

	// Handle exit on success/error screens
	useInput(
		(input, key) => {
			if (step === "success" || step === "error") {
				if (key.return || input === "q") {
					if (step === "error") {
						onError?.()
					} else {
						onComplete?.()
					}
					exit()
				}
			}
		},
		{ isActive: step === "success" || step === "error" },
	)

	return (
		<Box flexDirection="column">
			<Text bold color="white">
				🔐 Cline Authentication
			</Text>
			<Text color="gray">{formatSeparator()}</Text>
			<Text> </Text>

			{step === "menu" && (
				<Select items={mainMenuItems} label="What would you like to do?" onSelect={handleMainMenuSelect} />
			)}

			{step === "provider" && <Select items={providerItems} label="Select a provider:" onSelect={handleProviderSelect} />}

			{step === "apikey" && (
				<TextInput
					isPassword={true}
					label="Enter your API key:"
					onChange={setApiKey}
					onSubmit={handleApiKeySubmit}
					value={apiKey}
				/>
			)}

			{step === "modelid" && (
				<TextInput
					label="Enter the model ID (e.g., gpt-4, claude-sonnet-4.5):"
					onChange={setModelId}
					onSubmit={handleModelIdSubmit}
					placeholder="model-id"
					value={modelId}
				/>
			)}

			{step === "baseurl" && (
				<TextInput
					label="Enter base URL (optional, press Enter to skip):"
					onChange={setBaseUrl}
					onSubmit={handleBaseUrlSubmit}
					placeholder="https://api.example.com/v1"
					value={baseUrl}
				/>
			)}

			{step === "saving" && (
				<Box>
					<LoadingSpinner />
					<Text color="cyan"> Saving configuration...</Text>
				</Box>
			)}

			{step === "cline_auth" && (
				<Box flexDirection="column">
					<Box>
						<LoadingSpinner />
						<Text color="cyan"> {authStatus || "Authenticating with Cline..."}</Text>
					</Box>
					<Text color="gray" dimColor>
						A browser window should open. Complete the sign-in process there.
					</Text>
				</Box>
			)}

			{step === "success" && (
				<Box flexDirection="column">
					<Text bold color="green">
						✓ Successfully configured authentication
					</Text>
					<Text color="gray">{formatSeparator()}</Text>
					<Box flexDirection="column" marginLeft={2}>
						<Text>
							<Text color="cyan">Provider:</Text> {capitalize(selectedProvider)}
						</Text>
						<Text>
							<Text color="cyan">Model:</Text> {modelId}
						</Text>
						{baseUrl && (
							<Text>
								<Text color="cyan">Base URL:</Text> {baseUrl}
							</Text>
						)}
						<Text>
							<Text color="cyan">API Key:</Text> Configured
						</Text>
					</Box>
					<Text color="gray">{formatSeparator()}</Text>
					<Text color="white">You can now use Cline with this provider.</Text>
					<Text color="white">Run 'cline task "&lt;your prompt&gt;"' to begin a new task.</Text>
					<Text> </Text>
					<Text color="gray" dimColor>
						(Press Enter or q to exit)
					</Text>
				</Box>
			)}

			{step === "error" && (
				<Box flexDirection="column">
					<Text bold color="red">
						✗ Configuration failed
					</Text>
					<Text color="gray">{formatSeparator()}</Text>
					<Text color="red">{errorMessage}</Text>
					<Text> </Text>
					<Text color="gray" dimColor>
						(Press Enter or q to exit)
					</Text>
				</Box>
			)}
		</Box>
	)
}
