/**
 * Auth view component
 * Handles interactive authentication and provider configuration
 */

import { Box, Text, useApp, useInput } from "ink"
import Spinner from "ink-spinner"
import React, { useCallback, useEffect, useMemo, useState } from "react"
import { StateManager } from "@/core/storage/StateManager"
import { openAiCodexOAuthManager } from "@/integrations/openai-codex/oauth"
import { AuthService } from "@/services/auth/AuthService"
import type { ApiProvider } from "@/shared/api"
import { openAiCodexDefaultModelId, openRouterDefaultModelId } from "@/shared/api"
import { getProviderModelIdKey, ProviderToApiKeyMap } from "@/shared/storage"
import { openExternal } from "@/utils/env"
import { COLORS } from "../constants/colors"
import { getAllFeaturedModels } from "../constants/featured-models"
import { useStdinContext } from "../context/StdinContext"
import { useScrollableList } from "../hooks/useScrollableList"
import { type DetectedSources, detectImportSources, type ImportSource } from "../utils/import-configs"
import { isMouseEscapeSequence } from "../utils/input"
import { ApiKeyInput } from "./ApiKeyInput"
import { StaticRobotFrame } from "./AsciiMotionCli"
import { type BedrockConfig, BedrockSetup } from "./BedrockSetup"
import {
	FeaturedModelPicker,
	getFeaturedModelAtIndex,
	getFeaturedModelMaxIndex,
	isBrowseAllSelected,
} from "./FeaturedModelPicker"
import { ImportView } from "./ImportView"
import { getDefaultModelId, hasModelPicker, ModelPicker } from "./ModelPicker"
import { CLI_EXCLUDED_PROVIDERS, getProviderLabel, getProviderOrder } from "./ProviderPicker"

type AuthStep =
	| "menu"
	| "provider"
	| "apikey"
	| "modelid"
	| "baseurl"
	| "saving"
	| "success"
	| "error"
	| "cline_auth"
	| "cline_model"
	| "openai_codex_auth"
	| "bedrock"
	| "import"

// Featured models loaded from shared constants
const featuredModels = getAllFeaturedModels()

