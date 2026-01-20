/**
 * Auth command - manage API provider authentication
 *
 * Provides interactive and quick-setup authentication modes for the Cline CLI.
 * Supports both interactive menus and command-line flag-based configuration.
 */

import { Command } from "commander"
import * as readline from "readline"
import { disposeEmbeddedController, getEmbeddedController } from "../../core/embedded-controller.js"
import type { OutputFormatter } from "../../core/output/types.js"
import type { CliConfig } from "../../types/config.js"
import type { Logger } from "../../types/logger.js"

/**
 * Mode type for plan/act mode configuration
 */
type Mode = "plan" | "act"

/**
 * List of supported API providers
 * Synced with src/shared/api.ts ApiProvider type
 */
const API_PROVIDERS = [
	"anthropic",
	"openrouter",
	"bedrock",
	"vertex",
	"openai",
	"ollama",
	"lmstudio",
	"gemini",
	"openai-native",
	"requesty",
	"together",
	"deepseek",
	"qwen",
	"qwen-code",
	"doubao",
	"mistral",
	"vscode-lm",
	"cline",
	"litellm",
	"moonshot",
	"nebius",
	"fireworks",
	"asksage",
	"xai",
	"sambanova",
	"cerebras",
	"sapaicore",
	"groq",
	"huggingface",
	"dify",
	"baseten",
	"zai",
] as const

type ApiProvider = (typeof API_PROVIDERS)[number]

/**
 * Provider information for display
 */
interface ProviderInfo {
	id: ApiProvider
	name: string
	description: string
	requiresApiKey: boolean
	keyUrl?: string
}

/**
 * Provider details for interactive selection
 */
const PROVIDER_INFO: ProviderInfo[] = [
	{
		id: "anthropic",
		name: "Anthropic",
		description: "Direct access to Claude models via Anthropic API",
		requiresApiKey: true,
		keyUrl: "https://console.anthropic.com/settings/keys",
	},
	{
		id: "openrouter",
		name: "OpenRouter",
		description: "Access multiple AI providers through a single API",
		requiresApiKey: true,
		keyUrl: "https://openrouter.ai/keys",
	},
	{
		id: "openai",
		name: "OpenAI",
		description: "Access to GPT models via OpenAI API",
		requiresApiKey: true,
		keyUrl: "https://platform.openai.com/api-keys",
	},
	{
		id: "openai-native",
		name: "OpenAI Native",
		description: "OpenAI API with native tool calling support",
		requiresApiKey: true,
		keyUrl: "https://platform.openai.com/api-keys",
	},
	{
		id: "gemini",
		name: "Google Gemini",
		description: "Access to Gemini models via Google AI API",
		requiresApiKey: true,
		keyUrl: "https://aistudio.google.com/app/apikey",
	},
	{
		id: "deepseek",
		name: "DeepSeek",
		description: "Access to DeepSeek reasoning models",
		requiresApiKey: true,
		keyUrl: "https://platform.deepseek.com/api_keys",
	},
	{
		id: "bedrock",
		name: "AWS Bedrock",
		description: "AWS Bedrock with Claude and other models (uses AWS credentials)",
		requiresApiKey: false,
	},
	{
		id: "vertex",
		name: "Google Vertex AI",
		description: "Google Cloud Vertex AI (uses Google Cloud credentials)",
		requiresApiKey: false,
	},
	{
		id: "ollama",
		name: "Ollama",
		description: "Local models via Ollama (no API key required)",
		requiresApiKey: false,
	},
	{
		id: "lmstudio",
		name: "LM Studio",
		description: "Local models via LM Studio (no API key required)",
		requiresApiKey: false,
	},
	{
		id: "groq",
		name: "Groq",
		description: "Fast inference with Groq's LPU technology",
		requiresApiKey: true,
		keyUrl: "https://console.groq.com/keys",
	},
	{
		id: "cerebras",
		name: "Cerebras",
		description: "High-performance inference with Cerebras",
		requiresApiKey: true,
	},
	{
		id: "xai",
		name: "xAI",
		description: "Access to Grok models from xAI",
		requiresApiKey: true,
	},
	{
		id: "mistral",
		name: "Mistral",
		description: "Access to Mistral and Codestral models",
		requiresApiKey: true,
		keyUrl: "https://console.mistral.ai/api-keys",
	},
	{
		id: "together",
		name: "Together AI",
		description: "Access to open-source models via Together AI",
		requiresApiKey: true,
	},
	{
		id: "fireworks",
		name: "Fireworks AI",
		description: "Fast inference for open-source models",
		requiresApiKey: true,
	},
	{
		id: "cline",
		name: "Cline",
		description: "Use Cline's managed API (requires Cline account)",
		requiresApiKey: false,
	},
]

