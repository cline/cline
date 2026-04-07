/**
 * InboundMessageHandler — processes typed messages from the webview.
 *
 * This replaces the gRPC request routing on the extension side.
 * Each message type maps to a handler method that delegates to the
 * SdkController or its subsystems.
 *
 * The handler returns true if the message was recognized and handled,
 * false otherwise (allowing fallback to the gRPC compat layer).
 */

import { Logger } from "@shared/services/Logger"
import type {
	AccountOpMessage,
	AskResponseMessage,
	BrowserOpMessage,
	CancelTaskMessage,
	CheckpointOpMessage,
	ClearTaskMessage,
	DeleteTasksMessage,
	FileOpMessage,
	GetTaskHistoryMessage,
	McpOpMessage,
	NewTaskMessage,
	ReadyMessage,
	RefreshModelsMessage,
	RuleOpMessage,
	ShowTaskMessage,
	SlashCommandMessage,
	StateOpMessage,
	TaskOpMessage,
	ToggleFavoriteModelMessage,
	ToggleModeMessage,
	UiOpMessage,
	UpdateApiConfigMessage,
	UpdateAutoApprovalMessage,
	UpdateSettingsMessage,
	UpdateTelemetryMessage,
	WebOpMessage,
	WebviewInbound,
	WorktreeOpMessage,
} from "../shared/WebviewMessages"
import type { WebviewBridge } from "./webview-bridge"

/**
 * Interface for the controller that handles inbound messages.
 * This allows the handler to work with any controller implementation
 * (SdkController, classic Controller, test mocks, etc.)
 */
export interface InboundController {
	// Task operations
	initTask?(text: string, images?: string[]): Promise<string | undefined>
	askResponse?(response: string, text?: string, images?: string[]): Promise<void>
	cancelTask?(): Promise<void>
	clearTask?(): Promise<void>
	showTask?(id: string): Promise<void>
	deleteTasks?(ids: string[], all?: boolean): Promise<void>
	getTaskHistory?(offset?: number, limit?: number): Promise<unknown>

	// Settings
	updateApiConfig?(config: Record<string, unknown>): Promise<void>
	toggleMode?(mode: string): Promise<boolean>
	updateSettings?(settings: Record<string, unknown>): Promise<void>
	updateAutoApproval?(settings: Record<string, unknown>): Promise<void>
	updateTelemetry?(value: string): Promise<void>
	toggleFavoriteModel?(modelId: string): Promise<void>

	// Models
	refreshModels?(providerId: string, params?: Record<string, unknown>): Promise<void>

	// State
	pushStateToWebview?(): Promise<void>

	// Generic handler for operations not yet typed
	handleGenericOp?(type: string, op: string, requestId?: string, params?: Record<string, unknown>): Promise<unknown>
}

export class InboundMessageHandler {
	private controller: InboundController
	private bridge: WebviewBridge

	constructor(controller: InboundController, bridge: WebviewBridge) {
		this.controller = controller
		this.bridge = bridge
	}

