import * as vscode from "vscode"
import { McpHub } from "./McpHub"
import { ClineProvider } from "../../core/webview/ClineProvider"

/**
 * Singleton manager for MCP server instances.
 * Ensures only one set of MCP servers runs across all webviews.
 */
export class McpServerManager {
	private static instance: McpHub | null = null
	private static readonly GLOBAL_STATE_KEY = "mcpHubInstanceId"
	private static providers: Set<ClineProvider> = new Set()

	/**
	 * Get the singleton McpHub instance.
	 * Creates a new instance if one doesn't exist.
	 */
	static async getInstance(context: vscode.ExtensionContext, provider: ClineProvider): Promise<McpHub> {
		// Register the provider
		this.providers.add(provider)

		if (!this.instance) {
			this.instance = new McpHub(provider)
			// Store a unique identifier in global state to track the primary instance
			await context.globalState.update(this.GLOBAL_STATE_KEY, Date.now().toString())
		}
		return this.instance
	}

	/**
	 * Remove a provider from the tracked set.
	 * This is called when a webview is disposed.
	 */
	static unregisterProvider(provider: ClineProvider): void {
		this.providers.delete(provider)
	}

	/**
	 * Notify all registered providers of server state changes.
	 */
	static notifyProviders(message: any): void {
		this.providers.forEach((provider) => {
			provider.postMessageToWebview(message).catch((error) => {
				console.error("Failed to notify provider:", error)
			})
		})
	}

	/**
	 * Clean up the singleton instance and all its resources.
	 */
	static async cleanup(context: vscode.ExtensionContext): Promise<void> {
		if (this.instance) {
			await this.instance.dispose()
			this.instance = null
			await context.globalState.update(this.GLOBAL_STATE_KEY, undefined)
		}
		this.providers.clear()
	}
}