/**
 * Get the model ID state key for a given provider and mode
 * Some providers use provider-specific model ID keys (e.g., openRouterModelId),
 * while others use the generic apiModelId
 */
function getModelIdKey(provider: ApiProvider, mode: Mode): string {
	const modePrefix = mode === "plan" ? "planMode" : "actMode"

	// Providers with custom model ID keys
	switch (provider) {
		case "openrouter":
		case "cline": // Cline provider uses OpenRouter model IDs under the hood
			return `${modePrefix}OpenRouterModelId`
		case "openai":
			return `${modePrefix}OpenAiModelId`
		case "ollama":
			return `${modePrefix}OllamaModelId`
		case "lmstudio":
			return `${modePrefix}LmStudioModelId`
		case "litellm":
			return `${modePrefix}LiteLlmModelId`
		case "requesty":
			return `${modePrefix}RequestyModelId`
		case "together":
			return `${modePrefix}TogetherModelId`
		case "fireworks":
			return `${modePrefix}FireworksModelId`
		case "groq":
			return `${modePrefix}GroqModelId`
		case "baseten":
			return `${modePrefix}BasetenModelId`
		case "huggingface":
			return `${modePrefix}HuggingFaceModelId`
		default:
			// Most providers use the generic apiModelId
			return `${modePrefix}ApiModelId`
	}
}

/**
 * Get the provider state key for a given mode
 */
function getProviderKey(mode: Mode): string {
	return mode === "plan" ? "planModeApiProvider" : "actModeApiProvider"
}

/**
 * Prompt for input from stdin
 */
async function prompt(question: string, hideInput = false): Promise<string> {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	})

	return new Promise((resolve) => {
		if (hideInput) {
			// Disable echo for password-like input
			process.stdout.write(question)
			let input = ""
			process.stdin.setRawMode?.(true)
			process.stdin.resume()
			process.stdin.on("data", (char) => {
				const c = char.toString()
				if (c === "\n" || c === "\r") {
					process.stdin.setRawMode?.(false)
					process.stdout.write("\n")
					rl.close()
					resolve(input)
				} else if (c === "\u0003") {
					// Ctrl+C
					process.exit(0)
				} else if (c === "\u007F") {
					// Backspace
					if (input.length > 0) {
						input = input.slice(0, -1)
					}
				} else {
					input += c
				}
			})
		} else {
			rl.question(question, (answer) => {
				rl.close()
				resolve(answer)
			})
		}
	})
}

/**
 * Mask an API key for display (show first/last 4 chars)
 */
function maskApiKey(key: string): string {
	if (key.length <= 8) {
		return "****"
	}
	return `${key.slice(0, 4)}...${key.slice(-4)}`
}

/**
 * Validate provider ID
 */
function isValidProvider(provider: string): provider is ApiProvider {
	return API_PROVIDERS.includes(provider as ApiProvider)
}

/**
 * Get provider info by ID
 */
function getProviderInfo(id: string): ProviderInfo | undefined {
	return PROVIDER_INFO.find((p) => p.id === id)
}

/**
 * Handle quick setup mode using command-line flags
 */
