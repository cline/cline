import { ApiHandler } from "@core/api"
import { FileContextTracker } from "@core/context/context-tracking/FileContextTracker"
import { ClineIgnoreController } from "@core/ignore/ClineIgnoreController"
import { DiffViewProvider } from "@integrations/editor/DiffViewProvider"
import { BrowserSession } from "@services/browser/BrowserSession"
import { UrlContentFetcher } from "@services/browser/UrlContentFetcher"
import { featureFlagsService } from "@services/feature-flags"
import { McpHub } from "@services/mcp/McpHub"
import { ClineAsk, ClineSay } from "@shared/ExtensionMessage"
import { ClineDefaultTool } from "@shared/tools"
import { ClineAskResponse } from "@shared/WebviewMessage"
import * as vscode from "vscode"
import { modelDoesntSupportWebp } from "@/utils/model-utils"
import { ToolUse } from "../assistant-message"
import { ContextManager } from "../context/context-management/ContextManager"
import { HookFactory } from "../hooks/hook-factory"
import { formatResponse } from "../prompts/responses"
import { StateManager } from "../storage/StateManager"
import { WorkspaceRootManager } from "../workspace"
import { ToolResponse } from "."
import { MessageStateHandler } from "./message-state"
import { TaskState } from "./TaskState"
import { AutoApprove } from "./tools/autoApprove"
import { AccessMcpResourceHandler } from "./tools/handlers/AccessMcpResourceHandler"
import { ApplyPatchHandler } from "./tools/handlers/ApplyPatchHandler"
import { AskFollowupQuestionToolHandler } from "./tools/handlers/AskFollowupQuestionToolHandler"
import { AttemptCompletionHandler } from "./tools/handlers/AttemptCompletionHandler"
import { BrowserToolHandler } from "./tools/handlers/BrowserToolHandler"
import { CondenseHandler } from "./tools/handlers/CondenseHandler"
import { ExecuteCommandToolHandler } from "./tools/handlers/ExecuteCommandToolHandler"
import { ListCodeDefinitionNamesToolHandler } from "./tools/handlers/ListCodeDefinitionNamesToolHandler"
import { ListFilesToolHandler } from "./tools/handlers/ListFilesToolHandler"
import { LoadMcpDocumentationHandler } from "./tools/handlers/LoadMcpDocumentationHandler"
import { NewTaskHandler } from "./tools/handlers/NewTaskHandler"
import { PlanModeRespondHandler } from "./tools/handlers/PlanModeRespondHandler"
import { ReadFileToolHandler } from "./tools/handlers/ReadFileToolHandler"
import { ReportBugHandler } from "./tools/handlers/ReportBugHandler"
import { SearchFilesToolHandler } from "./tools/handlers/SearchFilesToolHandler"
import { SummarizeTaskHandler } from "./tools/handlers/SummarizeTaskHandler"
import { UseMcpToolHandler } from "./tools/handlers/UseMcpToolHandler"
import { WebFetchToolHandler } from "./tools/handlers/WebFetchToolHandler"
import { WriteToFileToolHandler } from "./tools/handlers/WriteToFileToolHandler"
import { IPartialBlockHandler, SharedToolHandler, ToolExecutorCoordinator } from "./tools/ToolExecutorCoordinator"
import { ToolValidator } from "./tools/ToolValidator"
import { TaskConfig, validateTaskConfig } from "./tools/types/TaskConfig"
import { createUIHelpers } from "./tools/types/UIHelpers"
import { ToolDisplayUtils } from "./tools/utils/ToolDisplayUtils"
import { ToolResultUtils } from "./tools/utils/ToolResultUtils"

export class ToolExecutor {
	private autoApprover: AutoApprove
	private coordinator: ToolExecutorCoordinator

	// Auto-approval methods using the AutoApprove class
	private shouldAutoApproveTool(toolName: ClineDefaultTool): boolean | [boolean, boolean] {
		return this.autoApprover.shouldAutoApproveTool(toolName)
	}

	private async shouldAutoApproveToolWithPath(
		blockname: ClineDefaultTool,
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
		private stateManager: StateManager,

		// Configuration & Settings

		private cwd: string,
		private taskId: string,
		private ulid: string,

		// Workspace Management
		private workspaceManager: WorkspaceRootManager | undefined,
		private isMultiRootEnabled: boolean,

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
		private sayAndCreateMissingParamError: (toolName: ClineDefaultTool, paramName: string, relPath?: string) => Promise<any>,
		private removeLastPartialMessageIfExistsWithType: (type: "ask" | "say", askOrSay: ClineAsk | ClineSay) => Promise<void>,
		private executeCommandTool: (command: string, timeoutSeconds: number | undefined) => Promise<[boolean, any]>,
		private doesLatestTaskCompletionHaveNewChanges: () => Promise<boolean>,
		private updateFCListFromToolResponse: (taskProgress: string | undefined) => Promise<void>,
		private switchToActMode: () => Promise<boolean>,
	) {
		this.autoApprover = new AutoApprove(this.stateManager)

		// Initialize the coordinator and register all tool handlers
		this.coordinator = new ToolExecutorCoordinator()
		this.registerToolHandlers()
	}

