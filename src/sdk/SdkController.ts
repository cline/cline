// Replaces classic src/core/controller/index.ts (see origin/main)
//
// This is the SDK-backed Controller. It provides the same interface as the
// classic Controller but delegates to the Cline SDK (@clinebot/core).
//
// During migration, unimplemented methods log warnings. The extension will
// compile and load, but functionality is added incrementally in Steps 4-8.

import type { ModelInfo } from "@shared/api"
import type { ChatContent } from "@shared/ChatContent"
import type { ExtensionState } from "@shared/ExtensionMessage"
import type { HistoryItem } from "@shared/HistoryItem"
import type { McpMarketplaceCatalog } from "@shared/mcp"
import type { Settings } from "@shared/storage/state-keys"
import type { Mode } from "@shared/storage/types"
import type { TelemetrySetting } from "@shared/TelemetrySetting"
import type { UserInfo } from "@shared/UserInfo"
import { StateManager } from "@/core/storage/StateManager"
import { ClineExtensionContext } from "@/shared/cline"
import { Logger } from "@/shared/services/Logger"

/**
 * Log a stub warning and return undefined.
 */
function stubWarn(name: string): void {
	Logger.warn(`[SdkController] STUB: ${name} not yet implemented`)
}

export class Controller {
	task?: any // Will be typed to SDK session when implemented in Step 4

	mcpHub: any // Replaced by SDK MCP manager in Step 7
	accountService: any // Replaced by SDK account service in Step 6
	authService: any // Replaced by SDK auth in Step 6
	ocaAuthService: any // Replaced by SDK auth in Step 6
	readonly stateManager: StateManager

	// Private state kept for stub compatibility
	private backgroundCommandRunning = false
	private backgroundCommandTaskId?: string

	constructor(readonly context: ClineExtensionContext) {
		// StateManager must be initialized before creating the Controller
		this.stateManager = StateManager.get()

		// Services will be properly initialized in later steps.
		// For now, set to undefined so the extension compiles and loads.
		this.mcpHub = undefined
		this.accountService = undefined
		this.authService = undefined
		this.ocaAuthService = undefined

		Logger.log("[SdkController] Initialized with SDK adapter layer")
	}

	async dispose(): Promise<void> {
		await this.clearTask()
		this.mcpHub?.dispose?.()
		Logger.log("[SdkController] Disposed")
	}

	async handleSignOut(): Promise<void> {
		stubWarn("handleSignOut")
		await this.postStateToWebview()
	}

	async handleOcaSignOut(): Promise<void> {
		stubWarn("handleOcaSignOut")
		await this.postStateToWebview()
	}

	async setUserInfo(_info?: UserInfo): Promise<void> {
		stubWarn("setUserInfo")
	}

	// ---- Task lifecycle (Step 4) ----

	async initTask(
		_task?: string,
		_images?: string[],
		_files?: string[],
		_historyItem?: HistoryItem,
		_taskSettings?: Partial<Settings>,
	): Promise<string | undefined> {
		stubWarn("initTask")
		return undefined
	}

	async reinitExistingTaskFromId(_taskId: string): Promise<void> {
		stubWarn("reinitExistingTaskFromId")
	}

	async cancelTask(): Promise<void> {
		stubWarn("cancelTask")
	}

	async cancelBackgroundCommand(): Promise<void> {
		stubWarn("cancelBackgroundCommand")
	}

	async clearTask(): Promise<void> {
		stubWarn("clearTask")
	}

	async handleTaskCreation(_prompt: string): Promise<void> {
		stubWarn("handleTaskCreation")
	}

	// ---- Mode switching (Step 8) ----

	async toggleActModeForYoloMode(): Promise<boolean> {
		stubWarn("toggleActModeForYoloMode")
		return false
	}

	async togglePlanActMode(_modeToSwitchTo: Mode, _chatContent?: ChatContent): Promise<boolean> {
		stubWarn("togglePlanActMode")
		return false
	}

