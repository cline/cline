import { showSystemNotification } from "@/integrations/notifications"
import { listFiles } from "@/services/glob/list-files"
import { telemetryService } from "@/services/posthog/PostHogClientProvider"
import { regexSearchFiles } from "@/services/ripgrep"
import { parseSourceCodeForDefinitionsTopLevel } from "@/services/tree-sitter"
import { findLast, findLastIndex, parsePartialArrayString } from "@/shared/array"
import { createAndOpenGitHubIssue } from "@/utils/github-url-utils"
import { getReadablePath, isLocatedInWorkspace } from "@/utils/path"
import Anthropic from "@anthropic-ai/sdk"
import { ApiHandler } from "@api/index"
import { FileContextTracker } from "@core/context/context-tracking/FileContextTracker"
import { ClineIgnoreController } from "@core/ignore/ClineIgnoreController"
import { DiffViewProvider } from "@integrations/editor/DiffViewProvider"
import { processFilesIntoText } from "@integrations/misc/extract-text"
import { BrowserSession } from "@services/browser/BrowserSession"
import { UrlContentFetcher } from "@services/browser/UrlContentFetcher"
import { McpHub } from "@services/mcp/McpHub"
import { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import { BrowserSettings } from "@shared/BrowserSettings"
import { FocusChainSettings } from "@shared/FocusChainSettings"
import {
	BrowserAction,
	BrowserActionResult,
	browserActions,
	ClineAsk,
	ClineAskQuestion,
	ClineAskUseMcpServer,
	ClinePlanModeResponse,
	ClineSay,
	ClineSayBrowserAction,
	ClineSayTool,
	COMPLETION_RESULT_CHANGES_FLAG,
} from "@shared/ExtensionMessage"
import { ClineAskResponse } from "@shared/WebviewMessage"
import { extractFileContent } from "@integrations/misc/extract-file-content"
import { COMMAND_REQ_APP_STRING } from "@shared/combineCommandSequences"
import { fileExistsAtPath } from "@utils/fs"
import { modelDoesntSupportWebp, isNextGenModelFamily } from "@utils/model-utils"
import { fixModelHtmlEscaping, removeInvalidChars } from "@utils/string"
import { setTimeout as setTimeoutPromise } from "node:timers/promises"
import os from "os"
import * as path from "path"
import { serializeError } from "serialize-error"
import * as vscode from "vscode"
import { ToolResponse } from "."
import { ToolParamName, ToolUse, ToolUseName } from "../assistant-message"
import { constructNewFileContent } from "../assistant-message/diff"
import { ContextManager } from "../context/context-management/ContextManager"
import { loadMcpDocumentation } from "../prompts/loadMcpDocumentation"
import { formatResponse } from "../prompts/responses"
import { ensureTaskDirectoryExists } from "../storage/disk"
import { CacheService } from "../storage/CacheService"
import { TaskState } from "./TaskState"
import { MessageStateHandler } from "./message-state"
import { AutoApprove } from "./tools/autoApprove"
import { showNotificationForApprovalIfAutoApprovalEnabled } from "./utils"
import { Mode } from "@shared/storage/types"
import { continuationPrompt } from "../prompts/contextManagement"
import { ToolExecutionManager } from "./tools/ToolExecutionManager"
import { ToolDisplayUtils } from "./tools/utils/ToolDisplayUtils"
import { ToolResultUtils } from "./tools/utils/ToolResultUtils"

export class ToolExecutor {
	private autoApprover: AutoApprove
	private executionManager: ToolExecutionManager

	// Auto-approval methods using the AutoApprove class
	private shouldAutoApproveTool(toolName: ToolUseName): boolean | [boolean, boolean] {
		return this.autoApprover.shouldAutoApproveTool(toolName)
	}

	private async shouldAutoApproveToolWithPath(
		blockname: ToolUseName,
		autoApproveActionpath: string | undefined,
	): Promise<boolean> {
		return this.autoApprover.shouldAutoApproveToolWithPath(blockname, autoApproveActionpath)
	}

	constructor(
		// Core Services & Managers
		private context: vscode.ExtensionContext,
		private taskState: TaskState,
		private messageStateHandler: MessageStateHandler,
		private api: ApiHandler,
		private urlContentFetcher: UrlContentFetcher,
		private browserSession: BrowserSession,
		private diffViewProvider: DiffViewProvider,
		private mcpHub: McpHub,
		private fileContextTracker: FileContextTracker,
		private clineIgnoreController: ClineIgnoreController,
		private contextManager: ContextManager,
		private cacheService: CacheService,

		// Configuration & Settings
		private autoApprovalSettings: AutoApprovalSettings,
		private browserSettings: BrowserSettings,
		private focusChainSettings: FocusChainSettings,
		private cwd: string,
		private taskId: string,
		private ulid: string,
		private mode: Mode,
		private strictPlanModeEnabled: boolean,

		// Callbacks to the Task (Entity)
		private say: (
			type: ClineSay,
			text?: string,
			images?: string[],
			files?: string[],
			partial?: boolean,
		) => Promise<number | undefined>,
		private ask: (
			type: ClineAsk,
			text?: string,
			partial?: boolean,
		) => Promise<{
			response: ClineAskResponse
			text?: string
			images?: string[]
			files?: string[]
		}>,
		private saveCheckpoint: (isAttemptCompletionMessage?: boolean, completionMessageTs?: number) => Promise<void>,
		private sayAndCreateMissingParamError: (toolName: ToolUseName, paramName: string, relPath?: string) => Promise<any>,
		private removeLastPartialMessageIfExistsWithType: (type: "ask" | "say", askOrSay: ClineAsk | ClineSay) => Promise<void>,
		private executeCommandTool: (command: string) => Promise<[boolean, any]>,
		private doesLatestTaskCompletionHaveNewChanges: () => Promise<boolean>,
		private updateFCListFromToolResponse: (taskProgress: string | undefined) => Promise<void>,
	) {
		this.autoApprover = new AutoApprove(autoApprovalSettings)

		// Initialize the execution manager using the factory method (handles tool registration internally)
		this.executionManager = ToolExecutionManager.create(
			this.asToolConfig(),
			this.pushToolResult,
			this.shouldAutoApproveToolWithPath.bind(this),
			this.sayAndCreateMissingParamError,
			this.removeLastPartialMessageIfExistsWithType,
			this.say,
			this.ask,
			this.askApproval,
			this.saveCheckpoint,
			this.updateFCListFromToolResponse,
			this.handleError,
		)
	}

	// Provide a minimal TaskConfig-like object for handlers. Cast to any to avoid coupling yet.
	private asToolConfig(): any /* TaskConfig */ {
		return {
			taskId: this.taskId,
			ulid: this.ulid,
			context: this.context,
			mode: this.mode,
			cwd: this.cwd,
			taskState: this.taskState,
			messageState: this.messageStateHandler,
			api: this.api,
			autoApprovalSettings: this.autoApprovalSettings,
			browserSettings: this.browserSettings,
			focusChainSettings: this.focusChainSettings,
			services: {
				mcpHub: this.mcpHub,
				browserSession: this.browserSession,
				diffViewProvider: this.diffViewProvider,
				fileContextTracker: this.fileContextTracker,
				clineIgnoreController: this.clineIgnoreController,
				contextManager: this.contextManager,
				cacheService: this.cacheService,
				// terminalManager not used by file/list/search handlers; omit for now
			},
			callbacks: {
				say: this.say,
				ask: this.ask,
				askApproval: this.askApproval,
				saveCheckpoint: this.saveCheckpoint,
				postStateToWebview: async () => {},
				reinitExistingTaskFromId: async () => {},
				cancelTask: async () => {},
				updateTaskHistory: async (_: any) => [],
				executeCommandTool: this.executeCommandTool,
				doesLatestTaskCompletionHaveNewChanges: this.doesLatestTaskCompletionHaveNewChanges,
				updateFCListFromToolResponse: this.updateFCListFromToolResponse,
				sayAndCreateMissingParamError: this.sayAndCreateMissingParamError,
				removeLastPartialMessageIfExistsWithType: this.removeLastPartialMessageIfExistsWithType,
				shouldAutoApproveToolWithPath: this.shouldAutoApproveToolWithPath.bind(this),
			},
		} as any
	}

	/**
	 * Updates the auto approval settings
	 */
	public updateAutoApprovalSettings(settings: AutoApprovalSettings): void {
		this.autoApprover.updateSettings(settings)
	}

	/**
	 * Defines the tools which should be restricted in plan mode
	 */
	private isPlanModeToolRestricted(toolName: ToolUseName): boolean {
		const planModeRestrictedTools: ToolUseName[] = ["write_to_file", "replace_in_file"]
		return planModeRestrictedTools.includes(toolName)
	}

	public updateMode(mode: Mode): void {
		this.mode = mode
	}

	public updateStrictPlanModeEnabled(strictPlanModeEnabled: boolean): void {
		this.strictPlanModeEnabled = strictPlanModeEnabled
	}

	private pushToolResult = (content: ToolResponse, block: ToolUse) => {
		ToolResultUtils.pushToolResult(
			content,
			block,
			this.taskState.userMessageContent,
			ToolDisplayUtils.getToolDescription,
			this.api,
			() => {
				this.taskState.didAlreadyUseTool = true
			},
		)
	}

	// The user can approve, reject, or provide feedback (rejection). However the user may also send a message along with an approval, in which case we add a separate user message with this feedback.
	private pushAdditionalToolFeedback = async (feedback?: string, images?: string[], files?: string[]) => {
		const fileContentString = await ToolResultUtils.processFilesForFeedback(files)
		ToolResultUtils.pushAdditionalToolFeedback(this.taskState.userMessageContent, feedback, images, fileContentString)
	}

	private askApproval = async (type: ClineAsk, block: ToolUse, partialMessage: string) => {
		const { response, text, images, files } = await this.ask(type, partialMessage, false)
		if (response !== "yesButtonClicked") {
			// User pressed reject button or responded with a message, which we treat as a rejection
			this.pushToolResult(formatResponse.toolDenied(), block)
			if (text || (images && images.length > 0) || (files && files.length > 0)) {
				await this.pushAdditionalToolFeedback(text, images, files)
				await this.say("user_feedback", text, images, files)
				await this.saveCheckpoint()
			}
			this.taskState.didRejectTool = true // Prevent further tool uses in this message
			return false
		} else {
			// User hit the approve button, and may have provided feedback
			if (text || (images && images.length > 0) || (files && files.length > 0)) {
				await this.pushAdditionalToolFeedback(text, images, files)
				await this.say("user_feedback", text, images, files)
				await this.saveCheckpoint()
			}
			return true
		}
	}

	private handleError = async (action: string, error: Error, block: ToolUse) => {
		if (this.taskState.abandoned) {
			console.log("Ignoring error since task was abandoned (i.e. from task cancellation after resetting)")
			return
		}
		const errorString = `Error ${action}: ${JSON.stringify(serializeError(error))}`
		await this.say("error", `Error ${action}:\n${error.message ?? JSON.stringify(serializeError(error), null, 2)}`)

		this.pushToolResult(formatResponse.toolError(errorString), block)
	}

	public async executeTool(block: ToolUse): Promise<void> {
		if (this.taskState.didRejectTool) {
			// ignore any tool content after user has rejected tool once
			if (!block.partial) {
				this.taskState.userMessageContent.push({
					type: "text",
					text: `Skipping tool ${ToolDisplayUtils.getToolDescription(block)} due to user rejecting a previous tool.`,
				})
			} else {
				// partial tool after user rejected a previous tool
				this.taskState.userMessageContent.push({
					type: "text",
					text: `Tool ${ToolDisplayUtils.getToolDescription(block)} was interrupted and not executed due to user rejecting a previous tool.`,
				})
			}
			return
		}

		if (this.taskState.didAlreadyUseTool) {
			// ignore any content after a tool has already been used
			this.taskState.userMessageContent.push({
				type: "text",
				text: formatResponse.toolAlreadyUsed(block.name),
			})
			return
		}

		// Logic for plan-model tool call restrictions
		if (this.strictPlanModeEnabled && this.mode === "plan" && block.name && this.isPlanModeToolRestricted(block.name)) {
			const errorMessage = `Tool '${block.name}' is not available in PLAN MODE. This tool is restricted to ACT MODE for file modifications. Only use tools available for PLAN MODE when in that mode.`
			await this.say("error", errorMessage)
			this.pushToolResult(formatResponse.toolError(errorMessage), block)
			await this.saveCheckpoint()
			return
		}

		if (block.name !== "browser_action") {
			await this.browserSession.closeBrowser()
		}

		// Use the ToolExecutionManager for tools registered with the coordinator
		if (await this.executionManager.execute(block)) {
			return // Tool was handled by the execution manager
		}

		// All tools are now handled by the coordinator - no legacy switch cases remain!
		// If we reach here, it means a tool was not registered with the coordinator
		console.warn(`Tool ${block.name} was not handled by coordinator and has no legacy fallback`)
	}
}
