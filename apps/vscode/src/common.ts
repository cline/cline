import { WebviewProvider } from "./core/webview"
import "./utils/path" // necessary to have access to String.prototype.toPosix

import { setSdkLogger } from "@bedrock-coder/core"
import { HostProvider } from "@/hosts/host-provider"
import { Logger } from "@/shared/services/Logger"
import type { StorageContext } from "@/shared/storage/storage-context"
import { HookDiscoveryCache } from "./core/hooks/HookDiscoveryCache"
import { HookProcessRegistry } from "./core/hooks/HookProcessRegistry"
import { StateManager } from "./core/storage/StateManager"
import { AgentConfigLoader } from "./core/task/tools/subagent/AgentConfigLoader"
import { BedrockCoderTempManager } from "./services/temp"
import { ShowMessageType } from "./shared/proto/host/window"
import { arePathsEqual } from "./utils/path"

/**
 * Performs intialization for BedrockCoder that is common to all platforms.
 *
 * @param context
 * @returns The webview provider
 * @throws BedrockCoderConfigurationError if endpoints.json exists but is invalid
 */
export async function initialize(storageContext: StorageContext): Promise<WebviewProvider> {
	// Configure the shared Logging class to use HostProvider's output channels and debug logger
	Logger.subscribe((msg: string) => HostProvider.get().logToChannel(msg)) // File system logging
	Logger.subscribe((msg: string) => HostProvider.env.debugLog({ value: msg })) // Host debug logging

	// Register the SDK early logger so diagnostic events from
	// Bedrock settings, MCP OAuth, and local runtime state
	// flow through Logger.debug → BedrockCoder output channel.
	// These components operate before/outside of BedrockCoderCore sessions, so the
	// session-scoped logger can't reach them.
	setSdkLogger({
		debug: (message) => Logger.debug(message),
		log: (message) => Logger.log(message),
		error: (message) => Logger.error(message),
	})

	try {
		await StateManager.initialize(storageContext)
	} catch (error) {
		Logger.error("[Bedrock Coder] CRITICAL: Failed to initialize StateManager:", error)
		HostProvider.window.showMessage({
			type: ShowMessageType.ERROR,
			message: "Failed to initialize storage. Please check logs for details or try restarting the client.",
		})
	}

	// Register host-only SDK provider handlers (e.g. VS Code Language Model API),
	// which depend on the `vscode` module and cannot live in the SDK package.
	// Must run before any handler is built (standalone utilities or task loop).

	// =============== Webview services ===============
	const webview = HostProvider.get().createWebviewProvider()

	const stateManager = StateManager.get()
	// Check if this workspace was opened from worktree quick launch
	await checkWorktreeAutoOpen(stateManager)

	// Clean up old temp files in background (non-blocking) and start periodic cleanup every 24 hours
	BedrockCoderTempManager.startPeriodicCleanup()

	return webview
}

/**
 * Checks if this workspace was opened from the worktree quick launch button.
 * If so, opens the BedrockCoder sidebar and clears the state.
 */
async function checkWorktreeAutoOpen(stateManager: StateManager): Promise<void> {
	try {
		// Read directly from globalState (not StateManager cache) since this may have been
		// set by another window right before this one opened
		const worktreeAutoOpenPath = stateManager.getGlobalStateKey("worktreeAutoOpenPath")
		if (!worktreeAutoOpenPath) {
			return
		}

		// Get current workspace path
		const workspacePaths = (await HostProvider.workspace.getWorkspacePaths({})).paths
		if (workspacePaths.length === 0) {
			return
		}

		const currentPath = workspacePaths[0]

		// Check if current workspace matches the worktree path
		if (arePathsEqual(currentPath, worktreeAutoOpenPath)) {
			// Clear the state first to prevent re-triggering
			stateManager.setGlobalState("worktreeAutoOpenPath", undefined)
			// Open the BedrockCoder sidebar
			await HostProvider.workspace.openBedrockCoderSidebarPanel({})
		}
	} catch (error) {
		Logger.error("Error checking worktree auto-open", error)
	}
}

/**
 * Performs cleanup when BedrockCoder is deactivated that is common to all platforms.
 */
export async function tearDown(): Promise<void> {
	try {
		AgentConfigLoader.getInstance()?.dispose()
		// Dispose all webview instances
		await WebviewProvider.disposeAllInstances()

		// Kill any running hook processes to prevent zombies
		await HookProcessRegistry.terminateAll()
		// Clean up hook discovery cache
		HookDiscoveryCache.getInstance().dispose()
		// Stop periodic temp file cleanup
		BedrockCoderTempManager.stopPeriodicCleanup()
	} finally {
		try {
			await StateManager.get().flushPendingState()
		} catch (error) {
			Logger.error("[Bedrock Coder] Failed to flush pending state during teardown:", error)
		}
	}
}