interface AuthViewProps {
	controller: any
	onComplete?: () => void
	onError?: () => void
	onNavigateToWelcome?: () => void
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
 * Select component with keyboard navigation
 */
const Select: React.FC<{
	items: SelectItem[]
	onSelect: (value: string) => void
	label?: string
}> = ({ items, onSelect, label }) => {
	const { isRawModeSupported } = useStdinContext()
	const [selectedIndex, setSelectedIndex] = useState(0)

	useInput(
		(input, key) => {
			if (key.upArrow) {
				setSelectedIndex((prev) => (prev > 0 ? prev - 1 : items.length - 1))
			} else if (key.downArrow) {
				setSelectedIndex((prev) => (prev < items.length - 1 ? prev + 1 : 0))
			} else if (key.return) {
				onSelect(items[selectedIndex].value)
			}
		},
		{ isActive: isRawModeSupported },
	)

	return (
		<Box flexDirection="column">
			{label && (
				<Text bold color="cyan">
					{label}
				</Text>
			)}
			{items.map((item, index) => (
				<Box key={item.value}>
					<Text color={index === selectedIndex ? COLORS.primaryBlue : undefined}>
						{index === selectedIndex ? "❯ " : "  "}
						{item.label}
					</Text>
				</Box>
			))}
			<Text color="gray">(Use arrow keys to navigate, Enter to select)</Text>
		</Box>
	)
}

/**
 * Text input component - minimal, just the input field
 */
const TextInput: React.FC<{
	value: string
	onChange: (value: string) => void
	onSubmit: (value: string) => void
	placeholder?: string
	isPassword?: boolean
}> = ({ value, onChange, onSubmit, placeholder, isPassword }) => {
	const { isRawModeSupported } = useStdinContext()

	useInput(
		(input, key) => {
			// Filter out mouse escape sequences
			if (isMouseEscapeSequence(input)) {
				return
			}

			if (key.return) {
				onSubmit(value)
			} else if (key.backspace || key.delete) {
				onChange(value.slice(0, -1))
			} else if (input && !key.ctrl && !key.meta) {
				onChange(value + input)
			}
		},
		{ isActive: isRawModeSupported },
	)

	const displayValue = isPassword ? "•".repeat(value.length) : value

	return (
		<Box>
			<Text color="white">{displayValue || placeholder || ""}</Text>
			<Text inverse> </Text>
		</Box>
	)
}

export const AuthView: React.FC<AuthViewProps> = ({ controller, onComplete, onError, onNavigateToWelcome, quickSetup }) => {
	const { exit } = useApp()
	const [step, setStep] = useState<AuthStep>(quickSetup ? "saving" : "menu")
	const [selectedProvider, setSelectedProvider] = useState<string>(
		StateManager.get().getApiConfiguration().actModeApiProvider ||
			StateManager.get().getApiConfiguration().planModeApiProvider ||
			"",
	)
	const [apiKey, setApiKey] = useState("")
	const [modelId, setModelId] = useState("")
	const [baseUrl, setBaseUrl] = useState("")
	const [errorMessage, setErrorMessage] = useState("")
	const [authStatus, setAuthStatus] = useState<string>("")
	const [providerSearch, setProviderSearch] = useState("")
	const [providerIndex, setProviderIndex] = useState(0)
	const [clineModelIndex, setClineModelIndex] = useState(0)
	const [importSources, setImportSources] = useState<DetectedSources>({ codex: false, opencode: false })
	const [importSource, setImportSource] = useState<ImportSource | null>(null)
	const [bedrockConfig, setBedrockConfig] = useState<BedrockConfig | null>(null)

	// Use providers.json order, filtered to exclude CLI-incompatible providers
	const sortedProviders = useMemo(() => {
		return getProviderOrder().filter((p) => !CLI_EXCLUDED_PROVIDERS.has(p))
	}, [])

	// Main menu items - conditionally include import options
	const mainMenuItems: SelectItem[] = useMemo(() => {
		const items: SelectItem[] = [{ label: "Sign in with Cline", value: "cline_auth" }]

		// Add OpenAI Codex option for ChatGPT subscribers
		items.push({ label: "Sign in with ChatGPT Subscription", value: "openai_codex_auth" })

		// Add import options if detected
		if (importSources.codex) {
			items.push({ label: "Import from Codex CLI", value: "import_codex" })
		}
		if (importSources.opencode) {
			items.push({ label: "Import from OpenCode", value: "import_opencode" })
		}

		items.push({ label: "Use your own API key", value: "configure_byo" })
		items.push({ label: "Exit", value: "exit" })

		return items
	}, [importSources])

	// Provider menu items - filtered by search (searches both ID and display name)
	const providerItems: SelectItem[] = useMemo(() => {
		const search = providerSearch.toLowerCase()
		const filtered = providerSearch
			? sortedProviders.filter(
					(p) => p.toLowerCase().includes(search) || getProviderLabel(p).toLowerCase().includes(search),
				)
			: sortedProviders
		return filtered.map((p: string) => ({
			label: getProviderLabel(p),
			value: p,
		}))
	}, [sortedProviders, providerSearch])

	// Use shared scrollable list hook for provider windowing
	const TOTAL_PROVIDER_ROWS = 8
	const {
		visibleStart: providerVisibleStart,
		visibleCount: providerVisibleCount,
		showTopIndicator: showProviderTopIndicator,
		showBottomIndicator: showProviderBottomIndicator,
	} = useScrollableList(providerItems.length, providerIndex, TOTAL_PROVIDER_ROWS)

	const visibleProviderItems = useMemo(() => {
		return providerItems.slice(providerVisibleStart, providerVisibleStart + providerVisibleCount)
	}, [providerItems, providerVisibleStart, providerVisibleCount])

	// Detect import sources on mount
	useEffect(() => {
		setImportSources(detectImportSources())
	}, [])

	// Reset provider index when search changes
	useEffect(() => {
		setProviderIndex(0)
	}, [providerSearch])

	// Set default model when entering model step
	useEffect(() => {
		if (step === "modelid" && hasModelPicker(selectedProvider)) {
			setModelId(getDefaultModelId(selectedProvider))
		}
	}, [step, selectedProvider])

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
				// Auth succeeded - save configuration and transition to success
				const stateManager = StateManager.get()
				const mode = stateManager.getGlobalSettingsKey("mode") || "act"
				const providerKey = mode === "act" ? "actModeApiProvider" : "planModeApiProvider"
				// Use provider-specific model ID key (cline uses OpenRouterModelId)
				const modelIdKey = getProviderModelIdKey("cline" as ApiProvider, mode as "act" | "plan")
				const config: Record<string, string> = {
					actModeApiProvider: "cline",
					[providerKey]: "cline",
				}
				if (modelIdKey) {
					config[modelIdKey] = openRouterDefaultModelId
				}
				stateManager.setApiConfiguration(config)
				stateManager.flushPendingState()

				setSelectedProvider("cline")
				setModelId(openRouterDefaultModelId)
				setStep("cline_model")
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
			// Use provider-specific model ID keys (e.g., cline uses actModeOpenRouterModelId)
			const actModelKey = getProviderModelIdKey(normalizedProvider as ApiProvider, "act")
			const planModelKey = getProviderModelIdKey(normalizedProvider as ApiProvider, "plan")
			const config: Record<string, string> = {
				actModeApiProvider: normalizedProvider,
				planModeApiProvider: normalizedProvider,
			}
			if (actModelKey) config[actModelKey] = modelid
			if (planModelKey) config[planModelKey] = modelid

			// Use provider-specific API key field
			const keyField = ProviderToApiKeyMap[normalizedProvider]
			if (keyField) {
				const fields = Array.isArray(keyField) ? keyField : [keyField]
				// Set the first key field for the provider
				config[fields[0]] = apikey
			} else {
				// Fallback to generic apiKey
				config.apiKey = apikey
			}

			if (baseurl) {
				config.openAiBaseUrl = baseurl
			}

			stateManager.setApiConfiguration(config)
			stateManager.setGlobalState("welcomeViewCompleted", true)

			await stateManager.flushPendingState()
			setSelectedProvider(normalizedProvider)
			setModelId(modelid)
			setBaseUrl(baseurl || "")
			setStep("success")
		} catch (error) {
			setErrorMessage(error instanceof Error ? error.message : String(error))
			setStep("error")
		}
	}

	// Start OpenAI Codex OAuth flow
	const startOpenAiCodexAuth = useCallback(async () => {
		try {
			// Get the authorization URL and start the callback server
			const authUrl = openAiCodexOAuthManager.startAuthorizationFlow()

			// Open browser to authorization URL (uses cross-platform 'open' package)
			await openExternal(authUrl)

			// Wait for the callback
			await openAiCodexOAuthManager.waitForCallback()

			// Success - save configuration
			const stateManager = StateManager.get()
			const mode = stateManager.getGlobalSettingsKey("mode") || "act"
			const providerKey = mode === "act" ? "actModeApiProvider" : "planModeApiProvider"
			// Use provider-specific model ID key (openai-codex uses generic apiModelId)
			const modelIdKey = getProviderModelIdKey("openai-codex" as ApiProvider, mode as "act" | "plan")
			const config: Record<string, string> = {
				actModeApiProvider: "openai-codex",
				planModeApiProvider: "openai-codex",
				[providerKey]: "openai-codex",
			}
			if (modelIdKey) {
				config[modelIdKey] = openAiCodexDefaultModelId
			}
			stateManager.setApiConfiguration(config)
			stateManager.setGlobalState("welcomeViewCompleted", true)
			await stateManager.flushPendingState()

			setSelectedProvider("openai-codex")
			setModelId(openAiCodexDefaultModelId)
			setStep("success")
		} catch (error) {
			openAiCodexOAuthManager.cancelAuthorizationFlow()
			setErrorMessage(error instanceof Error ? error.message : String(error))
			setStep("error")
		}
	}, [])

	// Start Cline auth flow
	const startClineAuth = useCallback(async () => {
		try {
			setStep("cline_auth")
			setAuthStatus("Starting authentication...")
			await AuthService.getInstance(controller).createAuthRequest()
		} catch (error) {
			setErrorMessage(error instanceof Error ? error.message : String(error))
			setStep("error")
		}
	}, [controller])

	const handleMainMenuSelect = useCallback(
		(value: string) => {
			if (value === "exit") {
				exit()
				onComplete?.()
			} else if (value === "cline_auth") {
				startClineAuth()
			} else if (value === "openai_codex_auth") {
				setStep("openai_codex_auth")
				startOpenAiCodexAuth()
			} else if (value === "configure_byo") {
				setStep("provider")
			} else if (value === "import_codex") {
				setImportSource("codex")
				setStep("import")
			} else if (value === "import_opencode") {
				setImportSource("opencode")
				setStep("import")
			}
		},
		[exit, onComplete, startClineAuth, startOpenAiCodexAuth],
	)

	const handleProviderSelect = useCallback(
		(value: string) => {
			setSelectedProvider(value)
			if (value === "cline") {
				startClineAuth()
			} else if (value === "openai-codex") {
				setStep("openai_codex_auth")
				startOpenAiCodexAuth()
			} else if (value === "bedrock") {
				setStep("bedrock")
			} else {
				setStep("apikey")
			}
		},
		[startClineAuth, startOpenAiCodexAuth],
	)

	const handleApiKeySubmit = useCallback(
		(value: string) => {
			if (!value.trim() || !selectedProvider) {
				// Don't allow empty
				return
			}

			// Store in local state - will be saved via StateManager in saveConfiguration
			setApiKey(value)
			setStep("modelid")
		},
		[selectedProvider],
	)

	const saveConfiguration = useCallback(
		async (model: string, base: string) => {
			try {
				const stateManager = StateManager.get()
				// Use provider-specific model ID keys (e.g., cline uses actModeOpenRouterModelId)
				const actModelKey = getProviderModelIdKey(selectedProvider as ApiProvider, "act")
				const planModelKey = getProviderModelIdKey(selectedProvider as ApiProvider, "plan")
				const config: Record<string, string> = {
					actModeApiProvider: selectedProvider,
					planModeApiProvider: selectedProvider,
					apiProvider: selectedProvider,
				}
				if (actModelKey) config[actModelKey] = model
				if (planModelKey) config[planModelKey] = model

				// For cline/openrouter, also set model info (required for getModel() to return correct model)
				if (selectedProvider === "cline" || selectedProvider === "openrouter") {
					const openRouterModels = await controller?.readOpenRouterModels()
					const modelInfo = openRouterModels?.[model]
					if (modelInfo) {
						stateManager.setGlobalState("actModeOpenRouterModelInfo", modelInfo)
						stateManager.setGlobalState("planModeOpenRouterModelInfo", modelInfo)
					}
				}

				// Add API key or Bedrock-specific config
				if (selectedProvider === "bedrock" && bedrockConfig) {
					const bedrockFields: Record<string, unknown> = {
						awsAuthentication: bedrockConfig.awsAuthentication,
						awsRegion: bedrockConfig.awsRegion,
						awsUseCrossRegionInference: bedrockConfig.awsUseCrossRegionInference,
					}
					if (bedrockConfig.awsProfile !== undefined) bedrockFields.awsProfile = bedrockConfig.awsProfile
					if (bedrockConfig.awsAccessKey) bedrockFields.awsAccessKey = bedrockConfig.awsAccessKey
					if (bedrockConfig.awsSecretKey) bedrockFields.awsSecretKey = bedrockConfig.awsSecretKey
					if (bedrockConfig.awsSessionToken) bedrockFields.awsSessionToken = bedrockConfig.awsSessionToken
					Object.assign(config, bedrockFields)
				} else if (apiKey) {
					const keyField = ProviderToApiKeyMap[selectedProvider as keyof typeof ProviderToApiKeyMap]
					if (keyField) {
						const fields = Array.isArray(keyField) ? keyField : [keyField]
						config[fields[0]] = apiKey
					}
				}

				if (base) {
					config.openAiBaseUrl = base
				}
				stateManager.setApiConfiguration(config)
				stateManager.setGlobalState("welcomeViewCompleted", true)
				await stateManager.flushPendingState()

				setStep("success")
			} catch (error) {
				setErrorMessage(error instanceof Error ? error.message : String(error))
				setStep("error")
			}
		},
		[selectedProvider, apiKey, bedrockConfig, controller],
	)

	const handleModelIdSubmit = useCallback(
		(value: string) => {
			if (value.trim()) {
				setModelId(value)
			}
			// Only show baseurl step for OpenAI-like providers
			if (["openai", "openai-native"].includes(selectedProvider)) {
				setStep("baseurl")
			} else {
				setStep("saving")
				saveConfiguration(value, "")
			}
		},
		[selectedProvider, saveConfiguration],
	)

	const handleBaseUrlSubmit = useCallback(
		(value: string) => {
			setBaseUrl(value)
			setStep("saving")
			saveConfiguration(modelId, value)
		},
		[modelId, saveConfiguration],
	)

	const handleClineModelSelect = useCallback(
		(modelId: string) => {
			setModelId(modelId)
			setStep("saving")
			saveConfiguration(modelId, "")
		},
		[saveConfiguration],
	)

	const handleBedrockComplete = useCallback((config: BedrockConfig) => {
		setBedrockConfig(config)
		setStep("modelid")
	}, [])

	const handleImportComplete = useCallback(() => {
		setStep("success")
	}, [])

	const handleImportCancel = useCallback(() => {
		setImportSource(null)
		setStep("menu")
	}, [])

	// Auto-navigate to welcome after success (immediate)
	useEffect(() => {
		if (step === "success" && onNavigateToWelcome) {
			onNavigateToWelcome()
		}
	}, [step, onNavigateToWelcome])

	// Error screen menu items
	const errorMenuItems: SelectItem[] = useMemo(() => {
		const items: SelectItem[] = [{ label: "Try again", value: "retry" }]
		if (onNavigateToWelcome) {
			items.push({ label: "Start a task", value: "welcome" })
		}
		items.push({ label: "Exit", value: "exit" })
		return items
	}, [onNavigateToWelcome])

	const handleErrorMenuSelect = useCallback(
		(value: string) => {
			if (value === "retry") {
				// Reset state and go back to menu
				setErrorMessage("")
				setApiKey("")
				setModelId("")
				setBaseUrl("")
				setSelectedProvider("")
				setStep("menu")
			} else if (value === "welcome") {
				onNavigateToWelcome?.()
			} else if (value === "exit") {
				onError?.()
				exit()
			}
		},
		[onNavigateToWelcome, onError, exit],
	)

	// Handle going back to previous step
	const goBack = useCallback(() => {
		switch (step) {
			case "provider":
				setProviderSearch("")
				setProviderIndex(0)
				setStep("menu")
				break
			case "apikey":
				setApiKey("")
				setStep("provider")
				break
			case "modelid":
				setModelId("")
				// Go back to cline_model if we came from there (Cline provider)
				if (selectedProvider === "cline") {
					setStep("cline_model")
				} else {
					setStep("apikey")
				}
				break
			case "baseurl":
				setBaseUrl("")
				setStep("modelid")
				break
			case "cline_auth":
				setStep("menu")
				break
			case "openai_codex_auth":
				openAiCodexOAuthManager.cancelAuthorizationFlow()
				setStep("menu")
				break
			case "cline_model":
				setClineModelIndex(0)
				setStep("menu")
				break
			case "bedrock":
				setBedrockConfig(null)
				setStep("provider")
				break
			case "import":
				setImportSource(null)
				setStep("menu")
				break
			case "error":
				setErrorMessage("")
				setStep("menu")
				break
			// menu, saving, success - no back action
		}
	}, [step, selectedProvider])

	// Render the auth box content based on current step
	// Note: "menu" step is rendered separately in the main return for proper menuIndex tracking
	const renderAuthContent = () => {
		switch (step) {
			case "provider": {
				return (
					<Box flexDirection="column">
						<Text color="white">Select a provider</Text>
						<Text> </Text>
						<Box>
							<Text color="gray">Search: </Text>
							<Text color="white">{providerSearch}</Text>
							<Text inverse> </Text>
						</Box>
						<Text> </Text>
						{showProviderTopIndicator && <Text color="gray">... {providerVisibleStart} more above</Text>}
						{visibleProviderItems.map((item, i) => {
							const actualIndex = providerVisibleStart + i
							return (
								<Box key={item.value}>
									<Text color={actualIndex === providerIndex ? COLORS.primaryBlue : undefined}>
										{actualIndex === providerIndex ? "❯ " : "  "}
										{item.label}
									</Text>
								</Box>
							)
						})}
						{showProviderBottomIndicator && (
							<Text color="gray">
								... {providerItems.length - providerVisibleStart - providerVisibleCount} more below
							</Text>
						)}
						{providerItems.length === 0 && <Text color="gray">No providers match "{providerSearch}"</Text>}
						<Text> </Text>
						<Text color="gray">Type to search, arrows to navigate, Enter to select, Esc to go back</Text>
					</Box>
				)
			}

			case "apikey":
				return (
					<ApiKeyInput
						isActive={step === "apikey"}
						onCancel={goBack}
						onChange={setApiKey}
						onSubmit={handleApiKeySubmit}
						providerName={getProviderLabel(selectedProvider)}
						value={apiKey}
					/>
				)

			case "modelid":
				// Show model picker for providers with static model lists
				if (hasModelPicker(selectedProvider)) {
					return (
						<Box flexDirection="column">
							<Text color="white">Select a model</Text>
							<Text> </Text>
							<ModelPicker
								controller={controller}
								isActive={step === "modelid"}
								onChange={setModelId}
								onSubmit={handleModelIdSubmit}
								provider={selectedProvider}
							/>
							<Text> </Text>
							<Text color="gray">Type to search, arrows to navigate, Enter to select, Esc to go back</Text>
						</Box>
					)
				}
				// Fall back to text input for providers without static model lists
				return (
					<Box flexDirection="column">
						<Text color="white">Model ID</Text>
						<Text> </Text>
						<Text color="gray">e.g., claude-sonnet-4-20250514, gpt-4o</Text>
						<Text> </Text>
						<TextInput onChange={setModelId} onSubmit={handleModelIdSubmit} placeholder="model-id" value={modelId} />
						<Text> </Text>
						<Text color="gray">Enter to continue, Esc to go back</Text>
					</Box>
				)

			case "baseurl":
				return (
					<Box flexDirection="column">
						<Text color="white">Base URL (optional)</Text>
						<Text> </Text>
						<Text color="gray">For self-hosted or proxy endpoints</Text>
						<Text> </Text>
						<TextInput
							onChange={setBaseUrl}
							onSubmit={handleBaseUrlSubmit}
							placeholder="https://api.example.com/v1"
							value={baseUrl}
						/>
						<Text> </Text>
						<Text color="gray">Enter to skip or continue, Esc to go back</Text>
					</Box>
				)

			case "saving":
				return (
					<Box>
						<Text color={COLORS.primaryBlue}>
							<Spinner type="dots" />
						</Text>
						<Text color="white"> Saving configuration...</Text>
					</Box>
				)

			case "cline_auth":
				return (
					<Box flexDirection="column">
						<Box>
							<Text color={COLORS.primaryBlue}>
								<Spinner type="dots" />
							</Text>
							<Text color="white"> Waiting for browser sign-in...</Text>
						</Box>
						<Text> </Text>
						<Text color="gray">Complete sign-in in your browser, then return here.</Text>
						<Text> </Text>
						<Text color="gray">Esc to cancel</Text>
					</Box>
				)

			case "openai_codex_auth":
				return (
					<Box flexDirection="column">
						<Box>
							<Text color={COLORS.primaryBlue}>
								<Spinner type="dots" />
							</Text>
							<Text color="white"> Waiting for ChatGPT sign-in...</Text>
						</Box>
						<Text> </Text>
						<Text color="gray">Sign in with your ChatGPT account in the browser.</Text>
						<Text color="gray">Requires ChatGPT Plus, Pro, or Team subscription.</Text>
						<Text> </Text>
						<Text color="gray">Esc to cancel</Text>
					</Box>
				)

			case "cline_model": {
				return (
					<Box flexDirection="column">
						<Text color="white">Choose a model</Text>
						<Text> </Text>
						<FeaturedModelPicker selectedIndex={clineModelIndex} />
					</Box>
				)
			}

			case "bedrock":
				return (
					<BedrockSetup
						isActive={step === "bedrock"}
						onCancel={() => {
							setBedrockConfig(null)
							setStep("provider")
						}}
						onComplete={handleBedrockComplete}
					/>
				)

			case "import":
				if (!importSource) {
					return null
				}
				return <ImportView onCancel={handleImportCancel} onComplete={handleImportComplete} source={importSource} />

			case "error":
				return (
					<Box flexDirection="column">
						<Text bold color="red">
							Something went wrong
						</Text>
						<Text> </Text>
						<Text color="yellow">{errorMessage}</Text>
						<Text> </Text>
						<Select items={errorMenuItems} onSelect={handleErrorMenuSelect} />
					</Box>
				)

			default:
				return null
		}
	}

	// For menu step, we need to handle input at the top level
	const { isRawModeSupported } = useStdinContext()
	const [menuIndex, setMenuIndex] = useState(0)

	// Steps that allow going back with escape (apikey handled by ApiKeyInput component)
	const canGoBack = [
		"provider",
		"modelid",
		"baseurl",
		"cline_auth",
		"cline_model",
		"openai_codex_auth",
		"bedrock",
		"error",
	].includes(step)

	useInput(
		(input, key) => {
			// Handle escape to go back (except on menu)
			if (key.escape && canGoBack) {
				goBack()
				return
			}

			if (step === "menu") {
				if (key.upArrow) {
					setMenuIndex((prev) => (prev > 0 ? prev - 1 : mainMenuItems.length - 1))
				} else if (key.downArrow) {
					setMenuIndex((prev) => (prev < mainMenuItems.length - 1 ? prev + 1 : 0))
				} else if (key.return) {
					handleMainMenuSelect(mainMenuItems[menuIndex].value)
				}
			} else if (step === "provider") {
				if (key.upArrow) {
					setProviderIndex((prev) => (prev > 0 ? prev - 1 : providerItems.length - 1))
				} else if (key.downArrow) {
					setProviderIndex((prev) => (prev < providerItems.length - 1 ? prev + 1 : 0))
				} else if (key.return) {
					if (providerItems[providerIndex]) {
						handleProviderSelect(providerItems[providerIndex].value)
					}
				} else if (key.backspace || key.delete) {
					setProviderSearch((prev) => prev.slice(0, -1))
				} else if (input && !key.ctrl && !key.meta) {
					setProviderSearch((prev) => prev + input)
				}
			} else if (step === "cline_model") {
				const maxIndex = getFeaturedModelMaxIndex()

				if (key.upArrow) {
					setClineModelIndex((prev) => (prev > 0 ? prev - 1 : maxIndex))
				} else if (key.downArrow) {
					setClineModelIndex((prev) => (prev < maxIndex ? prev + 1 : 0))
				} else if (key.return) {
					if (isBrowseAllSelected(clineModelIndex)) {
						setStep("modelid")
					} else {
						const selectedModel = getFeaturedModelAtIndex(clineModelIndex)
						if (selectedModel) {
							handleClineModelSelect(selectedModel.id)
						}
					}
				}
			}
			// Note: modelid step input is handled by ModelPicker component
		},
		{ isActive: isRawModeSupported && (step === "menu" || step === "provider" || step === "cline_model" || canGoBack) },
	)

	return (
		<Box flexDirection="column" paddingLeft={1} paddingRight={1} width="100%">
			{/* Cline robot - centered */}
			<StaticRobotFrame />

			{/* Welcome text - centered */}
			<Box justifyContent="center" marginTop={1}>
				<Text bold color="white">
					Welcome to Cline
				</Text>
			</Box>

			{/* Auth box with border */}
			<Box
				borderColor="gray"
				borderStyle="round"
				flexDirection="column"
				marginTop={1}
				paddingBottom={1}
				paddingLeft={2}
				paddingRight={2}
				paddingTop={1}>
				{step === "menu" ? (
					<Box flexDirection="column">
						<Text color="gray">How would you like to get started?</Text>
						<Text> </Text>
						{mainMenuItems.map((item, index) => (
							<Box key={item.value}>
								<Text>
									<Text color={index === menuIndex ? COLORS.primaryBlue : undefined}>
										{index === menuIndex ? "❯ " : "  "}
										{item.label}
									</Text>
									{item.value === "cline_auth" && <Text color="yellow"> (try Kimi K2.5 free!)</Text>}
								</Text>
							</Box>
						))}
						<Text> </Text>
						<Text color="gray">Use arrow keys, Enter to select</Text>
					</Box>
				) : (
					renderAuthContent()
				)}
			</Box>
		</Box>
	)
}