	// ---- Telemetry ----

	async updateTelemetrySetting(telemetrySetting: TelemetrySetting): Promise<void> {
		await this.stateManager.setGlobalState("telemetrySetting", telemetrySetting as any)
		await this.postStateToWebview()
	}

	// ---- Auth callbacks (Step 6) ----

	async handleAuthCallback(_customToken: string, _provider: string | null = null): Promise<void> {
		stubWarn("handleAuthCallback")
		await this.postStateToWebview()
	}

	async handleOcaAuthCallback(_code: string, _state: string): Promise<void> {
		stubWarn("handleOcaAuthCallback")
		await this.postStateToWebview()
	}

	async handleMcpOAuthCallback(_serverHash: string, _code: string, _state: string | null): Promise<void> {
		stubWarn("handleMcpOAuthCallback")
	}

	// ---- MCP marketplace (Step 7) ----

	async refreshMcpMarketplace(_sendCatalogEvent: boolean): Promise<McpMarketplaceCatalog | undefined> {
		stubWarn("refreshMcpMarketplace")
		return undefined
	}

	// ---- Provider auth callbacks (Step 6) ----

	async handleOpenRouterCallback(_code: string): Promise<void> {
		stubWarn("handleOpenRouterCallback")
	}

	async handleRequestyCallback(_code: string): Promise<void> {
		stubWarn("handleRequestyCallback")
	}

	async handleHicapCallback(_code: string): Promise<void> {
		stubWarn("handleHicapCallback")
	}

	async readOpenRouterModels(): Promise<Record<string, ModelInfo> | undefined> {
		stubWarn("readOpenRouterModels")
		return undefined
	}

	// ---- Task history (Step 4) ----

	async getTaskWithId(_id: string): Promise<{
		historyItem: HistoryItem
		taskDirPath: string
		apiConversationHistoryFilePath: string
		uiMessagesFilePath: string
		contextHistoryFilePath: string
		taskMetadataFilePath: string
		apiConversationHistory: any[]
	}> {
		stubWarn("getTaskWithId")
		return undefined as any
	}

	async exportTaskWithId(_id: string): Promise<void> {
		stubWarn("exportTaskWithId")
	}

	async deleteTaskFromState(_id: string): Promise<HistoryItem[]> {
		stubWarn("deleteTaskFromState")
		return []
	}

	async updateTaskHistory(_item: HistoryItem): Promise<HistoryItem[]> {
		stubWarn("updateTaskHistory")
		return []
	}

	// ---- Background command state ----

	updateBackgroundCommandState(running: boolean, taskId?: string): void {
		this.backgroundCommandRunning = running
		this.backgroundCommandTaskId = taskId
	}

	// ---- State management ----

	async postStateToWebview(): Promise<void> {
		// Import dynamically to avoid circular deps
		const { sendStateUpdate } = await import("@core/controller/state/subscribeToState")
		const state = await this.getStateToPostToWebview()
		await sendStateUpdate(state)
	}

	async getStateToPostToWebview(): Promise<ExtensionState> {
		// Delegate to the classic implementation which reads from StateManager.
		// This will be gradually replaced with SDK-sourced state in Steps 4-8.
		// For now, we import the classic getStateToPostToWebview logic.
		try {
			const { getStateToPostToWebview: classicGetState } = await import("@core/controller/state/getStateToPostToWebview")
			return await classicGetState({
				task: this.task,
				stateManager: this.stateManager,
				mcpHub: this.mcpHub,
				backgroundCommandRunning: this.backgroundCommandRunning,
				backgroundCommandTaskId: this.backgroundCommandTaskId,
			})
		} catch {
			// Fallback: return minimal state if classic impl not available
			return {} as unknown as ExtensionState
		}
	}

	// ---- Workspace (kept from classic) ----

	async ensureWorkspaceManager(): Promise<any> {
		stubWarn("ensureWorkspaceManager")
		return undefined
	}
}