async function handleQuickSetup(
	config: CliConfig,
	logger: Logger,
	fmt: OutputFormatter,
	options: { provider: string; apikey?: string; modelid: string; baseurl?: string; mode?: string },
): Promise<void> {
	fmt.info("== Configuring provider...")
	fmt.raw("")

	try {
		const normalizedProvider = options.provider.toLowerCase().trim()

		// Parse mode option - default to "both" if not specified
		let modesToConfigure: Mode[] = ["plan", "act"]
		if (options.mode) {
			const modeOption = options.mode.toLowerCase().trim()
			if (modeOption === "plan") {
				modesToConfigure = ["plan"]
			} else if (modeOption === "act") {
				modesToConfigure = ["act"]
			} else if (modeOption !== "both") {
				fmt.error(`Invalid mode: ${options.mode}. Must be 'plan', 'act', or 'both'.`)
				process.exit(1)
			}
		}

		// Validate provider
		if (!isValidProvider(normalizedProvider)) {
			fmt.error(`Unknown provider: ${options.provider}`)
			fmt.info(`Valid providers: ${API_PROVIDERS.slice().sort().join(", ")}`)
			process.exit(1)
		}

		// Check for bedrock (complex auth requirements)
		if (normalizedProvider === "bedrock") {
			fmt.error("Bedrock provider requires AWS credentials configuration. Please use interactive setup: cline auth")
			process.exit(1)
		}

		// Validate baseurl is only for OpenAI-compatible providers
		if (options.baseurl && !["openai", "openai-native", "litellm"].includes(normalizedProvider)) {
			fmt.error("Base URL is only supported for OpenAI, OpenAI Native, and LiteLLM providers")
			process.exit(1)
		}

		// Initialize embedded controller to access StateManager
		const controller = await getEmbeddedController(logger, config.configDir)

		// Set API key if provided
		if (options.apikey) {
			// Store API key based on provider
			switch (normalizedProvider) {
				case "anthropic":
					controller.stateManager.setSecret("apiKey", options.apikey)
					break
				case "openrouter":
					controller.stateManager.setSecret("openRouterApiKey", options.apikey)
					break
				case "openai":
					controller.stateManager.setSecret("openAiApiKey", options.apikey)
					break
				case "openai-native":
					controller.stateManager.setSecret("openAiNativeApiKey", options.apikey)
					break
				case "gemini":
					controller.stateManager.setSecret("geminiApiKey", options.apikey)
					break
				case "deepseek":
					controller.stateManager.setSecret("deepSeekApiKey", options.apikey)
					break
				case "mistral":
					controller.stateManager.setSecret("mistralApiKey", options.apikey)
					break
				case "groq":
					controller.stateManager.setSecret("groqApiKey", options.apikey)
					break
				case "xai":
					controller.stateManager.setSecret("xaiApiKey", options.apikey)
					break
				default:
					// Generic API key storage
					controller.stateManager.setSecret("apiKey" as any, options.apikey)
			}
		}

		// Save configuration for each mode
		for (const mode of modesToConfigure) {
			// Set provider for this mode
			const providerKey = getProviderKey(mode)
			controller.stateManager.setGlobalState(providerKey as any, normalizedProvider)

			// Set model ID for this mode using the correct key for the provider
			const modelIdKey = getModelIdKey(normalizedProvider, mode)
			controller.stateManager.setGlobalState(modelIdKey as any, options.modelid)
		}

		// Set base URL if provided (global setting, not mode-specific)
		if (options.baseurl) {
			controller.stateManager.setGlobalState("openAiBaseUrl" as any, options.baseurl)
		}

		// Flush pending state to ensure changes are persisted
		await controller.stateManager.flushPendingState()

		const modeLabel = modesToConfigure.length === 2 ? "both modes" : `${modesToConfigure[0]} mode`
		fmt.success(`Provider: ${normalizedProvider} (${modeLabel})`)
		fmt.success(`Model: ${options.modelid}`)
		if (options.baseurl) {
			fmt.success(`Base URL: ${options.baseurl}`)
		}
		if (options.apikey) {
			fmt.success(`API Key: ${maskApiKey(options.apikey)}`)
		}

		fmt.raw("")
		fmt.success("Successfully configured authentication")
		fmt.info("You can now use Cline with this provider.")
		fmt.info("Run 'cline task \"<your prompt>\"' to begin a new task.")

		// Cleanup and exit
		await disposeEmbeddedController(logger)
		process.exit(0)
	} catch (error) {
		fmt.error(`Configuration failed: ${error instanceof Error ? error.message : String(error)}`)
		await disposeEmbeddedController(logger)
		process.exit(1)
	}
}

/**
 * Handle interactive authentication menu
 */
async function handleInteractiveAuth(config: CliConfig, logger: Logger, fmt: OutputFormatter): Promise<void> {
	try {
		fmt.info("=� Cline Authentication Menu")
		fmt.raw("�".repeat(40))
		fmt.raw("")

		// Show main menu
		fmt.raw("What would you like to do?")
		fmt.raw("")
		fmt.raw("  1. Sign in to Cline (managed API)")
		fmt.raw("  2. Configure BYO API provider")
		fmt.raw("  3. View current configuration")
		fmt.raw("  4. Exit")
		fmt.raw("")

		const selection = await prompt("Enter choice (1-4): ")
		const choice = parseInt(selection, 10)

		switch (choice) {
			case 1:
				await handleClineSignIn(config, logger, fmt)
				break
			case 2:
				await handleProviderSetup(config, logger, fmt)
				break
			case 3:
				await handleViewConfig(config, logger, fmt)
				break
			case 4:
				fmt.info("Exiting authentication wizard.")
				process.exit(0)
				break
			default:
				fmt.error("Invalid selection. Please enter 1-4.")
				process.exit(1)
		}
	} catch (error) {
		fmt.error(`Authentication failed: ${error instanceof Error ? error.message : String(error)}`)
		process.exit(1)
	}
}

/**
 * Auth timeout in milliseconds (5 minutes)
 */
const AUTH_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Handle Cline account sign-in
 */
