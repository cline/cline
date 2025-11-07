import { ApiHandler } from "@core/api"
import { FileContextTracker } from "@core/context/context-tracking/FileContextTracker"
import { ClineIgnoreController } from "@core/ignore/ClineIgnoreController"
import { DiffViewProvider } from "@integrations/editor/DiffViewProvider"
import { BrowserSession } from "@services/browser/BrowserSession"
import { UrlContentFetcher } from "@services/browser/UrlContentFetcher"
import { McpHub } from "@services/mcp/McpHub"
import { ClineAsk, ClineSay } from "@shared/ExtensionMessage"
import { ClineDefaultTool } from "@shared/tools"
import { ClineAskResponse } from "@shared/WebviewMessage"
import * as vscode from "vscode"
import { modelDoesntSupportWebp } from "@/utils/model-utils"
import { ToolUse } from "../assistant-message"
import { ContextManager } from "../context/context-management/ContextManager"
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
		private vscodeTerminalExecutionMode: "vscodeTerminal" | "backgroundExec",

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

		// Atomic hook state helpers from Task
		private setActiveHookExecution: (hookExecution: NonNullable<typeof taskState.activeHookExecution>) => Promise<void>,
		private clearActiveHookExecution: () => Promise<void>,
		private getActiveHookExecution: () => Promise<typeof taskState.activeHookExecution>,
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
			vscodeTerminalExecutionMode: this.vscodeTerminalExecutionMode,
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
	 * Handles errors during tool execution.
	 *
	 * Logs the error, displays it to the user via the UI, and adds an error
	 * result to the conversation context so the AI can see what went wrong.
	 *
	 * @param action Description of what was being attempted (e.g., "executing read_file")
	 * @param error The error that occurred
	 * @param block The tool use block that caused the error
	 */
	private async handleError(action: string, error: Error, block: ToolUse): Promise<void> {
		console.log(error)
		const errorString = `Error ${action}: ${error.message}`
		await this.say("error", errorString)

		// Create error response for the tool
		const errorResponse = formatResponse.toolError(errorString)
		this.pushToolResult(errorResponse, block)
	}

	/**
	 * Pushes a tool result to the user message content.
	 *
	 * This is a critical method that:
	 * - Formats the tool result appropriately for the API
	 * - Adds it to the conversation context
	 * - Marks that a tool has been used in this turn
	 *
	 * @param content The tool response content to add
	 * @param block The tool use block that generated this result
	 */
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
	 * Execute a tool through the coordinator if it's registered.
	 *
	 * This is the main entry point for tool execution, called by the Task class.
	 * It handles:
	 * - Checking if the tool is registered with the coordinator
	 * - Validating tool execution is allowed (not rejected, not already used, etc.)
	 * - Enforcing plan mode restrictions on file modification tools
	 * - Delegating to partial or complete block handlers
	 * - Error handling and checkpointing
	 *
	 * @param block The tool use block to execute
	 * @returns true if the tool was handled (even if execution failed), false if not registered
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
	 * Check if a tool is restricted in plan mode.
	 *
	 * In strict plan mode, file modification tools (write_to_file, editedExistingFile, etc.)
	 * are blocked. The AI must switch to Act mode to use these tools.
	 *
	 * @param toolName The name of the tool to check
	 * @returns true if the tool is restricted in plan mode, false otherwise
	 */
	private isPlanModeToolRestricted(toolName: ClineDefaultTool): boolean {
		return ToolExecutor.PLAN_MODE_RESTRICTED_TOOLS.includes(toolName)
	}

	/**
	 * Create a tool rejection message and add it to user message content.
	 *
	 * Used when a tool cannot be executed (e.g., user rejected a previous tool,
	 * tool was interrupted, etc.). Adds a text message to the conversation explaining
	 * why the tool was not executed.
	 *
	 * @param block The tool use block that was rejected
	 * @param reason Human-readable explanation of why the tool was rejected
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

		const hookContextBlock = {
			type: "text" as const,
			text: `<hook_context source="${source}" type="${contextType}">\n${content}\n</hook_context>`,
		}

		this.taskState.userMessageContent.push(hookContextBlock)
	}

	/**
	 * Runs the PostToolUse hook after tool execution.
	 * This is extracted from handleCompleteBlock to eliminate code duplication
	 * between success and error paths.
	 *
	 * @param block The tool use block that was executed
	 * @param toolResult The result from the tool execution
	 * @param executionSuccess Whether the tool executed successfully
	 * @param executionStartTime The timestamp when tool execution started
	 * @returns true if hook requested cancellation, false otherwise
	 */
	private async runPostToolUseHook(
		block: ToolUse,
		toolResult: any,
		executionSuccess: boolean,
		executionStartTime: number,
	): Promise<boolean> {
		const { executeHook } = await import("../hooks/hook-executor")

		const executionTimeMs = Date.now() - executionStartTime

		const postToolResult = await executeHook({
			hookName: "PostToolUse",
			hookInput: {
				postToolUse: {
					toolName: block.name,
					parameters: block.params,
					result: typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult),
					success: executionSuccess,
					executionTimeMs,
				},
			},
			isCancellable: true,
			say: this.say,
			setActiveHookExecution: this.setActiveHookExecution,
			clearActiveHookExecution: this.clearActiveHookExecution,
			messageStateHandler: this.messageStateHandler,
			taskId: this.taskId,
			hooksEnabled: true, // Already checked by caller
			toolName: block.name,
		})

		// Handle cancellation request
		if (postToolResult.cancel === true) {
			const errorMessage = postToolResult.errorMessage || "Hook requested task cancellation"
			await this.say("error", errorMessage)
			return true
		}

		// Add context modification to the conversation if provided
		if (postToolResult.contextModification) {
			this.addHookContextToConversation(postToolResult.contextModification, "PostToolUse")
		}

		return false
	}

	/**
	 * Handle partial block streaming UI updates.
	 *
	 * During streaming API responses, the AI sends partial tool use blocks as they're
	 * generated. This method updates the UI to show the tool being constructed in real-time.
	 *
	 * NOTE: This is ONLY for UI updates. No tool results are pushed to the conversation
	 * during partial block handling. The complete block handler will add the final result.
	 *
	 * @param block The partial tool use block with incomplete parameters
	 * @param config The task configuration containing all necessary context
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
	 * Handle complete block execution.
	 *
	 * This is the main execution flow for a tool:
	 * 1. Run PreToolUse hooks (if enabled) - can block execution
	 * 2. Execute the actual tool
	 * 3. Run PostToolUse hooks (if enabled) - cannot block, only observe
	 * 4. Add hook context modifications to the conversation
	 * 5. Update focus chain tracking
	 *
	 * Hooks are executed with streaming output to provide real-time feedback.
	 * PreToolUse hooks can prevent tool execution by returning shouldContinue: false.
	 * PostToolUse hooks are for observation/logging only and cannot block.
	 *
	 * @param block The complete tool use block with all parameters
	 * @param config The task configuration containing all necessary context
	 */
	private async handleCompleteBlock(block: ToolUse, config: any): Promise<void> {
		// Check abort flag at the very start to prevent execution after cancellation
		if (this.taskState.abort) {
			return
		}

		// Check if hooks are enabled via user setting
		const hooksEnabled = this.stateManager.getGlobalSettingsKey("hooksEnabled")

		// Track if we need to cancel after hooks complete
		let shouldCancelAfterHook = false

		// ============================================================
		// PHASE 1: Run PreToolUse hook (OUTSIDE try-catch-finally)
		// This allows early return on cancellation without triggering finally block
		// ============================================================
		if (hooksEnabled) {
			const { executeHook } = await import("../hooks/hook-executor")

			// Build pending tool info for display
			const pendingToolInfo: any = {
				tool: block.name,
			}

			// Add relevant parameters for display based on tool type
			if (block.params.path) {
				pendingToolInfo.path = block.params.path
			}
			if (block.params.command) {
				pendingToolInfo.command = block.params.command
			}
			if (block.params.content && typeof block.params.content === "string") {
				pendingToolInfo.content = block.params.content.slice(0, 200)
			}
			if (block.params.diff && typeof block.params.diff === "string") {
				pendingToolInfo.diff = block.params.diff.slice(0, 200)
			}
			if (block.params.regex) {
				pendingToolInfo.regex = block.params.regex
			}
			if (block.params.url) {
				pendingToolInfo.url = block.params.url
			}
			// For MCP operations, show tool/resource identifiers
			if (block.params.tool_name) {
				pendingToolInfo.mcpTool = block.params.tool_name
			}
			if (block.params.server_name) {
				pendingToolInfo.mcpServer = block.params.server_name
			}
			if (block.params.uri) {
				pendingToolInfo.resourceUri = block.params.uri
			}

			const preToolResult = await executeHook({
				hookName: "PreToolUse",
				hookInput: {
					preToolUse: {
						toolName: block.name,
						parameters: block.params,
					},
				},
				isCancellable: true,
				say: this.say,
				setActiveHookExecution: this.setActiveHookExecution,
				clearActiveHookExecution: this.clearActiveHookExecution,
				messageStateHandler: this.messageStateHandler,
				taskId: this.taskId,
				hooksEnabled,
				toolName: block.name,
				pendingToolInfo,
			})

			// Handle cancellation from hook
			if (preToolResult.cancel === true) {
				// Trigger task cancellation (same as clicking cancel button)
				await config.callbacks.cancelTask()
				// Early return - never enters try-catch-finally, so PostToolUse won't run
				return
			}

			// If task was aborted (e.g., via cancel button during hook), stop execution
			if (this.taskState.abort) {
				shouldCancelAfterHook = true
			}

			// Add context modification to the conversation if provided by the hook
			if (preToolResult.contextModification) {
				this.addHookContextToConversation(preToolResult.contextModification, "PreToolUse")
			}
		}

		// ============================================================
		// PHASE 2: Execute tool with PostToolUse hook in finally block
		// This only runs if PreToolUse didn't cancel above
		// ============================================================

		// Check abort again before tool execution (could have been set by PreToolUse hook)
		if (this.taskState.abort) {
			return
		}

		let executionSuccess = true
		let toolResult: any = null
		let toolWasExecuted = false
		const executionStartTime = Date.now()

		try {
			// Final abort check immediately before tool execution
			if (this.taskState.abort) {
				return
			}

			// Execute the actual tool
			toolResult = await this.coordinator.execute(config, block)
			toolWasExecuted = true
			this.pushToolResult(toolResult, block)

			// Check abort before running PostToolUse hook (success path)
			if (this.taskState.abort) {
				return
			}

			// Run PostToolUse hook for successful tool execution
			// Skip for attempt_completion since it marks task completion, not actual work
			if (hooksEnabled && block.name !== "attempt_completion") {
				const hookRequestedCancel = await this.runPostToolUseHook(block, toolResult, executionSuccess, executionStartTime)
				if (hookRequestedCancel) {
					await config.callbacks.cancelTask()
					shouldCancelAfterHook = true
				}
			}
		} catch (error) {
			executionSuccess = false
			toolResult = formatResponse.toolError(`Tool execution failed: ${error}`)

			// Check abort before running PostToolUse hook (error path)
			if (this.taskState.abort) {
				throw error
			}

			// Run PostToolUse hook for failed tool execution
			// Skip for attempt_completion since it marks task completion, not actual work
			if (toolWasExecuted && hooksEnabled && block.name !== "attempt_completion") {
				const hookRequestedCancel = await this.runPostToolUseHook(block, toolResult, executionSuccess, executionStartTime)
				if (hookRequestedCancel) {
					await config.callbacks.cancelTask()
					shouldCancelAfterHook = true
				}
			}

			// Re-throw the error after PostToolUse completes
			throw error
		}

		// Early return if hook requested cancellation
		if (shouldCancelAfterHook) {
			return
		}

		// Handle focus chain updates
		if (!block.partial && this.stateManager.getGlobalSettingsKey("focusChainSettings").enabled) {
			await this.updateFCListFromToolResponse(block.params.task_progress)
		}
	}
}
