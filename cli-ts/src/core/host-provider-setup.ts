import { ExternalCommentReviewController } from "@hosts/external/ExternalCommentReviewController"
import { ExternalWebviewProvider } from "@hosts/external/ExternalWebviewProvider"
import { execSync } from "child_process"
import type { ExtensionContext } from "vscode"
import type { WebviewProvider } from "@/core/webview"
import { AuthHandler } from "@/hosts/external/AuthHandler"
import { HostProvider } from "@/hosts/host-provider"
import type { DiffViewProvider } from "@/integrations/editor/DiffViewProvider"
import { StandaloneTerminalManager } from "@/integrations/terminal"
import { StandaloneDiffViewProvider } from "../integrations/editor/StandaloneDiffViewProvider.js"
import type { Logger } from "../types/logger.js"
import { NOISE_PATTERNS } from "./console-filter.js"
import { StandaloneHostBridgeClient } from "./standalone-hostbridge-client.js"

/**
 * Initialize the HostProvider for CLI mode
 *
 * This sets up the host provider with CLI-appropriate implementations
 * of the various providers (webview, diff view, terminal, etc.)
 *
 * @param extensionContext - VSCode-like extension context
 * @param extensionDir - Directory where the extension is installed
 * @param dataDir - Directory for Cline data storage
 * @param logger - Logger instance for output
 */
export function setupHostProvider(
	extensionContext: ExtensionContext,
	extensionDir: string,
	dataDir: string,
	logger: Logger,
): void {
	const createWebview = (): WebviewProvider => {
		return new ExternalWebviewProvider(extensionContext)
	}

	const createDiffView = (): DiffViewProvider => {
		return new StandaloneDiffViewProvider((message) => logger.info(message))
	}

	const createCommentReview = () => new ExternalCommentReviewController()

	const createTerminalManager = () => new StandaloneTerminalManager()

	const getCallbackUrl = async (): Promise<string> => {
		return AuthHandler.getInstance().getCallbackUrl()
	}

	const getBinaryLocation = async (name: string): Promise<string> => {
		// For ripgrep, use the bundled @vscode/ripgrep package
		if (name === "rg") {
			try {
				// Dynamic import to handle the external module
				const { rgPath } = await import("@vscode/ripgrep")
				return rgPath
			} catch {
				// Fallback to system ripgrep if @vscode/ripgrep is not available
				try {
					return execSync("which rg", { encoding: "utf-8" }).trim()
				} catch {
					throw new Error("ripgrep (rg) not found. Please install it via 'brew install ripgrep' or equivalent.")
				}
			}
		}

		// For other binaries, try to find them in PATH
		try {
			return execSync(`which ${name}`, { encoding: "utf-8" }).trim()
		} catch {
			throw new Error(`Binary '${name}' not found in PATH.`)
		}
	}

	const logToChannel = (message: string): void => {
		// Parse log level from message (format: "LEVEL message...")
		// Core Logger outputs messages as "${level} ${fullMessage}"
		const parts = message.split(" ")
		const level = parts[0]?.toUpperCase()
		const content = parts.slice(1).join(" ")

		// Route to appropriate logger method based on parsed level
		// This respects the CLI's --verbose flag for DEBUG messages
		switch (level) {
			case "DEBUG":
			case "TRACE":
				logger.debug(content)
				break
			case "WARN":
				logger.warn(content)
				break
			case "ERROR":
				logger.error(content)
				break
			case "INFO":
			case "LOG":
			default: {
				// Filter out noisy INFO patterns (they go to debug instead)
				const messageToCheck = content || message
				const isNoise = NOISE_PATTERNS.some((pattern) => messageToCheck.includes(pattern))
				if (isNoise) {
					logger.debug(messageToCheck)
				} else {
					logger.info(messageToCheck)
				}
				break
			}
		}
	}

	HostProvider.initialize(
		createWebview,
		createDiffView,
		createCommentReview,
		createTerminalManager,
		new StandaloneHostBridgeClient(),
		logToChannel,
		getCallbackUrl,
		getBinaryLocation,
		extensionDir,
		dataDir,
	)
}

/**
 * Check if HostProvider is already initialized
 */
export function isHostProviderInitialized(): boolean {
	return HostProvider.isInitialized()
}

/**
 * Reset the HostProvider (primarily for testing)
 */
export function resetHostProvider(): void {
	HostProvider.reset()
}

/**
 * Enable the AuthHandler for OAuth callback support
 * Must be called before initiating any OAuth flows
 */
export function enableAuthHandler(): void {
	AuthHandler.getInstance().setEnabled(true)
}

/**
 * Disable and stop the AuthHandler
 * Should be called when auth is complete or on cleanup
 */
export function disableAuthHandler(): void {
	const handler = AuthHandler.getInstance()
	handler.setEnabled(false)
	handler.stop()
}