async function handleClineSignIn(config: CliConfig, logger: Logger, fmt: OutputFormatter): Promise<void> {
	fmt.raw("")
	fmt.info("== Cline Account Sign-In")
	fmt.raw("")
	fmt.info("This will open your browser to sign in to your Cline account.")
	fmt.info("Once signed in, you'll have access to Cline's managed API.")
	fmt.raw("")

	const confirm = await prompt("Continue? (y/n): ")
	if (confirm.toLowerCase() !== "y" && confirm.toLowerCase() !== "yes") {
		fmt.info("Sign-in cancelled.")
		process.exit(0)
	}

	// Import enableAuthHandler to set up OAuth callback server
	const { enableAuthHandler, disableAuthHandler } = await import("../../core/host-provider-setup.js")

	try {
		const controller = await getEmbeddedController(logger, config.configDir)

		// Enable the auth handler to receive OAuth callbacks
		enableAuthHandler()

		// Import AuthService dynamically to avoid circular dependencies
		const { AuthService } = await import("@/services/auth/AuthService")
		const authService = AuthService.getInstance(controller)

		fmt.info("Opening browser for authentication...")
		await authService.createAuthRequest()

		fmt.raw("")
		fmt.success("Browser opened for authentication")
		fmt.info("Waiting for authentication to complete...")
		fmt.info("(Press Ctrl+C to cancel)")
		fmt.raw("")

		// Wait for auth to complete by polling the auth status
		const authCompleted = await waitForAuthCompletion(authService, fmt, AUTH_TIMEOUT_MS)

		// Disable auth handler after auth completes
		disableAuthHandler()

		if (authCompleted) {
			const authInfo = authService.getInfo()
			fmt.raw("")
			fmt.success("Authentication successful!")
			if (authInfo.user?.email) {
				fmt.info(`Signed in as: ${authInfo.user.email}`)
			}

			// Set the Cline provider and default model for both modes
			// Import the default model ID from the shared API module
			const { openRouterDefaultModelId } = await import("@shared/api")
			const clineProvider = "cline"

			// Set provider for both modes
			controller.stateManager.setGlobalState("planModeApiProvider" as any, clineProvider)
			controller.stateManager.setGlobalState("actModeApiProvider" as any, clineProvider)

			// Set default model ID for both modes (Cline uses OpenRouter model IDs)
			controller.stateManager.setGlobalState("planModeOpenRouterModelId" as any, openRouterDefaultModelId)
			controller.stateManager.setGlobalState("actModeOpenRouterModelId" as any, openRouterDefaultModelId)

			// Flush pending state to ensure changes are persisted
			await controller.stateManager.flushPendingState()

			fmt.raw("")
			fmt.success(`Model: ${openRouterDefaultModelId}`)
			fmt.info("You can now use 'cline task' commands.")
		} else {
			fmt.raw("")
			fmt.warn("Authentication timed out or was not completed.")
			fmt.info("Please try again with 'cline auth'.")
		}

		// Cleanup
		await disposeEmbeddedController(logger)
		process.exit(authCompleted ? 0 : 1)
	} catch (error) {
		// Make sure to disable auth handler on error
		try {
			const { disableAuthHandler } = await import("../../core/host-provider-setup.js")
			disableAuthHandler()
		} catch {
			// Ignore cleanup errors
		}
		fmt.error(`Sign-in failed: ${error instanceof Error ? error.message : String(error)}`)
		await disposeEmbeddedController(logger)
		process.exit(1)
	}
}

/**
 * Wait for authentication to complete by polling auth status
 * @param authService - The AuthService instance
 * @param fmt - Output formatter for status updates
 * @param timeoutMs - Timeout in milliseconds
 * @returns true if auth completed successfully, false if timed out
 */
async function waitForAuthCompletion(
	authService: { getInfo: () => { user?: { email?: string } }; restoreRefreshTokenAndRetrieveAuthInfo: () => Promise<void> },
	_fmt: OutputFormatter,
	timeoutMs: number,
): Promise<boolean> {
	const startTime = Date.now()
	const pollIntervalMs = 2000 // Poll every 2 seconds

	// Show a simple spinner/waiting indicator
	const spinnerChars = ["|", "/", "-", "\\"]
	let spinnerIdx = 0

	while (Date.now() - startTime < timeoutMs) {
		// Check if auth is now complete
		try {
			// Restore auth info from storage to check if callback was received
			await authService.restoreRefreshTokenAndRetrieveAuthInfo()
			const authInfo = authService.getInfo()
			if (authInfo.user) {
				return true
			}
		} catch {
			// Ignore errors during polling
		}

		// Update spinner
		process.stdout.write(`\r  ${spinnerChars[spinnerIdx]} Waiting for browser authentication...`)
		spinnerIdx = (spinnerIdx + 1) % spinnerChars.length

		// Wait before next poll
		await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
	}

	// Clear the spinner line
	process.stdout.write("\r" + " ".repeat(50) + "\r")

	return false
}

/**
 * Handle interactive BYO provider setup
 */
