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
	options: { provider: string; apikey?: string; modelid: string; baseurl?: string },
): Promise<void> {
	fmt.info("= Configuring provider...")
	fmt.raw("")

	try {
		const normalizedProvider = options.provider.toLowerCase().trim()

		// Validate provider
		if (!isValidProvider(normalizedProvider)) {
			fmt.error(`Unknown provider: ${options.provider}`)
			fmt.info(`Valid providers: ${API_PROVIDERS.slice().sort().join(", ")}`)
			process.exit(1)
		}

		// Check for bedrock (complex auth requirements)
		if (normalizedProvider === "bedrock") {
			fmt.error(
				"Bedrock provider requires AWS credentials configuration. Please use interactive setup: cline auth",
			)
			process.exit(1)
		}

		// Validate baseurl is only for OpenAI-compatible providers
		if (options.baseurl && !["openai", "openai-native", "litellm"].includes(normalizedProvider)) {
			fmt.error("Base URL is only supported for OpenAI, OpenAI Native, and LiteLLM providers")
			process.exit(1)
		}

		// Initialize embedded controller to access StateManager
		fmt.info("Initializing Cline...")
		const controller = await getEmbeddedController(logger, config.configDir)

		// Build API configuration
		const apiConfig: Record<string, unknown> = {
			apiProvider: normalizedProvider,
		}

		// Set API key if provided
		if (options.apikey) {
			// Store API key based on provider
			switch (normalizedProvider) {
				case "anthropic":
					await controller.stateManager.setSecret("anthropicApiKey", options.apikey)
					break
				case "openrouter":
					await controller.stateManager.setSecret("openRouterApiKey", options.apikey)
					break
				case "openai":
				case "openai-native":
					await controller.stateManager.setSecret("openAiApiKey", options.apikey)
					break
				case "gemini":
					await controller.stateManager.setSecret("geminiApiKey", options.apikey)
					break
				case "deepseek":
					await controller.stateManager.setSecret("deepSeekApiKey", options.apikey)
					break
				case "mistral":
					await controller.stateManager.setSecret("mistralApiKey", options.apikey)
					break
				case "groq":
					await controller.stateManager.setSecret("groqApiKey", options.apikey)
					break
				case "xai":
					await controller.stateManager.setSecret("xaiApiKey", options.apikey)
					break
				default:
					// Generic API key storage
					await controller.stateManager.setSecret("apiKey", options.apikey)
			}
		}

		// Set model ID
		apiConfig.apiModelId = options.modelid

		// Set base URL if provided
		if (options.baseurl) {
			apiConfig.openAiBaseUrl = options.baseurl
		}

		// Save configuration to StateManager
		controller.stateManager.setGlobalState("apiProvider" as any, normalizedProvider)
		controller.stateManager.setGlobalState("apiModelId" as any, options.modelid)
		if (options.baseurl) {
			controller.stateManager.setGlobalState("openAiBaseUrl" as any, options.baseurl)
		}

		// Flush pending state to ensure changes are persisted
		await controller.stateManager.flushPendingState()

		fmt.success(`Provider: ${normalizedProvider}`)
		fmt.success(`Model: ${options.modelid}`)
		if (options.baseurl) {
			fmt.success(`Base URL: ${options.baseurl}`)
		}
		if (options.apikey) {
			fmt.success(`API Key: ${maskApiKey(options.apikey)}`)
		}

		fmt.raw("")
		fmt.success(" Successfully configured authentication")
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
		fmt.info("= Cline Authentication Menu")
		fmt.raw(" ".repeat(40))
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
 * Handle Cline account sign-in
 */
async function handleClineSignIn(config: CliConfig, logger: Logger, fmt: OutputFormatter): Promise<void> {
	fmt.raw("")
	fmt.info("=ñ Cline Account Sign-In")
	fmt.raw("")
	fmt.info("This will open your browser to sign in to your Cline account.")
	fmt.info("Once signed in, you'll have access to Cline's managed API.")
	fmt.raw("")

	const confirm = await prompt("Continue? (y/n): ")
	if (confirm.toLowerCase() !== "y" && confirm.toLowerCase() !== "yes") {
		fmt.info("Sign-in cancelled.")
		process.exit(0)
	}

	try {
		fmt.info("Initializing Cline...")
		const controller = await getEmbeddedController(logger, config.configDir)

		// Import AuthService dynamically to avoid circular dependencies
		const { AuthService } = await import("@/services/auth/AuthService")
		const authService = AuthService.getInstance(controller)

		fmt.info("Opening browser for authentication...")
		await authService.createAuthRequest()

		fmt.raw("")
		fmt.success(" Browser opened for authentication")
		fmt.info("Please complete the sign-in process in your browser.")
		fmt.info("After signing in, you can close this terminal and use 'cline task' commands.")

		// Cleanup
		await disposeEmbeddedController(logger)
		process.exit(0)
	} catch (error) {
		fmt.error(`Sign-in failed: ${error instanceof Error ? error.message : String(error)}`)
		await disposeEmbeddedController(logger)
		process.exit(1)
	}
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

	// Save configuration
	await handleQuickSetup(config, logger, fmt, {
		provider: provider.id,
		apikey: apiKey?.trim(),
		modelid: modelId.trim(),
		baseurl: baseUrl,
	})
}

/**
 * Handle viewing current configuration
 */
async function handleViewConfig(config: CliConfig, logger: Logger, fmt: OutputFormatter): Promise<void> {
	fmt.raw("")
	fmt.info("=Ë Current Configuration")
	fmt.raw("")

	try {
		fmt.info("Initializing Cline...")
		const controller = await getEmbeddedController(logger, config.configDir)

		const apiProvider = controller.stateManager.getGlobalStateKey("apiProvider" as any)
		const apiModelId = controller.stateManager.getGlobalStateKey("apiModelId" as any)
		const openAiBaseUrl = controller.stateManager.getGlobalStateKey("openAiBaseUrl" as any)

		if (!apiProvider) {
			fmt.info("No provider configured.")
			fmt.info("Run 'cline auth' to set up authentication.")
		} else {
			fmt.keyValue({
				Provider: String(apiProvider),
				"Model ID": apiModelId ? String(apiModelId) : "(not set)",
				...(openAiBaseUrl ? { "Base URL": String(openAiBaseUrl) } : {}),
			})
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
 * Handle listing configured providers
 */
async function handleListProviders(config: CliConfig, logger: Logger, fmt: OutputFormatter): Promise<void> {
	try {
		fmt.info("Initializing Cline...")
		const controller = await getEmbeddedController(logger, config.configDir)

		const apiProvider = controller.stateManager.getGlobalStateKey("apiProvider" as any)
		const apiModelId = controller.stateManager.getGlobalStateKey("apiModelId" as any)

		if (!apiProvider) {
			fmt.info("No API provider configured.")
			fmt.info("Run 'cline auth' to set up authentication.")
		} else {
			fmt.info("Configured provider:")
			const providerInfo = getProviderInfo(String(apiProvider))
			fmt.raw(`  ${providerInfo?.name || apiProvider}: ${apiModelId || "(no model set)"}`)
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
): Promise<void> {
	try {
		fmt.info("Initializing Cline...")
		const controller = await getEmbeddedController(logger, config.configDir)

		// Clear the API configuration
		controller.stateManager.setGlobalState("apiProvider" as any, undefined)
		controller.stateManager.setGlobalState("apiModelId" as any, undefined)
		controller.stateManager.setGlobalState("openAiBaseUrl" as any, undefined)

		// Clear secrets for the provider
		switch (providerId.toLowerCase()) {
			case "anthropic":
				await controller.stateManager.setSecret("anthropicApiKey", undefined)
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

		fmt.success(`Deleted configuration for ${providerId}`)

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
		.option("-l, --list", "List configured providers")
		.option("-d, --delete <provider>", "Delete configuration for a provider")
		.action(async (options) => {
			logger.debug("Auth command called", { options })

			// Handle --list flag
			if (options.list) {
				await handleListProviders(config, logger, formatter)
				return
			}

			// Handle --delete flag
			if (options.delete) {
				await handleDeleteProvider(config, logger, formatter, options.delete)
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
						"  cline auth --provider <provider> --apikey <key> --modelid <model> [--baseurl <url>]",
					)
					formatter.info("")
					formatter.info("Examples:")
					formatter.info("  cline auth --provider anthropic --apikey sk-ant-xxx --modelid claude-sonnet-4-5-20250929")
					formatter.info("  cline auth -p openrouter -k sk-or-xxx -m anthropic/claude-sonnet-4")
					formatter.info("  cline auth -p openai -k sk-xxx -m gpt-4o -b https://api.example.com/v1")
					formatter.info("")
					formatter.info("Run 'cline auth' without flags for interactive setup.")
					process.exit(1)
				}

				await handleQuickSetup(config, logger, formatter, {
					provider: options.provider,
					apikey: options.apikey,
					modelid: options.modelid,
					baseurl: options.baseurl,
				})
				return
			}

			// No flags - run interactive mode
			await handleInteractiveAuth(config, logger, formatter)
		})

	return authCommand
}