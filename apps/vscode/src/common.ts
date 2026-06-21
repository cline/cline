import { WebviewProvider } from "./core/webview"
import "./utils/path" // necessary to have access to String.prototype.toPosix

import { HostProvider } from "@/hosts/host-provider"
import { Logger } from "@/shared/services/Logger"
import type { StorageContext } from "@/shared/storage/storage-context"

/**
 * Performs initialization for Cline that is common to all platforms.
 *
 * This is the MINIMAL inert-shell version: it only wires up logging,
 * initializes the bundled endpoint configuration, and creates the webview
 * provider so the UI can render. All heavy services (state manager,
 * telemetry, error service, sync worker, hooks, etc.) have been removed.
 *
 * @param _storageContext kept for signature compatibility with callers.
 * @returns The webview provider
 */
export async function initialize(_storageContext: StorageContext): Promise<WebviewProvider> {
	// Configure the shared Logging class to use HostProvider's output channels and debug logger
	Logger.subscribe((msg: string) => HostProvider.get().logToChannel(msg)) // File system logging
	Logger.subscribe((msg: string) => HostProvider.env.debugLog({ value: msg })) // Host debug logging

	// Initialize ClineEndpoint configuration (reads bundled and ~/.cline/endpoints.json if present)
	// This must be done before any other code that calls ClineEnv.config()
	const { ClineEndpoint } = await import("./config")
	await ClineEndpoint.initialize(HostProvider.get().extensionFsPath)

	// =============== Webview services ===============
	const webview = HostProvider.get().createWebviewProvider()

	return webview
}

/**
 * Performs cleanup when Cline is deactivated that is common to all platforms.
 */
export async function tearDown(): Promise<void> {
	// Dispose all webview instances
	await WebviewProvider.disposeAllInstances()
}