async function handleProviderSetup(config: CliConfig, logger: Logger, fmt: OutputFormatter): Promise<void> {
	fmt.raw("")
	fmt.info("=' Configure API Provider")
	fmt.raw("")

	// Display providers
	fmt.raw("Select a provider:")
	fmt.raw("")
	PROVIDER_INFO.forEach((provider, index) => {
		const num = (index + 1).toString().padStart(2, " ")
		fmt.raw(`  ${num}. ${provider.name}`)
		fmt.raw(`      ${provider.description}`)
		if (provider.requiresApiKey && provider.keyUrl) {
			fmt.raw(`      Get API key: ${provider.keyUrl}`)
		} else if (!provider.requiresApiKey) {
			fmt.raw(`      No API key required`)
		}
		fmt.raw("")
	})

	// Get selection
	const selection = await prompt(`Enter number (1-${PROVIDER_INFO.length}): `)
	const index = parseInt(selection, 10) - 1

	if (Number.isNaN(index) || index < 0 || index >= PROVIDER_INFO.length) {
		fmt.error("Invalid selection")
		process.exit(1)
	}

	const provider = PROVIDER_INFO[index]
	logger.debug(`Selected provider: ${provider.id}`)

	// Special handling for Cline provider
	if (provider.id === "cline") {
		await handleClineSignIn(config, logger, fmt)
		return
	}

	// Prompt for API key if required
	let apiKey: string | undefined
	if (provider.requiresApiKey) {
		if (provider.keyUrl) {
			fmt.raw("")
			fmt.info(`Get your API key at: ${provider.keyUrl}`)
		}
		apiKey = await prompt("Enter API key: ", true)
		if (!apiKey?.trim()) {
			fmt.error("No API key provided")
			process.exit(1)
		}
	}

	// Prompt for model ID
	fmt.raw("")
	const modelId = await prompt("Enter model ID (e.g., claude-sonnet-4-5-20250929, gpt-4o): ")
	if (!modelId?.trim()) {
		fmt.error("No model ID provided")
		process.exit(1)
	}

	// Prompt for base URL if applicable
	let baseUrl: string | undefined
	if (["openai", "openai-native", "litellm"].includes(provider.id)) {
		fmt.raw("")
		baseUrl = await prompt("Enter base URL (optional, press Enter to skip): ")
		baseUrl = baseUrl?.trim() || undefined
	}

	// Prompt for mode selection
	fmt.raw("")
	fmt.raw("Which mode(s) should use this provider?")
	fmt.raw("  1. Both plan and act modes (recommended)")
	fmt.raw("  2. Plan mode only")
	fmt.raw("  3. Act mode only")
	fmt.raw("")
	const modeSelection = await prompt("Enter choice (1-3, default: 1): ")
	let modeOption: string | undefined
	const modeChoice = parseInt(modeSelection, 10) || 1
	switch (modeChoice) {
		case 2:
			modeOption = "plan"
			break
		case 3:
			modeOption = "act"
			break
		default:
			modeOption = "both"
	}

	// Save configuration
	await handleQuickSetup(config, logger, fmt, {
		provider: provider.id,
		apikey: apiKey?.trim(),
		modelid: modelId.trim(),
		baseurl: baseUrl,
		mode: modeOption,
	})
}

/**
 * Get the model ID for a provider from state, checking the appropriate key
 */
function getModelIdFromState(
	stateManager: { getGlobalStateKey: (key: any) => any },
	provider: ApiProvider,
	mode: Mode,
): string | undefined {
	const modelIdKey = getModelIdKey(provider, mode)
	return stateManager.getGlobalStateKey(modelIdKey as any)
}

/**
 * Handle viewing current configuration
 */
async function handleViewConfig(config: CliConfig, logger: Logger, fmt: OutputFormatter): Promise<void> {
	fmt.raw("")
	fmt.info("== Current Configuration")
	fmt.raw("")

	try {
		const controller = await getEmbeddedController(logger, config.configDir)

		// Read mode-specific configuration
		// Note: These keys are in Settings, not GlobalState, so we need to cast
		const planModeProvider = controller.stateManager.getGlobalStateKey("planModeApiProvider" as any)
		const actModeProvider = controller.stateManager.getGlobalStateKey("actModeApiProvider" as any)
		const openAiBaseUrl = controller.stateManager.getGlobalStateKey("openAiBaseUrl" as any)

		if (!planModeProvider && !actModeProvider) {
			fmt.info("No provider configured.")
			fmt.info("Run 'cline auth' to set up authentication.")
		} else {
			// Get model IDs for each mode
			const planModelId = planModeProvider
				? getModelIdFromState(controller.stateManager, planModeProvider as ApiProvider, "plan")
				: undefined
			const actModelId = actModeProvider
				? getModelIdFromState(controller.stateManager, actModeProvider as ApiProvider, "act")
				: undefined

			fmt.raw("Plan Mode:")
			fmt.keyValue({
				Provider: planModeProvider ? String(planModeProvider) : "(not set)",
				"Model ID": planModelId ? String(planModelId) : "(not set)",
			})

			fmt.raw("")
			fmt.raw("Act Mode:")
			fmt.keyValue({
				Provider: actModeProvider ? String(actModeProvider) : "(not set)",
				"Model ID": actModelId ? String(actModelId) : "(not set)",
			})

			if (openAiBaseUrl) {
				fmt.raw("")
				fmt.keyValue({ "Base URL": String(openAiBaseUrl) })
			}
		}

		// Cleanup and exit
		await disposeEmbeddedController(logger)
		process.exit(0)
	} catch (error) {
		fmt.error(`Failed to read configuration: ${error instanceof Error ? error.message : String(error)}`)
		await disposeEmbeddedController(logger)
		process.exit(1)
	}
}