	// Create a properly typed TaskConfig object for handlers
	// NOTE: modifying this object in the tool handlers is okay since these are all references to the singular ToolExecutor instance's variables. However, be careful modifying this object assuming it will update the ToolExecutor instance, e.g. config.browserSession = ... will not update the ToolExecutor.browserSession instance variable. Use applyLatestBrowserSettings() instead.
	private asToolConfig(): TaskConfig {
		const config: TaskConfig = {
			taskId: this.taskId,
			ulid: this.ulid,
			context: this.context,
			mode: this.stateManager.getGlobalSettingsKey("mode"),
			strictPlanModeEnabled: this.stateManager.getGlobalSettingsKey("strictPlanModeEnabled"),
			yoloModeToggled: this.stateManager.getGlobalSettingsKey("yoloModeToggled"),
			cwd: this.cwd,
			workspaceManager: this.workspaceManager,
			isMultiRootEnabled: this.isMultiRootEnabled,
			taskState: this.taskState,
			messageState: this.messageStateHandler,
			api: this.api,
			autoApprovalSettings: this.stateManager.getGlobalSettingsKey("autoApprovalSettings"),
			autoApprover: this.autoApprover,
			browserSettings: this.stateManager.getGlobalSettingsKey("browserSettings"),
			focusChainSettings: this.stateManager.getGlobalSettingsKey("focusChainSettings"),
			services: {
				mcpHub: this.mcpHub,
				browserSession: this.browserSession,
				urlContentFetcher: this.urlContentFetcher,
				diffViewProvider: this.diffViewProvider,
				fileContextTracker: this.fileContextTracker,
				clineIgnoreController: this.clineIgnoreController,
				contextManager: this.contextManager,
				stateManager: this.stateManager,
			},
			callbacks: {
				say: this.say,
				ask: this.ask,
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
				shouldAutoApproveTool: this.shouldAutoApproveTool.bind(this),
				shouldAutoApproveToolWithPath: this.shouldAutoApproveToolWithPath.bind(this),
				applyLatestBrowserSettings: this.applyLatestBrowserSettings.bind(this),
				switchToActMode: this.switchToActMode,
			},
			coordinator: this.coordinator,
		}

		// Validate the config at runtime to catch any missing properties
		validateTaskConfig(config)
		return config
	}

	/**
	 * Register all tool handlers with the coordinator
	 */
	private registerToolHandlers(): void {
		const validator = new ToolValidator(this.clineIgnoreController)

		// Register all tool handlers
		this.coordinator.register(new ListFilesToolHandler(validator))
		this.coordinator.register(new ReadFileToolHandler(validator))
		this.coordinator.register(new BrowserToolHandler())
		this.coordinator.register(new AskFollowupQuestionToolHandler())
		this.coordinator.register(new WebFetchToolHandler())

		// Register WriteToFileToolHandler for all three file tools with proper typing
		const writeHandler = new WriteToFileToolHandler(validator)
		this.coordinator.register(writeHandler) // registers as "write_to_file" (ClineDefaultTool.FILE_NEW)
		this.coordinator.register(new SharedToolHandler(ClineDefaultTool.FILE_EDIT, writeHandler))
		this.coordinator.register(new SharedToolHandler(ClineDefaultTool.NEW_RULE, writeHandler))

		this.coordinator.register(new ListCodeDefinitionNamesToolHandler(validator))
		this.coordinator.register(new SearchFilesToolHandler(validator))
		this.coordinator.register(new ExecuteCommandToolHandler(validator))
		this.coordinator.register(new UseMcpToolHandler())
		this.coordinator.register(new AccessMcpResourceHandler())
		this.coordinator.register(new LoadMcpDocumentationHandler())
		this.coordinator.register(new PlanModeRespondHandler())
		this.coordinator.register(new NewTaskHandler())
		this.coordinator.register(new AttemptCompletionHandler())
		this.coordinator.register(new CondenseHandler())
		this.coordinator.register(new SummarizeTaskHandler(validator))
		this.coordinator.register(new ReportBugHandler())
		this.coordinator.register(new ApplyPatchHandler(validator))
	}

	/**
	 * Main entry point for tool execution - called by Task class
	 */
	public async executeTool(block: ToolUse): Promise<void> {
		await this.execute(block)
	}

