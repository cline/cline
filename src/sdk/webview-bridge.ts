/**
 * WebviewBridge — sends typed messages from the extension to the webview.
 *
 * This replaces the gRPC streaming response pattern with simple typed
 * postMessage calls. The bridge is protocol-agnostic: it works with any
 * postMessage transport (VSCode webview, JetBrains bridge, CLI, etc.).
 *
 * Usage:
 *   const bridge = new WebviewBridge(postMessage)
 *   bridge.pushState(extensionState)
 *   bridge.pushPartialMessage(clineMessage)
 *   bridge.navigate("settings")
 */

import type { ClineMessage, ExtensionState } from "../shared/ExtensionMessage"
import type { ModelInfo } from "../shared/api"
import type { McpMarketplaceCatalog, McpServer, McpViewTab } from "../shared/mcp"
import type {
	WebviewOutbound,
	StateMessage,
	PartialMessage,
	NavigateMessage,
	McpServersMessage,
	McpMarketplaceMessage,
	ModelsMessage,
	RelinquishControlMessage,
	AddToInputMessage,
	ShowWebviewMessage,
	TerminalProfilesMessage,
	RpcResponseMessage,
} from "../shared/WebviewMessages"

export type PostMessageFn = (message: WebviewOutbound) => void

export class WebviewBridge {
	private postMessage: PostMessageFn

	constructor(postMessage: PostMessageFn) {
		this.postMessage = postMessage
	}

	/** Update the postMessage function (e.g., when webview is recreated) */
	setPostMessage(fn: PostMessageFn): void {
		this.postMessage = fn
	}

	// -----------------------------------------------------------------------
	// State push (Unit 9a)
	// -----------------------------------------------------------------------

	/** Push full extension state to the webview */
	pushState(state: ExtensionState): void {
		this.postMessage({
			type: "state",
			state,
		} satisfies StateMessage)
	}

	// -----------------------------------------------------------------------
	// Partial message (Unit 9b)
	// -----------------------------------------------------------------------

	/** Push a partial/streaming message update */
	pushPartialMessage(message: ClineMessage): void {
		this.postMessage({
			type: "partialMessage",
			message,
		} satisfies PartialMessage)
	}

	// -----------------------------------------------------------------------
	// Navigation
	// -----------------------------------------------------------------------

	/** Navigate the webview to a specific view */
	navigate(view: NavigateMessage["view"], opts?: { tab?: McpViewTab; targetSection?: string }): void {
		this.postMessage({
			type: "navigate",
			view,
			tab: opts?.tab,
			targetSection: opts?.targetSection,
		} satisfies NavigateMessage)
	}

	// -----------------------------------------------------------------------
	// MCP
	// -----------------------------------------------------------------------

	/** Push MCP servers update */
	pushMcpServers(servers: McpServer[]): void {
		this.postMessage({
			type: "mcpServers",
			servers,
		} satisfies McpServersMessage)
	}

	/** Push MCP marketplace catalog update */
	pushMcpMarketplace(catalog: McpMarketplaceCatalog): void {
		this.postMessage({
			type: "mcpMarketplace",
			catalog,
		} satisfies McpMarketplaceMessage)
	}

	// -----------------------------------------------------------------------
	// Models (Unit 9c)
	// -----------------------------------------------------------------------

	/** Push model list update for a specific provider */
	pushModels(providerId: string, models: Record<string, ModelInfo>): void {
		this.postMessage({
			type: "models",
			providerId,
			models,
		} satisfies ModelsMessage)
	}

	// -----------------------------------------------------------------------
	// Events
	// -----------------------------------------------------------------------

	/** Signal relinquish control */
	pushRelinquishControl(): void {
		this.postMessage({
			type: "relinquishControl",
		} satisfies RelinquishControlMessage)
	}

	/** Add text to the input area */
	pushAddToInput(text: string): void {
		this.postMessage({
			type: "addToInput",
			text,
		} satisfies AddToInputMessage)
	}

	/** Signal show webview */
	pushShowWebview(view?: string): void {
		this.postMessage({
			type: "showWebview",
			view,
		} satisfies ShowWebviewMessage)
	}

	/** Push available terminal profiles */
	pushTerminalProfiles(profiles: Array<{ id: string; name: string; path?: string; description?: string }>): void {
		this.postMessage({
			type: "terminalProfiles",
			profiles,
		} satisfies TerminalProfilesMessage)
	}

	// -----------------------------------------------------------------------
	// Generic RPC response (Unit 9d transition)
	// -----------------------------------------------------------------------

	/** Send an RPC response back to the webview (for request/response patterns) */
	sendRpcResponse(requestId: string, method: string, data?: unknown, error?: string): void {
		this.postMessage({
			type: "rpcResponse",
			requestId,
			method,
			data,
			error,
		} satisfies RpcResponseMessage)
	}
}
