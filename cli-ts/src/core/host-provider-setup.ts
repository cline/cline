import { ExternalCommentReviewController } from "@hosts/external/ExternalCommentReviewController"
import { ExternalDiffViewProvider } from "@hosts/external/ExternalDiffviewProvider"
import { ExternalWebviewProvider } from "@hosts/external/ExternalWebviewProvider"
import path from "path"
import type { ExtensionContext } from "vscode"
import type { WebviewProvider } from "@/core/webview"
import { HostProvider } from "@/hosts/host-provider"
import type { DiffViewProvider } from "@/integrations/editor/DiffViewProvider"
import { StandaloneTerminalManager } from "@/integrations/terminal"
import type { Logger } from "../types/logger.js"
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
		return new ExternalDiffViewProvider()
	}

	const createCommentReview = () => new ExternalCommentReviewController()

	const createTerminalManager = () => new StandaloneTerminalManager()

	const getCallbackUrl = async (): Promise<string> => {
		// CLI mode doesn't use auth callbacks yet
		return ""
	}

	const getBinaryLocation = async (name: string): Promise<string> => {
		return path.join(process.cwd(), name)
	}

	const logToChannel = (message: string): void => {
		logger.info(message)
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