/**
 * Get the secret key name for a provider's API key
 */
function getSecretKeyForProvider(provider: ApiProvider): string | null {
	switch (provider) {
		case "anthropic":
			return "apiKey"
		case "openrouter":
			return "openRouterApiKey"
		case "openai":
			return "openAiApiKey"
		case "openai-native":
			return "openAiNativeApiKey"
		case "gemini":
			return "geminiApiKey"
		case "deepseek":
			return "deepSeekApiKey"
		case "mistral":
			return "mistralApiKey"
		case "groq":
			return "groqApiKey"
		case "xai":
			return "xaiApiKey"
		case "cerebras":
			return "cerebrasApiKey"
		case "fireworks":
			return "fireworksApiKey"
		case "together":
			return "togetherApiKey"
		// Providers that don't require API keys
		case "ollama":
		case "lmstudio":
		case "bedrock":
		case "vertex":
		case "cline":
			return null
		default:
			return "apiKey"
	}
}

/**
 * Handle showing authentication status
 */
async function handleAuthStatus(config: CliConfig, logger: Logger, fmt: OutputFormatter): Promise<void> {
	try {
		const controller = await getEmbeddedController(logger, config.configDir)

		fmt.raw("")
		fmt.info("== Authentication Status")
		fmt.raw("")

		// Check Cline account authentication
		let clineAccountAuthenticated = false
		let clineAccountEmail: string | undefined
		let clineAccountDisplayName: string | undefined

		try {
			// Import AuthService dynamically to avoid circular dependencies
			const { AuthService } = await import("@/services/auth/AuthService")
			const authService = AuthService.getInstance(controller)

			// Restore auth info from storage to check current status
			await authService.restoreRefreshTokenAndRetrieveAuthInfo()

			const authInfo = authService.getInfo()
			if (authInfo.user) {
				clineAccountAuthenticated = true
				clineAccountEmail = authInfo.user.email
				clineAccountDisplayName = authInfo.user.displayName
			}
		} catch (error) {
			logger.debug(`Error checking Cline account auth: ${error}`)
			// Cline account auth check failed, continue with BYO provider check
		}

		// Display Cline account status
		if (clineAccountAuthenticated) {
			fmt.success("Cline Account: Signed in")
			if (clineAccountEmail) {
				fmt.raw(`  Email: ${clineAccountEmail}`)
			}
			if (clineAccountDisplayName) {
				fmt.raw(`  Display Name: ${clineAccountDisplayName}`)
			}
		} else {
			fmt.raw("Cline Account: Not signed in")
		}

		fmt.raw("")

		// Check BYO provider configuration
		const planModeProvider = controller.stateManager.getGlobalStateKey("planModeApiProvider" as any) as
			| ApiProvider
			| undefined
		const actModeProvider = controller.stateManager.getGlobalStateKey("actModeApiProvider" as any) as ApiProvider | undefined

		fmt.raw("Provider Configuration:")

		// Check plan mode
		if (planModeProvider) {
			const planModelId = getModelIdFromState(controller.stateManager, planModeProvider, "plan")
			const providerInfo = getProviderInfo(String(planModeProvider))
			const displayName = providerInfo?.name || planModeProvider
			fmt.raw(`  Plan Mode: ${displayName}${planModelId ? ` (${planModelId})` : ""}`)
		} else {
			fmt.raw("  Plan Mode: (not configured)")
		}

		// Check act mode
		if (actModeProvider) {
			const actModelId = getModelIdFromState(controller.stateManager, actModeProvider, "act")
			const providerInfo = getProviderInfo(String(actModeProvider))
			const displayName = providerInfo?.name || actModeProvider
			fmt.raw(`  Act Mode: ${displayName}${actModelId ? ` (${actModelId})` : ""}`)
		} else {
			fmt.raw("  Act Mode: (not configured)")
		}

		// Check API key status for the configured provider(s)
		let hasApiKey = false
		const providersToCheck = new Set<ApiProvider>()
		if (planModeProvider) {
			providersToCheck.add(planModeProvider)
		}
		if (actModeProvider) {
			providersToCheck.add(actModeProvider)
		}

		for (const provider of providersToCheck) {
			const secretKey = getSecretKeyForProvider(provider)
			if (secretKey === null) {
				// Provider doesn't require API key (e.g., ollama, cline)
				hasApiKey = true
			} else {
				const apiKey = controller.stateManager.getSecretKey(secretKey as any)
				if (apiKey) {
					hasApiKey = true
				}
			}
		}

		if (providersToCheck.size > 0) {
			if (hasApiKey) {
				fmt.raw("  API Key: Configured")
			} else {
				fmt.raw("  API Key: Not configured")
			}
		}

		fmt.raw("")

		// Determine overall readiness
		const isClineProvider = planModeProvider === "cline" || actModeProvider === "cline"
		const hasProviderConfig = planModeProvider || actModeProvider

		let isReady = false
		let readyMessage = ""

		if (isClineProvider && clineAccountAuthenticated) {
			isReady = true
			readyMessage = "Yes - Cline account authenticated"
		} else if (hasProviderConfig && hasApiKey && !isClineProvider) {
			isReady = true
			readyMessage = "Yes - BYO provider configured"
		} else if (isClineProvider && !clineAccountAuthenticated) {
			readyMessage = "No - Cline provider requires sign-in. Run 'cline auth' to sign in."
		} else if (hasProviderConfig && !hasApiKey) {
			readyMessage = "No - API key not configured. Run 'cline auth' to configure."
		} else {
			readyMessage = "No - No provider configured. Run 'cline auth' to configure authentication."
		}

		if (isReady) {
			fmt.success(`Ready to use: ${readyMessage}`)
		} else {
			fmt.warn(`Ready to use: ${readyMessage}`)
		}

		// Cleanup and exit
		await disposeEmbeddedController(logger)
		process.exit(0)
	} catch (error) {
		fmt.error(`Failed to check authentication status: ${error instanceof Error ? error.message : String(error)}`)
		await disposeEmbeddedController(logger)
		process.exit(1)
	}
}

