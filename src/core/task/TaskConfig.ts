import type * as vscode from "vscode"
import type { ApiHandler } from "@api/index"
import type { McpHub } from "@services/mcp/McpHub"
import type { BrowserSession } from "@services/browser/BrowserSession"
import type { DiffViewProvider } from "@integrations/editor/DiffViewProvider"
import type { FileContextTracker } from "@core/context/context-tracking/FileContextTracker"
import type { ClineIgnoreController } from "@core/ignore/ClineIgnoreController"
import type { ContextManager } from "@core/context/context-management/ContextManager"
import type { CacheService } from "@core/storage/CacheService"
import type { TerminalManager } from "@integrations/terminal/TerminalManager"
import type { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import type { BrowserSettings } from "@shared/BrowserSettings"
import type { FocusChainSettings } from "@shared/FocusChainSettings"
import type { Mode } from "@shared/storage/types"
import type { ClineAsk, ClineSay } from "@shared/ExtensionMessage"
import type { ClineAskResponse } from "@shared/WebviewMessage"
import type { HistoryItem } from "@shared/HistoryItem"
import type { TaskState } from "./TaskState"
import type { MessageStateHandler } from "./message-state"
import type Anthropic from "@anthropic-ai/sdk"

/**
 * TaskConfig is an immutable bundle of core services, settings, and callbacks that
 * submodules depend on. Start small and extend as we migrate code behind stable interfaces.
 */
export interface TaskConfig {
	// Identity
	taskId: string
	ulid: string

	// VSCode context + mode
	context: vscode.ExtensionContext
	mode: Mode

	// Paths and runtime state
	cwd: string
	taskState: TaskState
	messageState: MessageStateHandler

	// API + model plumbing
	api: ApiHandler

	// User settings
	autoApprovalSettings: AutoApprovalSettings
	browserSettings: BrowserSettings
	focusChainSettings: FocusChainSettings

	// Services
	services: {
		mcpHub: McpHub
		browserSession: BrowserSession
		diffViewProvider: DiffViewProvider
		fileContextTracker: FileContextTracker
		clineIgnoreController: ClineIgnoreController
		contextManager: ContextManager
		cacheService: CacheService
		terminalManager: TerminalManager
	}

	// Controller/Webview callbacks
	callbacks: {
		say: (type: ClineSay, text?: string, images?: string[], files?: string[], partial?: boolean) => Promise<undefined>
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
		saveCheckpoint: (isAttemptCompletionMessage?: boolean) => Promise<void>
		postStateToWebview: () => Promise<void>
		reinitExistingTaskFromId: (taskId: string) => Promise<void>
		cancelTask: () => Promise<void>
		updateTaskHistory: (item: HistoryItem) => Promise<HistoryItem[]>
		executeCommandTool: (
			command: string,
		) => Promise<[boolean, string | Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam>]>
		doesLatestTaskCompletionHaveNewChanges: () => Promise<boolean>
		updateFCListFromToolResponse: (taskProgress?: string) => Promise<void>
	}
}

/**
 * Helper to derive commonly needed flags in submodules without poking TaskState directly.
 * Keep this minimal and pure; treat TaskState as the single source for mutable flags.
 */
export const getDerivedFlags = (config: TaskConfig) => {
	return {
		strictPlanModeEnabled: config.mode === "plan", // refined later when strict flag is introduced in config
	}
}
