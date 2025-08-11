import { WebviewProvider } from "@/core/webview"
import { HostBridgeClientProvider } from "./host-provider-types"
import { WebviewProviderType } from "@/shared/webview/types"
import { DiffViewProvider } from "@/integrations/editor/DiffViewProvider"

/**
 * Singleton class that manages host-specific providers for dependency injection.
 *
 * This system runs on two different platforms (VSCode extension and cline-core),
 * so all the host-specific classes and properties are contained in here. The
 * rest of the codebase can use the host provider interface to access platform-specific
 * implementations in a platform-agnostic way.
 *
 * Usage:
 * - Initialize once: HostProvider.initialize(webviewCreator, diffCreator, hostBridge)
 * - Access HostBridge services: HostProvider.window.showMessage()
 * - Access Host Provider factories: HostProvider.get().createDiffViewProvider()
 */
export class HostProvider {
	private static instance: HostProvider | null = null

	createWebviewProvider: WebviewProviderCreator
	createDiffViewProvider: DiffViewProviderCreator
	hostBridge: HostBridgeClientProvider

	// Logs to a user-visible output channel.
	logToChannel: LogToChannel

	// Returns a callback URI that will redirect to Cline.
	getCallbackUri: () => Promise<string>

	// Private constructor to enforce singleton pattern
	private constructor(
		createWebviewProvider: WebviewProviderCreator,
		createDiffViewProvider: DiffViewProviderCreator,
		hostBridge: HostBridgeClientProvider,
		logToChannel: LogToChannel,
		getCallbackUri: () => Promise<string>,
	) {
		this.createWebviewProvider = createWebviewProvider
		this.createDiffViewProvider = createDiffViewProvider
		this.hostBridge = hostBridge
		this.logToChannel = logToChannel
		this.getCallbackUri = getCallbackUri
	}

	public static initialize(
		webviewProviderCreator: WebviewProviderCreator,
		diffViewProviderCreator: DiffViewProviderCreator,
		hostBridgeProvider: HostBridgeClientProvider,
		logToChannel: LogToChannel,
		getCallbackUri: () => Promise<string>,
	): HostProvider {
		if (HostProvider.instance) {
			throw new Error("Host providers have already been initialized.")
		}
		HostProvider.instance = new HostProvider(
			webviewProviderCreator,
			diffViewProviderCreator,
			hostBridgeProvider,
			logToChannel,
			getCallbackUri,
		)
		return HostProvider.instance
	}

	/**
	 * Gets the singleton instance
	 */
	public static get(): HostProvider {
		if (!HostProvider.instance) {
			throw new Error("HostProvider not setup. Call HostProvider.initialize() first.")
		}
		return HostProvider.instance
	}

	public static isInitialized(): boolean {
		return !!HostProvider.instance
	}

	/**
	 * Resets the HostProvider instance (primarily for testing)
	 * This allows tests to reinitialize the HostProvider with different configurations
	 */
	public static reset(): void {
		HostProvider.instance = null
	}

	// Static service accessors for more concise access for callers.
	public static get watch() {
		return HostProvider.get().hostBridge.watchServiceClient
	}

	public static get workspace() {
		return HostProvider.get().hostBridge.workspaceClient
	}

	public static get env() {
		return HostProvider.get().hostBridge.envClient
	}

	public static get window() {
		return HostProvider.get().hostBridge.windowClient
	}

	public static get diff() {
		return HostProvider.get().hostBridge.diffClient
	}
}

/**
 * A function that creates WebviewProvider instances
 */
export type WebviewProviderCreator = (providerType: WebviewProviderType) => WebviewProvider

/**
 * A function that creates DiffViewProvider instances
 */
export type DiffViewProviderCreator = () => DiffViewProvider

export type LogToChannel = (message: string) => void
