/**
 * CLI Authentication Handler
 *
 * Provides interactive and quick-setup authentication modes for the Cline CLI.
 * Supports both interactive menus and command-line flag-based configuration.
 */

import prompts from "prompts"
import { StateManager } from "@/core/storage/StateManager"
import { HostProvider } from "@/hosts/host-provider"
import { FileEditProvider } from "@/integrations/editor/FileEditProvider"
import { StandaloneTerminalManager } from "@/integrations/terminal/standalone/StandaloneTerminalManager"
import { ErrorService } from "@/services/error/ErrorService"
import { API_PROVIDERS_LIST } from "@/shared/api"
import { createCliHostBridgeProvider } from "./cli-host-bridge"
import { print, printError, printInfo, printSuccess, separator } from "./display"
import { initializeCliContext } from "./vscode-context"

/**
 * Options for the auth command
 */
export interface AuthOptions {
	provider?: string
	apikey?: string
	modelid?: string
	baseurl?: string
	verbose?: boolean
	cwd?: string
	config?: string
}

/**
 * Run authentication flow
 * Routes to either interactive mode or quick setup based on provided flags
 */
export async function runAuth(options: AuthOptions): Promise<void> {
	try {
		// Initialize services
		const { extensionContext, EXTENSION_DIR, DATA_DIR } = initializeCliContext({
			clineDir: options.config,
			workspaceDir: options.cwd || process.cwd(),
		})

		await ErrorService.initialize()

		// Setup minimal host provider
		setupHostProvider(extensionContext, EXTENSION_DIR, DATA_DIR, options.cwd || process.cwd())

		// Initialize state manager
		await StateManager.initialize(extensionContext)

		// Check if flags are provided for quick setup
		if (options.provider || options.apikey || options.modelid || options.baseurl) {
			await handleQuickSetup(options)
		} else {
			// No flags - show interactive menu
			await handleInteractiveAuth()
		}
	} catch (error) {
		printError(`Authentication failed: ${error instanceof Error ? error.message : String(error)}`)
		process.exit(1)
	}
}

/**
 * Setup the host provider for CLI mode
 */
function setupHostProvider(_extensionContext: any, extensionDir: string, dataDir: string, workspacePath: string) {
	const createWebview = () => {
		throw new Error("Webview not available in auth mode")
	}
	const createDiffView = () => new FileEditProvider()
	const createCommentReview = () => {
		throw new Error("CommentReview not available in auth mode")
	}
	const createTerminalManager = () => new StandaloneTerminalManager()

	const getCallbackUrl = async (): Promise<string> => ""
	const getBinaryLocation = async (name: string): Promise<string> => {
		const path = await import("path")
		return path.join(process.cwd(), name)
	}
	const logToChannel = (_message: string) => {
		// Silent in auth mode
	}

	HostProvider.initialize(
		createWebview,
		createDiffView,
		createCommentReview,
		createTerminalManager,
		createCliHostBridgeProvider(workspacePath),
		logToChannel,
		getCallbackUrl,
		getBinaryLocation,
		extensionDir,
		dataDir,
	)
}

/**
 * Handle quick setup mode using command-line flags
 */
async function handleQuickSetup(options: AuthOptions): Promise<void> {
	// Validate required parameters
	if (!options.provider || !options.apikey || !options.modelid) {
		printError("Quick setup requires --provider, --apikey, and --modelid flags")
		printInfo("Usage: cline auth --provider <provider> --apikey <key> --modelid <model> [--baseurl <url>]")
		printInfo("\nExamples:")
		printInfo("  cline auth --provider openai-native --apikey sk-xxx --modelid gpt-5")
		printInfo("  cline auth -p anthropic -k sk-ant-xxx -m claude-sonnet-4-5-20250929")
		printInfo("  cline auth -p openai-compatible -k xxx -m gpt-4 -b https://api.example.com/v1")
		process.exit(1)
	}

	printInfo("🔐 Configuring provider...")
	print(separator())

	try {
		const normalizedProvider = options.provider.toLowerCase().trim()
		if (!API_PROVIDERS_LIST.includes(normalizedProvider)) {
			throw new Error(`Invalid provider '${options.provider}'. Supported providers: ${API_PROVIDERS_LIST.join(", ")}`)
		}

		// Check for bedrock
		if (normalizedProvider === "bedrock") {
			throw new Error(
				"Bedrock provider is not supported for quick setup due to complex authentication requirements. Please use interactive setup: cline auth",
			)
		}

		// Validate baseurl is only for OpenAI
		if (options.baseurl && !["openai", "openai-native"].includes(normalizedProvider)) {
			throw new Error("Base URL is only supported for OpenAI and OpenAI-compatible providers")
		}

		// Save configuration to StateManager
		const stateManager = StateManager.get()
		const config: Record<string, string> = {
			actModeApiProvider: normalizedProvider,
			planModeApiProvider: normalizedProvider,
			actModeApiModelId: options.modelid,
			planModeApiModelId: options.modelid,
			apiKey: options.apikey,
		}

		if (options.baseurl) {
			config.openAiBaseUrl = options.baseurl
		}

		await stateManager.setApiConfiguration(config)

		printSuccess(`Provider: ${normalizedProvider}`)
		printSuccess(`Model: ${options.modelid}`)
		if (options.baseurl) {
			printSuccess(`Base URL: ${options.baseurl}`)
		}
		printSuccess("API Key: Configured")

		print(separator())
		printSuccess("✓ Successfully configured authentication")
		printInfo("You can now use Cline with this provider.")
		printInfo("Run 'cline task \"<your prompt>\"' to begin a new task.")
	} catch (error) {
		printError(`Configuration failed: ${error instanceof Error ? error.message : String(error)}`)
		process.exit(1)
	}
}