	/**
	 * Updates the browser settings
	 */
	public async applyLatestBrowserSettings() {
		await this.browserSession.dispose()
		const apiHandlerModel = this.api.getModel()
		const useWebp = this.api ? !modelDoesntSupportWebp(apiHandlerModel) : true
		this.browserSession = new BrowserSession(this.stateManager, useWebp)
		return this.browserSession
	}

	/**
	 * Handles errors during tool execution
	 */
	private async handleError(action: string, error: Error, block: ToolUse): Promise<void> {
		console.log(error)
		const errorString = `Error ${action}: ${error.message}`
		await this.say("error", errorString)

		// Create error response for the tool
		const errorResponse = formatResponse.toolError(errorString)
		this.pushToolResult(errorResponse, block)
	}

	private pushToolResult = (content: ToolResponse, block: ToolUse) => {
		// Use the ToolResultUtils to properly format and push the tool result
		ToolResultUtils.pushToolResult(
			content,
			block,
			this.taskState.userMessageContent,
			(block: ToolUse) => ToolDisplayUtils.getToolDescription(block),
			this.api,
			() => {
				this.taskState.didAlreadyUseTool = true
			},
			this.coordinator,
			this.taskState.toolUseIdMap,
		)
	}

	/**
	 * Tools that are restricted in plan mode and can only be used in act mode
	 */
	private static readonly PLAN_MODE_RESTRICTED_TOOLS: ClineDefaultTool[] = [
		ClineDefaultTool.FILE_NEW,
		ClineDefaultTool.FILE_EDIT,
		ClineDefaultTool.NEW_RULE,
	]

	/**
	 * Execute a tool through the coordinator if it's registered
	 */
	private async execute(block: ToolUse): Promise<boolean> {
		// Note: MCP tool name transformation happens earlier in ToolUseHandler.getPartialToolUsesAsContent()
		// The toolUseIdMap is updated at the point of transformation in index.ts

		if (!this.coordinator.has(block.name)) {
			return false // Tool not handled by coordinator
		}

		const config = this.asToolConfig()

		try {
			// Check if user rejected a previous tool
			if (this.taskState.didRejectTool) {
				const reason = block.partial
					? "Tool was interrupted and not executed due to user rejecting a previous tool."
					: "Skipping tool due to user rejecting a previous tool."
				this.createToolRejectionMessage(block, reason)
				return true
			}

			// Check if a tool has already been used in this message
			if (this.taskState.didAlreadyUseTool) {
				this.taskState.userMessageContent.push({
					type: "text",
					text: formatResponse.toolAlreadyUsed(block.name),
				})
				return true
			}

			// Logic for plan-mode tool call restrictions
			if (
				this.stateManager.getGlobalSettingsKey("strictPlanModeEnabled") &&
				this.stateManager.getGlobalSettingsKey("mode") === "plan" &&
				block.name &&
				this.isPlanModeToolRestricted(block.name)
			) {
				const errorMessage = `Tool '${block.name}' is not available in PLAN MODE. This tool is restricted to ACT MODE for file modifications. Only use tools available for PLAN MODE when in that mode.`
				await this.say("error", errorMessage)
				this.pushToolResult(formatResponse.toolError(errorMessage), block)
				await this.saveCheckpoint()
				return true
			}

			// Close browser for non-browser tools
			if (block.name !== "browser_action") {
				await this.browserSession.closeBrowser()
			}

			// Handle partial blocks
			if (block.partial) {
				await this.handlePartialBlock(block, config)
				return true
			}

			// Handle complete blocks
			await this.handleCompleteBlock(block, config)
			await this.saveCheckpoint()
			return true
		} catch (error) {
			await this.handleError(`executing ${block.name}`, error as Error, block)
			await this.saveCheckpoint()
			return true
		}
	}

	/**
	 * Check if a tool is restricted in plan mode
	 */
	private isPlanModeToolRestricted(toolName: ClineDefaultTool): boolean {
		return ToolExecutor.PLAN_MODE_RESTRICTED_TOOLS.includes(toolName)
	}

	/**
	 * Create a tool rejection message and add it to user message content
	 */
	private createToolRejectionMessage(block: ToolUse, reason: string): void {
		this.taskState.userMessageContent.push({
			type: "text",
			text: `${reason} ${ToolDisplayUtils.getToolDescription(block, this.coordinator)}`,
		})
	}