/**
 * Handle listing configured providers
 */
async function handleListProviders(config: CliConfig, logger: Logger, fmt: OutputFormatter): Promise<void> {
	try {
		const controller = await getEmbeddedController(logger, config.configDir)

		const planModeProvider = controller.stateManager.getGlobalStateKey("planModeApiProvider" as any)
		const actModeProvider = controller.stateManager.getGlobalStateKey("actModeApiProvider" as any)

		if (!planModeProvider && !actModeProvider) {
			fmt.info("No API provider configured.")
			fmt.info("Run 'cline auth' to set up authentication.")
		} else {
			fmt.info("Configured providers:")
			fmt.raw("")

			if (planModeProvider) {
				const planModelId = getModelIdFromState(controller.stateManager, planModeProvider as ApiProvider, "plan")
				const providerInfo = getProviderInfo(String(planModeProvider))
				fmt.raw(`  Plan Mode: ${providerInfo?.name || planModeProvider}`)
				fmt.raw(`    Model: ${planModelId || "(no model set)"}`)
			} else {
				fmt.raw(`  Plan Mode: (not configured)`)
			}

			if (actModeProvider) {
				const actModelId = getModelIdFromState(controller.stateManager, actModeProvider as ApiProvider, "act")
				const providerInfo = getProviderInfo(String(actModeProvider))
				fmt.raw(`  Act Mode: ${providerInfo?.name || actModeProvider}`)
				fmt.raw(`    Model: ${actModelId || "(no model set)"}`)
			} else {
				fmt.raw(`  Act Mode: (not configured)`)
			}
		}

		// Cleanup and exit
		await disposeEmbeddedController(logger)
		process.exit(0)
	} catch (error) {
		fmt.error(`Failed to list providers: ${error instanceof Error ? error.message : String(error)}`)
		await disposeEmbeddedController(logger)
		process.exit(1)
	}
}

/**
 * Handle deleting provider configuration
 */
