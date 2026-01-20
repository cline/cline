/**
 * Embedded Controller for CLI
 *
 * This module initializes a Cline Controller directly in the CLI process,
 * allowing CLI commands (chat, send, view) to interact with Cline's AI
 * without requiring a separate gRPC server.
 */

import { initialize, tearDown } from "@/common"
import { Controller } from "@/core/controller"
import type { WebviewProvider } from "@/core/webview"
import { initializeContext } from "@/standalone/vscode-context"
import type { Logger } from "../types/logger.js"
import { isHostProviderInitialized, setupHostProvider } from "./host-provider-setup.js"

// Singleton instance of the embedded controller
let embeddedController: Controller | undefined
let webviewProvider: WebviewProvider | undefined
let initializationPromise: Promise<Controller> | undefined
let isInitializing = false

/**
 * Get or create an embedded Controller instance for CLI usage
 *
 * This function is idempotent - calling it multiple times will return
 * the same Controller instance.
 *
 * @param logger - Logger instance for CLI output
 * @param configDir - Optional custom config directory (defaults to ~/.cline)
 * @returns Promise resolving to the Controller instance
 */
export async function getEmbeddedController(logger: Logger, configDir?: string): Promise<Controller> {
	// Return existing instance if available
	if (embeddedController) {
		return embeddedController
	}

	// Return in-progress initialization if one exists
	if (initializationPromise) {
		return initializationPromise
	}

	// Start new initialization
	initializationPromise = initializeEmbeddedController(logger, configDir)

	try {
		embeddedController = await initializationPromise
		return embeddedController
	} catch (error) {
		// Clear the promise so we can retry
		initializationPromise = undefined
		throw error
	}
}

/**
 * Initialize the embedded Controller
 *
 * @param logger - Logger instance for CLI output
 * @param configDir - Optional custom config directory
 * @returns Promise resolving to the Controller instance
 */
async function initializeEmbeddedController(logger: Logger, configDir?: string): Promise<Controller> {
	if (isInitializing) {
		throw new Error("Controller initialization already in progress")
	}

	isInitializing = true

	try {
		logger.debug("Initializing embedded controller...")

		// Initialize VSCode-like context with storage directories
		const { extensionContext, DATA_DIR, EXTENSION_DIR } = initializeContext(configDir)

		logger.debug(`Using data directory: ${DATA_DIR}`)
		logger.debug(`Using extension directory: ${EXTENSION_DIR}`)

		// Setup HostProvider if not already initialized
		if (!isHostProviderInitialized()) {
			setupHostProvider(extensionContext, EXTENSION_DIR, DATA_DIR, logger)
			logger.debug("HostProvider initialized")
		}

		// Initialize the extension common components and get WebviewProvider
		webviewProvider = await initialize(extensionContext)

		// The controller is available via the webviewProvider
		const controller = webviewProvider.controller

		logger.debug("Embedded controller initialized successfully")

		return controller
	} catch (error) {
		logger.error(`Failed to initialize embedded controller: ${error}`)
		throw error
	} finally {
		isInitializing = false
	}
}

/**
 * Get the current Controller instance without initializing
 *
 * @returns The Controller instance if initialized, undefined otherwise
 */
export function getControllerIfInitialized(): Controller | undefined {
	return embeddedController
}

/**
 * Check if the embedded Controller is initialized
 *
 * @returns true if initialized, false otherwise
 */
export function isControllerInitialized(): boolean {
	return embeddedController !== undefined
}

/**
 * Dispose the embedded Controller and clean up resources
 *
 * This should be called when the CLI process exits to ensure
 * proper cleanup of resources.
 *
 * @param logger - Logger instance for output
 */
export async function disposeEmbeddedController(logger: Logger): Promise<void> {
	if (!embeddedController) {
		return
	}

	try {
		logger.debug("Disposing embedded controller...")

		// Dispose the controller
		await embeddedController.dispose()

		// Tear down common services
		await tearDown()

		embeddedController = undefined
		webviewProvider = undefined
		initializationPromise = undefined

		logger.debug("Embedded controller disposed")
	} catch (error) {
		logger.error(`Error disposing embedded controller: ${error}`)
	}
}

/**
 * Get the WebviewProvider instance
 *
 * The WebviewProvider wraps the Controller and provides access to
 * the webview-related functionality.
 *
 * @returns The WebviewProvider instance if initialized, undefined otherwise
 */
export function getWebviewProvider(): WebviewProvider | undefined {
	return webviewProvider
}

/**
 * Initialize only the HostProvider for lightweight CLI operations
 *
 * This is a minimal initialization that sets up just enough infrastructure
 * to read task history and messages from disk, without initializing the
 * full Controller (which starts MCP servers, etc.)
 *
 * Use this for read-only operations like `task dump` and `task list`.
 *
 * @param logger - Logger instance for CLI output
 * @param configDir - Optional custom config directory (defaults to ~/.cline)
 */
export function initializeHostProviderOnly(logger: Logger, configDir?: string): void {
	if (isHostProviderInitialized()) {
		return
	}

	const { extensionContext, DATA_DIR, EXTENSION_DIR } = initializeContext(configDir)

	logger.debug(`Using data directory: ${DATA_DIR}`)
	logger.debug(`Using extension directory: ${EXTENSION_DIR}`)

	setupHostProvider(extensionContext, EXTENSION_DIR, DATA_DIR, logger)
	logger.debug("HostProvider initialized (lightweight mode)")
}