	/**
	 * Adds hook context modification to the conversation if provided.
	 * Parses the context to extract type prefix and formats as XML.
	 *
	 * @param contextModification The context string from the hook output
	 * @param source The hook source name ("PreToolUse" or "PostToolUse")
	 */
	private addHookContextToConversation(contextModification: string | undefined, source: string): void {
		if (!contextModification) {
			return
		}

		const contextText = contextModification.trim()
		if (!contextText) {
			return
		}

		// Extract context type from first line if specified (e.g., "WORKSPACE_RULES: ...")
		const lines = contextText.split("\n")
		const firstLine = lines[0]
		let contextType = "general"
		let content = contextText

		// Check if first line specifies a type: "TYPE: content"
		const typeMatchRegex = /^([A-Z_]+):\s*(.*)/
		const typeMatch = typeMatchRegex.exec(firstLine)
		if (typeMatch) {
			contextType = typeMatch[1].toLowerCase()
			const remainingLines = lines.slice(1).filter((l: string) => l.trim())
			content = typeMatch[2] ? [typeMatch[2], ...remainingLines].join("\n") : remainingLines.join("\n")
		}

		this.taskState.userMessageContent.push({
			type: "text",
			text: `<hook_context source="${source}" type="${contextType}">\n${content}\n</hook_context>`,
		})
	}

	/**
	 * Handle partial block streaming UI updates
	 */
	private async handlePartialBlock(block: ToolUse, config: TaskConfig): Promise<void> {
		// NOTE: We don't push tool results in partial blocks because this is only for UI streaming.
		// The ToolExecutor will handle pushToolResult() when the complete block is processed.
		// This maintains separation of concerns: partial = UI updates, complete = final state changes.
		const handler = this.coordinator.getHandler(block.name)

		// Check if handler supports partial blocks with proper typing
		if (handler && "handlePartialBlock" in handler) {
			const uiHelpers = createUIHelpers(config)
			const partialHandler = handler as IPartialBlockHandler
			await partialHandler.handlePartialBlock(block, uiHelpers)
		}
	}

	/**
	 * Handle complete block execution
	 */
	private async handleCompleteBlock(block: ToolUse, config: any): Promise<void> {
		// Check if hooks are enabled (both feature flag and user setting must be true)
		const featureFlagEnabled = featureFlagsService.getHooksEnabled()
		const userEnabled = this.stateManager.getGlobalSettingsKey("hooksEnabled")
		const hooksEnabled = featureFlagEnabled && userEnabled

		let executionSuccess = true
		let toolResult: any = null

		// Run PreToolUse hook, if enabled
		if (hooksEnabled) {
			let preToolUseResult: any = null
			try {
				const hookFactory = new HookFactory()
				const preToolUseHook = await hookFactory.create("PreToolUse")

				preToolUseResult = await preToolUseHook.run({
					taskId: this.taskId,
					preToolUse: {
						toolName: block.name,
						parameters: block.params,
					},
				})

				// Check if hook wants to stop execution
				if (!preToolUseResult.shouldContinue) {
					const errorMessage = preToolUseResult.errorMessage || "PreToolUse hook prevented tool execution"
					await this.say("error", errorMessage)
					this.pushToolResult(formatResponse.toolError(errorMessage), block)
					return
				}

				// Add context modification to the conversation if provided by the hook
				this.addHookContextToConversation(preToolUseResult.contextModification, "PreToolUse")
			} catch (hookError) {
				const errorMessage = `PreToolUse hook failed: ${hookError.toString()}`
				await this.say("error", errorMessage)
				this.pushToolResult(formatResponse.toolError(errorMessage), block)
				return
			}
		}

		const executionStartTime = Date.now()
		try {
			// Execute the actual tool
			toolResult = await this.coordinator.execute(config, block)
			this.pushToolResult(toolResult, block)
		} catch (error) {
			executionSuccess = false
			toolResult = formatResponse.toolError(`Tool execution failed: ${error}`)
			// Don't push tool result here - let the outer catch block (handleError) handle it
			// to avoid duplicate tool_result blocks
			throw error
		} finally {
			// Run PostToolUse hook if enabled
			if (hooksEnabled) {
				const hookFactory = new HookFactory()
				const postToolUseHook = await hookFactory.create("PostToolUse")

				const executionTimeMs = Date.now() - executionStartTime
				const postToolUseResult = await postToolUseHook.run({
					taskId: this.taskId,
					postToolUse: {
						toolName: block.name,
						parameters: block.params,
						result: typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult),
						success: executionSuccess,
						executionTimeMs,
					},
				})

				// Add context modification to the conversation if provided by the hook
				this.addHookContextToConversation(postToolUseResult.contextModification, "PostToolUse")

				// Log any error messages from the hook
				if (postToolUseResult.errorMessage) {
					this.say("error", postToolUseResult.errorMessage)
				}
			}
		}

		// Handle focus chain updates
		if (!block.partial && this.stateManager.getGlobalSettingsKey("focusChainSettings").enabled) {
			await this.updateFCListFromToolResponse(block.params.task_progress)
		}
	}
}