async function handleDeleteProvider(
	config: CliConfig,
	logger: Logger,
	fmt: OutputFormatter,
	providerId: string,
	modeOption?: string,
): Promise<void> {
	try {
		// Parse mode option - default to "both" if not specified
		let modesToClear: Mode[] = ["plan", "act"]
		if (modeOption) {
			const mode = modeOption.toLowerCase().trim()
			if (mode === "plan") {
				modesToClear = ["plan"]
			} else if (mode === "act") {
				modesToClear = ["act"]
			} else if (mode !== "both") {
				fmt.error(`Invalid mode: ${modeOption}. Must be 'plan', 'act', or 'both'.`)
				process.exit(1)
			}
		}

		const controller = await getEmbeddedController(logger, config.configDir)

		const normalizedProvider = providerId.toLowerCase().trim() as ApiProvider

		// Clear the API configuration for each mode
		for (const mode of modesToClear) {
			// Clear provider
			const providerKey = getProviderKey(mode)
			controller.stateManager.setGlobalState(providerKey as any, undefined)

			// Clear model ID using the correct key for the provider
			const modelIdKey = getModelIdKey(normalizedProvider, mode)
			controller.stateManager.setGlobalState(modelIdKey as any, undefined)
		}

		// Clear base URL (global setting)
		controller.stateManager.setGlobalState("openAiBaseUrl" as any, undefined)

		// Clear secrets for the provider
		switch (normalizedProvider) {
			case "anthropic":
				await controller.stateManager.setSecret("anthropicApiKey" as any, undefined)
				break
			case "openrouter":
				await controller.stateManager.setSecret("openRouterApiKey", undefined)
				break
			case "openai":
			case "openai-native":
				await controller.stateManager.setSecret("openAiApiKey", undefined)
				break
			case "gemini":
				await controller.stateManager.setSecret("geminiApiKey", undefined)
				break
			case "deepseek":
				await controller.stateManager.setSecret("deepSeekApiKey", undefined)
				break
			case "mistral":
				await controller.stateManager.setSecret("mistralApiKey", undefined)
				break
			case "groq":
				await controller.stateManager.setSecret("groqApiKey", undefined)
				break
			case "xai":
				await controller.stateManager.setSecret("xaiApiKey", undefined)
				break
		}

		// Flush pending state
		await controller.stateManager.flushPendingState()

		const modeLabel = modesToClear.length === 2 ? "both modes" : `${modesToClear[0]} mode`
		fmt.success(`Deleted configuration for ${providerId} (${modeLabel})`)

		// Cleanup and exit
		await disposeEmbeddedController(logger)
		process.exit(0)
	} catch (error) {
		fmt.error(`Failed to delete provider: ${error instanceof Error ? error.message : String(error)}`)
		await disposeEmbeddedController(logger)
		process.exit(1)
	}
}

/**
 * Create the auth command
 */
export function createAuthCommand(config: CliConfig, logger: Logger, formatter: OutputFormatter): Command {
	const authCommand = new Command("auth")
		.alias("a")
		.description("Manage API provider authentication")
		.option("-p, --provider <provider>", "API provider (e.g., anthropic, openrouter, openai)")
		.option("-k, --apikey <key>", "API key for the provider")
		.option("-m, --modelid <model>", "Model ID to use (e.g., claude-sonnet-4-5-20250929)")
		.option("-b, --baseurl <url>", "Base URL for OpenAI-compatible providers")
		.option("--mode <mode>", "Mode to configure: 'plan', 'act', or 'both' (default: both)")
		.option("-l, --list", "List configured providers")
		.option("-s, --status", "Show authentication status")
		.option("-d, --delete <provider>", "Delete configuration for a provider")
		.action(async (options) => {
			logger.debug("Auth command called", { options })

			// Handle --list flag
			if (options.list) {
				await handleListProviders(config, logger, formatter)
				return
			}

			// Handle --status flag
			if (options.status) {
				await handleAuthStatus(config, logger, formatter)
				return
			}

			// Handle --delete flag
			if (options.delete) {
				await handleDeleteProvider(config, logger, formatter, options.delete, options.mode)
				return
			}

			// Check if quick setup flags are provided
			if (options.provider || options.apikey || options.modelid || options.baseurl) {
				// Validate required flags for quick setup
				if (!options.provider || !options.modelid) {
					formatter.error("Quick setup requires both --provider and --modelid flags")
					formatter.info("")
					formatter.info("Usage:")
					formatter.info(
						"  cline auth --provider <provider> --apikey <key> --modelid <model> [--baseurl <url>] [--mode <mode>]",
					)
					formatter.info("")
					formatter.info("Options:")
					formatter.info("  --mode <mode>  Mode to configure: 'plan', 'act', or 'both' (default: both)")
					formatter.info("")
					formatter.info("Examples:")
					formatter.info("  cline auth --provider anthropic --apikey sk-ant-xxx --modelid claude-sonnet-4-5-20250929")
					formatter.info("  cline auth -p openrouter -k sk-or-xxx -m anthropic/claude-sonnet-4")
					formatter.info("  cline auth -p openai -k sk-xxx -m gpt-4o -b https://api.example.com/v1")
					formatter.info("  cline auth -p anthropic -k sk-ant-xxx -m claude-sonnet-4-5-20250929 --mode plan")
					formatter.info("")
					formatter.info("Run 'cline auth' without flags for interactive setup.")
					process.exit(1)
				}

				await handleQuickSetup(config, logger, formatter, {
					provider: options.provider,
					apikey: options.apikey,
					modelid: options.modelid,
					baseurl: options.baseurl,
					mode: options.mode,
				})
				return
			}

			// No flags - run interactive mode
			await handleInteractiveAuth(config, logger, formatter)
		})

	return authCommand
}