/**
 * Handle interactive authentication menu
 */
async function handleInteractiveAuth(): Promise<void> {
	try {
		printInfo("🔐 Cline Authentication Menu")
		print(separator())
		printInfo("")

		// Show main menu
		const mainMenuResponse = await prompts({
			type: "select",
			name: "action",
			message: "What would you like to do?",
			choices: [
				{ title: "Configure BYO API provider", value: "configure_byo" },
				{ title: "Exit", value: "exit" },
			],
		})

		if (mainMenuResponse.action === "exit" || mainMenuResponse.action === undefined) {
			printInfo("Exiting authentication wizard.")
			return
		}

		if (mainMenuResponse.action === "configure_byo") {
			await handleProviderSetupInteractive()
		}
	} catch (error) {
		printError(`Authentication failed: ${error instanceof Error ? error.message : String(error)}`)
		process.exit(1)
	}
}

/**
 * Handle interactive BYO provider setup
 */
async function handleProviderSetupInteractive(): Promise<void> {
	// Get current configuration to show which providers are already configured
	const stateManager = StateManager.get()
	const currentConfig = stateManager.getApiConfiguration()
	const currentProvider = currentConfig.actModeApiProvider || currentConfig.planModeApiProvider

	const providerResponse = await prompts({
		type: "select",
		name: "provider",
		message: "Select a provider:",
		choices: API_PROVIDERS_LIST.map((p) => ({
			title: `${capitalize(p)}${currentProvider === p ? " (configured)" : ""}`,
			value: p,
		})),
	})

	if (providerResponse.provider === undefined) {
		printInfo("Provider setup cancelled.")
		return
	}

	const apiKeyResponse = await prompts({
		type: "password",
		name: "apikey",
		message: "Enter your API key:",
	})

	if (apiKeyResponse.apikey === undefined) {
		printInfo("Provider setup cancelled.")
		return
	}

	const modelResponse = await prompts({
		type: "text",
		name: "modelid",
		message: "Enter the model ID (e.g., gpt-4, claude-sonnet-4.5):",
	})

	if (modelResponse.modelid === undefined) {
		printInfo("Provider setup cancelled.")
		return
	}

	let baseUrl = ""
	if (["openai", "openai-native"].includes(providerResponse.provider)) {
		const baseUrlResponse = await prompts({
			type: "text",
			name: "baseurl",
			message: "Enter base URL (optional, press Enter to skip):",
			initial: "",
		})
		baseUrl = baseUrlResponse.baseurl || ""
	}

	// Save configuration to StateManager
	try {
		const stateManager = StateManager.get()
		const config: Record<string, string> = {
			actModeApiProvider: providerResponse.provider,
			planModeApiProvider: providerResponse.provider,
			actModeApiModelId: modelResponse.modelid,
			planModeApiModelId: modelResponse.modelid,
			apiKey: apiKeyResponse.apikey,
		}

		if (baseUrl) {
			config.openAiBaseUrl = baseUrl
		}

		stateManager.setApiConfiguration(config)

		print(separator())
		printSuccess(`✓ Provider configured successfully`)
		printInfo(`Provider: ${capitalize(providerResponse.provider)}`)
		printInfo(`Model: ${modelResponse.modelid}`)
		if (baseUrl) {
			printInfo(`Base URL: ${baseUrl}`)
		}
		print(separator())
		printInfo("You can now use Cline with this provider.")
		printInfo("Run 'cline task \"<your prompt>\"' to begin a new task.")
	} catch (error) {
		printError(`Failed to save configuration: ${error instanceof Error ? error.message : String(error)}`)
		process.exit(1)
	}
}

function capitalize(str: string): string {
	return str
		.split("-")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ")
}
