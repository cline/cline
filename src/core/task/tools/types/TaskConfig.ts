import type { ApiHandler } from "@core/api"
import type { FileContextTracker } from "@core/context/context-tracking/FileContextTracker"
import type { ClineIgnoreController } from "@core/ignore/ClineIgnoreController"
import type { DiffViewProvider } from "@integrations/editor/DiffViewProvider"
import type { BrowserSession } from "@services/browser/BrowserSession"
import type { UrlContentFetcher } from "@services/browser/UrlContentFetcher"
import type { McpHub } from "@services/mcp/McpHub"
import type { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import type { BrowserSettings } from "@shared/BrowserSettings"
import type { ClineAsk, ClineSay } from "@shared/ExtensionMessage"
import type { FocusChainSettings } from "@shared/FocusChainSettings"
import type { Mode } from "@shared/storage/types"
import type { ClineAskResponse } from "@shared/WebviewMessage"
import * as vscode from "vscode"
import type { ToolUseName } from "../../../assistant-message"
import type { ContextManager } from "../../../context/context-management/ContextManager"
import type { CacheService } from "../../../storage/CacheService"
import type { MessageStateHandler } from "../../message-state"
import type { TaskState } from "../../TaskState"
import type { AutoApprove } from "../../tools/autoApprove"

/**
 * Strongly-typed configuration object passed to tool handlers
 */
export interface TaskConfig {
	// Core identifiers
	taskId: string
	ulid: string
	cwd: string
	mode: Mode
	strictPlanModeEnabled: boolean
	context: vscode.ExtensionContext

	// State management
	taskState: TaskState
	messageState: MessageStateHandler

	// API and services
	api: ApiHandler
	services: TaskServices

	// Settings
	autoApprovalSettings: AutoApprovalSettings
	autoApprover: AutoApprove
	browserSettings: BrowserSettings
	focusChainSettings: FocusChainSettings

	// Callbacks (strongly typed)
	callbacks: TaskCallbacks
}

/**
 * All services available to tool handlers
 */
export interface TaskServices {
	mcpHub: McpHub
	browserSession: BrowserSession
	urlContentFetcher: UrlContentFetcher
	diffViewProvider: DiffViewProvider
	fileContextTracker: FileContextTracker
	clineIgnoreController: ClineIgnoreController
	contextManager: ContextManager
	cacheService: CacheService
}

/**
 * All callback functions available to tool handlers
 */
export interface TaskCallbacks {
	say: (type: ClineSay, text?: string, images?: string[], files?: string[], partial?: boolean) => Promise<number | undefined>

	ask: (
		type: ClineAsk,
		text?: string,
		partial?: boolean,
	) => Promise<{
		response: ClineAskResponse
		text?: string
		images?: string[]
		files?: string[]
	}>

	saveCheckpoint: (isAttemptCompletionMessage?: boolean, completionMessageTs?: number) => Promise<void>

	sayAndCreateMissingParamError: (toolName: ToolUseName, paramName: string, relPath?: string) => Promise<any>

	removeLastPartialMessageIfExistsWithType: (type: "ask" | "say", askOrSay: ClineAsk | ClineSay) => Promise<void>

	executeCommandTool: (command: string) => Promise<[boolean, any]>

	doesLatestTaskCompletionHaveNewChanges: () => Promise<boolean>

	updateFCListFromToolResponse: (taskProgress: string | undefined) => Promise<void>

	shouldAutoApproveToolWithPath: (toolName: ToolUseName, path?: string) => Promise<boolean>

	// Additional callbacks for task management
	postStateToWebview: () => Promise<void>
	reinitExistingTaskFromId: (taskId: string) => Promise<void>
	cancelTask: () => Promise<void>
	updateTaskHistory: (update: any) => Promise<any[]>
}

/**
 * Runtime validation function to ensure config has all required properties
 */
export function validateTaskConfig(config: any): asserts config is TaskConfig {
	if (!config) {
		throw new Error("TaskConfig is null or undefined")
	}

	// Core identifiers
	if (!config.taskId) {
		throw new Error("Missing taskId in TaskConfig")
	}
	if (!config.ulid) {
		throw new Error("Missing ulid in TaskConfig")
	}
	if (!config.cwd) {
		throw new Error("Missing cwd in TaskConfig")
	}
	if (!config.mode) {
		throw new Error("Missing mode in TaskConfig")
	}
	if (typeof config.strictPlanModeEnabled !== "boolean") {
		throw new Error("Missing strictPlanModeEnabled in TaskConfig")
	}
	if (!config.context) {
		throw new Error("Missing context in TaskConfig")
	}

	// State management
	if (!config.taskState) {
		throw new Error("Missing taskState in TaskConfig")
	}
	if (!config.messageState) {
		throw new Error("Missing messageState in TaskConfig")
	}

	// API and services
	if (!config.api) {
		throw new Error("Missing api in TaskConfig")
	}
	if (!config.services) {
		throw new Error("Missing services in TaskConfig")
	}

	// Validate services
	const services = config.services
	if (!services.mcpHub) {
		throw new Error("Missing services.mcpHub in TaskConfig")
	}
	if (!services.browserSession) {
		throw new Error("Missing services.browserSession in TaskConfig")
	}
	if (!services.urlContentFetcher) {
		throw new Error("Missing services.urlContentFetcher in TaskConfig")
	}
	if (!services.diffViewProvider) {
		throw new Error("Missing services.diffViewProvider in TaskConfig")
	}
	if (!services.fileContextTracker) {
		throw new Error("Missing services.fileContextTracker in TaskConfig")
	}
	if (!services.clineIgnoreController) {
		throw new Error("Missing services.clineIgnoreController in TaskConfig")
	}
	if (!services.contextManager) {
		throw new Error("Missing services.contextManager in TaskConfig")
	}
	if (!services.cacheService) {
		throw new Error("Missing services.cacheService in TaskConfig")
	}

	// Settings
	if (!config.autoApprovalSettings) {
		throw new Error("Missing autoApprovalSettings in TaskConfig")
	}
	if (!config.autoApprover) {
		throw new Error("Missing autoApprover in TaskConfig")
	}
	if (!config.browserSettings) {
		throw new Error("Missing browserSettings in TaskConfig")
	}
	if (!config.focusChainSettings) {
		throw new Error("Missing focusChainSettings in TaskConfig")
	}

	// Callbacks
	if (!config.callbacks) {
		throw new Error("Missing callbacks in TaskConfig")
	}
	const callbacks = config.callbacks
	if (typeof callbacks.say !== "function") {
		throw new Error("Missing callbacks.say in TaskConfig")
	}
	if (typeof callbacks.ask !== "function") {
		throw new Error("Missing callbacks.ask in TaskConfig")
	}
	if (typeof callbacks.saveCheckpoint !== "function") {
		throw new Error("Missing callbacks.saveCheckpoint in TaskConfig")
	}
	if (typeof callbacks.sayAndCreateMissingParamError !== "function") {
		throw new Error("Missing callbacks.sayAndCreateMissingParamError in TaskConfig")
	}
	if (typeof callbacks.removeLastPartialMessageIfExistsWithType !== "function") {
		throw new Error("Missing callbacks.removeLastPartialMessageIfExistsWithType in TaskConfig")
	}
	if (typeof callbacks.executeCommandTool !== "function") {
		throw new Error("Missing callbacks.executeCommandTool in TaskConfig")
	}
	if (typeof callbacks.doesLatestTaskCompletionHaveNewChanges !== "function") {
		throw new Error("Missing callbacks.doesLatestTaskCompletionHaveNewChanges in TaskConfig")
	}
	if (typeof callbacks.updateFCListFromToolResponse !== "function") {
		throw new Error("Missing callbacks.updateFCListFromToolResponse in TaskConfig")
	}
	if (typeof callbacks.shouldAutoApproveToolWithPath !== "function") {
		throw new Error("Missing callbacks.shouldAutoApproveToolWithPath in TaskConfig")
	}
}
