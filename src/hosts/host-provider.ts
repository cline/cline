import { WebviewProvider } from "@core/webview"
import { HostBridgeClientProvider } from "./host-provider-types"
import { WebviewProviderType } from "@/shared/webview/types"
import { DiffViewProvider } from "@/integrations/editor/DiffViewProvider"

export class HostProvider {
	private static instance: HostProvider | null = null

	createWebviewProvider: WebviewProviderCreator
	createDiffViewProvider: DiffViewProviderCreator
	hostBridge: HostBridgeClientProvider

	// Private constructor to enforce singleton pattern
	private constructor(
		createWebviewProvider: WebviewProviderCreator,
		createDiffViewProvider: DiffViewProviderCreator,
		hostBridge: HostBridgeClientProvider,
	) {
		this.createWebviewProvider = createWebviewProvider
		this.createDiffViewProvider = createDiffViewProvider
		this.hostBridge = hostBridge
	}

	public static initialize(
		webviewProviderCreator: WebviewProviderCreator,
		diffViewProviderCreator: DiffViewProviderCreator,
		hostBridgeProvider: HostBridgeClientProvider,
	): HostProvider {
		if (HostProvider.instance) {
			throw new Error("Host providers have already been initialized")
		}
		HostProvider.instance = new HostProvider(webviewProviderCreator, diffViewProviderCreator, hostBridgeProvider)
		return HostProvider.instance
	}

	/**
	 * Gets the singleton instance
	 */
	public static get(): HostProvider {
		if (!HostProvider.instance) {
			throw new Error("HostProvider not initialized. Call HostProvider.initialize() first.")
		}
		return HostProvider.instance
	}

	/**
	 * Gets the singleton instance
	 */
	public static isInitialized(): boolean {
		return !!HostProvider.instance
	}

	// Static service accessors for even shorter access
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