	/**
	 * Handle a typed message from the webview.
	 * Returns true if handled, false if the message type is unrecognized.
	 */
	async handle(message: WebviewInbound): Promise<boolean> {
		try {
			switch (message.type) {
				case "ready":
					return await this.handleReady(message)
				case "newTask":
					return await this.handleNewTask(message)
				case "askResponse":
					return await this.handleAskResponse(message)
				case "cancelTask":
					return await this.handleCancelTask(message)
				case "clearTask":
					return await this.handleClearTask(message)
				case "showTask":
					return await this.handleShowTask(message)
				case "deleteTasks":
					return await this.handleDeleteTasks(message)
				case "getTaskHistory":
					return await this.handleGetTaskHistory(message)
				case "updateApiConfig":
					return await this.handleUpdateApiConfig(message)
				case "toggleMode":
					return await this.handleToggleMode(message)
				case "updateSettings":
					return await this.handleUpdateSettings(message)
				case "updateAutoApproval":
					return await this.handleUpdateAutoApproval(message)
				case "updateTelemetry":
					return await this.handleUpdateTelemetry(message)
				case "toggleFavoriteModel":
					return await this.handleToggleFavoriteModel(message)
				case "refreshModels":
					return await this.handleRefreshModels(message)

				// Delegate generic operations
				case "fileOp":
				case "ruleOp":
				case "mcpOp":
				case "accountOp":
				case "worktreeOp":
				case "checkpointOp":
				case "slashCommand":
				case "webOp":
				case "browserOp":
				case "uiOp":
				case "stateOp":
				case "taskOp":
					return await this.handleGenericOp(message)

				default:
					return false
			}
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error)
			Logger.error(`Error handling typed message "${message.type}":`, errorMsg)

			// If the message has a requestId, send an error response
			if ("requestId" in message && (message as any).requestId) {
				this.bridge.sendRpcResponse((message as any).requestId, message.type, undefined, errorMsg)
			}
			return true // We handled it (with an error)
		}
	}

	// -----------------------------------------------------------------------
	// Individual handlers
	// -----------------------------------------------------------------------

	private async handleReady(_msg: ReadyMessage): Promise<boolean> {
		if (this.controller.pushStateToWebview) {
			await this.controller.pushStateToWebview()
		}
		return true
	}

	private async handleNewTask(msg: NewTaskMessage): Promise<boolean> {
		if (this.controller.initTask) {
			await this.controller.initTask(msg.text, msg.images)
		}
		return true
	}

	private async handleAskResponse(msg: AskResponseMessage): Promise<boolean> {
		if (this.controller.askResponse) {
			await this.controller.askResponse(msg.response, msg.text, msg.images)
		}
		return true
	}

	private async handleCancelTask(_msg: CancelTaskMessage): Promise<boolean> {
		if (this.controller.cancelTask) {
			await this.controller.cancelTask()
		}
		return true
	}

	private async handleClearTask(_msg: ClearTaskMessage): Promise<boolean> {
		if (this.controller.clearTask) {
			await this.controller.clearTask()
		}
		return true
	}

	private async handleShowTask(msg: ShowTaskMessage): Promise<boolean> {
		if (this.controller.showTask) {
			await this.controller.showTask(msg.id)
		}
		return true
	}

	private async handleDeleteTasks(msg: DeleteTasksMessage): Promise<boolean> {
		if (this.controller.deleteTasks) {
			await this.controller.deleteTasks(msg.ids, msg.all)
		}
		return true
	}

	private async handleGetTaskHistory(msg: GetTaskHistoryMessage): Promise<boolean> {
		if (this.controller.getTaskHistory) {
			const result = await this.controller.getTaskHistory(msg.offset, msg.limit)
			if ("requestId" in msg && (msg as any).requestId) {
				this.bridge.sendRpcResponse((msg as any).requestId, "getTaskHistory", result)
			}
		}
		return true
	}

	private async handleUpdateApiConfig(msg: UpdateApiConfigMessage): Promise<boolean> {
		if (this.controller.updateApiConfig) {
			await this.controller.updateApiConfig(msg.config as Record<string, unknown>)
		}
		return true
	}

	private async handleToggleMode(msg: ToggleModeMessage): Promise<boolean> {
		if (this.controller.toggleMode) {
			const result = await this.controller.toggleMode(msg.mode)
			if ("requestId" in msg && (msg as any).requestId) {
				this.bridge.sendRpcResponse((msg as any).requestId, "toggleMode", result)
			}
		}
		return true
	}

	private async handleUpdateSettings(msg: UpdateSettingsMessage): Promise<boolean> {
		if (this.controller.updateSettings) {
			await this.controller.updateSettings(msg.settings)
		}
		return true
	}

	private async handleUpdateAutoApproval(msg: UpdateAutoApprovalMessage): Promise<boolean> {
		if (this.controller.updateAutoApproval) {
			await this.controller.updateAutoApproval(msg.settings as Record<string, unknown>)
		}
		return true
	}

	private async handleUpdateTelemetry(msg: UpdateTelemetryMessage): Promise<boolean> {
		if (this.controller.updateTelemetry) {
			await this.controller.updateTelemetry(msg.value)
		}
		return true
	}

	private async handleToggleFavoriteModel(msg: ToggleFavoriteModelMessage): Promise<boolean> {
		if (this.controller.toggleFavoriteModel) {
			await this.controller.toggleFavoriteModel(msg.modelId)
		}
		return true
	}

	private async handleRefreshModels(msg: RefreshModelsMessage): Promise<boolean> {
		if (this.controller.refreshModels) {
			await this.controller.refreshModels(msg.providerId, msg.params)
		}
		return true
	}

	private async handleGenericOp(
		msg:
			| FileOpMessage
			| RuleOpMessage
			| McpOpMessage
			| AccountOpMessage
			| WorktreeOpMessage
			| CheckpointOpMessage
			| SlashCommandMessage
			| WebOpMessage
			| BrowserOpMessage
			| UiOpMessage
			| StateOpMessage
			| TaskOpMessage,
	): Promise<boolean> {
		if (this.controller.handleGenericOp) {
			const op = "op" in msg ? msg.op : "command" in msg ? msg.command : "unknown"
			const requestId = "requestId" in msg ? msg.requestId : undefined
			const params = "params" in msg ? msg.params : "value" in msg ? { value: msg.value } : undefined
			const result = await this.controller.handleGenericOp(msg.type, op, requestId, params)
			if (requestId) {
				this.bridge.sendRpcResponse(requestId, `${msg.type}.${op}`, result)
			}
		}
		return true
	}
}
