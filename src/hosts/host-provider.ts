import { WebviewProvider } from "@/core/webview"
import { CommentReviewController } from "@/integrations/editor/CommentReviewController"
import { DiffViewProvider } from "@/integrations/editor/DiffViewProvider"
import { ITerminalManager } from "@/integrations/terminal/types"
import { HostBridgeClientProvider } from "./host-provider-types"
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
	createCommentReviewController: CommentReviewControllerCreator
	createTerminalManager: TerminalManagerCreator
	hostBridge: HostBridgeClientProvider

	// Logs to a user-visible output channel.
	logToChannel: LogToChannel

	// Returns a callback URL that will redirect to Cline.
	getCallbackUrl: () => Promise<string>

	// Returns the location of the binary `name`.
	// Use `getBinaryLocation()` from utils/ts.ts instead of using
	// this directly. The helper function correctly handles the file
	// extension on Windows.
	getBinaryLocation: (name: string) => Promise<string>

	// The absolute file system path where the extension is installed.
	// Use to this to get the location of extension assets.
	extensionFsPath: string

	// The absolute file system path where the extension can store global state.
	globalStorageFsPath: string

	// Private constructor to enforce singleton pattern
	private constructor(
		createWebviewProvider: WebviewProviderCreator,
		createDiffViewProvider: DiffViewProviderCreator,
		createCommentReviewController: CommentReviewControllerCreator,
		createTerminalManager: TerminalManagerCreator,
		hostBridge: HostBridgeClientProvider,
		logToChannel: LogToChannel,
		getCallbackUrl: () => Promise<string>,
		getBinaryLocation: (name: string) => Promise<string>,
		extensionFsPath: string,
		globalStorageFsPath: string,
	) {
		this.createWebviewProvider = createWebviewProvider
		this.createDiffViewProvider = createDiffViewProvider
		this.createCommentReviewController = createCommentReviewController
		this.createTerminalManager = createTerminalManager
		this.hostBridge = hostBridge
		this.logToChannel = logToChannel
		this.getCallbackUrl = getCallbackUrl
		this.getBinaryLocation = getBinaryLocation
		this.extensionFsPath = extensionFsPath
		this.globalStorageFsPath = globalStorageFsPath
	}

	public static initialize(
		webviewProviderCreator: WebviewProviderCreator,
		diffViewProviderCreator: DiffViewProviderCreator,
		commentReviewControllerCreator: CommentReviewControllerCreator,
		terminalManagerCreator: TerminalManagerCreator,
		hostBridgeProvider: HostBridgeClientProvider,
		logToChannel: LogToChannel,
		getCallbackUrl: () => Promise<string>,
		getBinaryLocation: (name: string) => Promise<string>,
		extensionFsPath: string,
		globalStorageFsPath: string,
	): HostProvider {
		if (HostProvider.instance) {
			throw new Error("Host provider has already been initialized.")
		}
		HostProvider.instance = new HostProvider(
			webviewProviderCreator,
			diffViewProviderCreator,
			commentReviewControllerCreator,
			terminalManagerCreator,
			hostBridgeProvider,
			logToChannel,
			getCallbackUrl,
			getBinaryLocation,
			extensionFsPath,
			globalStorageFsPath,
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
export type WebviewProviderCreator = () => WebviewProvider

/**
 * A function that creates DiffViewProvider instances
 */
export type DiffViewProviderCreator = () => DiffViewProvider

/**
 * A function that creates CommentReviewController instances
 */
export type CommentReviewControllerCreator = () => CommentReviewController

export type LogToChannel = (message: string) => void

/**
 * A function that creates TerminalManager instances
 * Returns the platform-appropriate terminal manager (VSCode TerminalManager or StandaloneTerminalManager)
 */
export type TerminalManagerCreator = () => ITerminalManager
