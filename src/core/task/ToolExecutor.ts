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
import { ToolExecutorCoordinator } from "./tools/ToolExecutorCoordinator"
import { CoordinatorToolExecutor } from "./tools/CoordinatorToolExecutor"
import { ToolValidator } from "./tools/ToolValidator"
import { ListFilesToolHandler } from "./tools/handlers/ListFilesToolHandler"
import { ReadFileToolHandler } from "./tools/handlers/ReadFileToolHandler"
import { BrowserToolHandler } from "./tools/handlers/BrowserToolHandler"
import { AskFollowupQuestionToolHandler } from "./tools/handlers/AskFollowupQuestionToolHandler"
import { WebFetchToolHandler } from "./tools/handlers/WebFetchToolHandler"
import { WriteToFileToolHandler } from "./tools/handlers/WriteToFileToolHandler"
import { ListCodeDefinitionNamesToolHandler } from "./tools/handlers/ListCodeDefinitionNamesToolHandler"
import { SearchFilesToolHandler } from "./tools/handlers/SearchFilesToolHandler"
import { ExecuteCommandToolHandler } from "./tools/handlers/ExecuteCommandToolHandler"
import { UseMcpToolHandler } from "./tools/handlers/UseMcpToolHandler"
import { AccessMcpResourceHandler } from "./tools/handlers/AccessMcpResourceHandler"
import { LoadMcpDocumentationHandler } from "./tools/handlers/LoadMcpDocumentationHandler"
import { PlanModeRespondHandler } from "./tools/handlers/PlanModeRespondHandler"
import { NewTaskHandler } from "./tools/handlers/NewTaskHandler"
import { AttemptCompletionHandler } from "./tools/handlers/AttemptCompletionHandler"

export class ToolExecutor {
	private autoApprover: AutoApprove
	private coordinator: ToolExecutorCoordinator
	private coordinatorExecutor: CoordinatorToolExecutor

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
		this.coordinator = new ToolExecutorCoordinator()

		// Register tool handlers
		const validator = new ToolValidator(this.clineIgnoreController)
		this.coordinator.register(new ListFilesToolHandler(validator))
		this.coordinator.register(new ReadFileToolHandler(validator))
		this.coordinator.register(new BrowserToolHandler())
		this.coordinator.register(new AskFollowupQuestionToolHandler())
		this.coordinator.register(new WebFetchToolHandler())

		// Register WriteToFileToolHandler for all three file tools
		const writeHandler = new WriteToFileToolHandler(validator)
		this.coordinator.register(writeHandler) // registers as "write_to_file"
		this.coordinator.register({ name: "replace_in_file", execute: writeHandler.execute.bind(writeHandler) })
		this.coordinator.register({ name: "new_rule", execute: writeHandler.execute.bind(writeHandler) })

		this.coordinator.register(new ListCodeDefinitionNamesToolHandler(validator))
		this.coordinator.register(new SearchFilesToolHandler(validator))
		this.coordinator.register(new ExecuteCommandToolHandler(validator))
		this.coordinator.register(new UseMcpToolHandler())
		this.coordinator.register(new AccessMcpResourceHandler())
		this.coordinator.register(new LoadMcpDocumentationHandler())
		this.coordinator.register(new PlanModeRespondHandler())
		this.coordinator.register(new NewTaskHandler())
		this.coordinator.register(new AttemptCompletionHandler())

		// Initialize the coordinator executor with all necessary dependencies
		this.coordinatorExecutor = new CoordinatorToolExecutor(
			this.coordinator,
			this.asToolConfig(),
			this.pushToolResult,
			this.removeClosingTag,
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
		const isNextGenModel = isNextGenModelFamily(this.api)

		if (typeof content === "string") {
			const resultText = content || "(tool did not return anything)"

			// Non-Claude 4: Use traditional format with header
			this.taskState.userMessageContent.push({
				type: "text",
				text: `${this.toolDescription(block)} Result:`,
			})
			this.taskState.userMessageContent.push({
				type: "text",
				text: resultText,
			})
		} else {
			this.taskState.userMessageContent.push(...content)
		}
		// once a tool result has been collected, ignore all other tool uses since we should only ever present one tool result per message
		this.taskState.didAlreadyUseTool = true
	}

	private toolDescription = (block: ToolUse) => {
		switch (block.name) {
			case "execute_command":
				return `[${block.name} for '${block.params.command}']`
			case "read_file":
				return `[${block.name} for '${block.params.path}']`
			case "write_to_file":
				return `[${block.name} for '${block.params.path}']`
			case "replace_in_file":
				return `[${block.name} for '${block.params.path}']`
			case "search_files":
				return `[${block.name} for '${block.params.regex}'${
					block.params.file_pattern ? ` in '${block.params.file_pattern}'` : ""
				}]`
			case "list_files":
				return `[${block.name} for '${block.params.path}']`
			case "list_code_definition_names":
				return `[${block.name} for '${block.params.path}']`
			case "browser_action":
				return `[${block.name} for '${block.params.action}']`
			case "use_mcp_tool":
				return `[${block.name} for '${block.params.server_name}']`
			case "access_mcp_resource":
				return `[${block.name} for '${block.params.server_name}']`
			case "ask_followup_question":
				return `[${block.name} for '${block.params.question}']`
			case "plan_mode_respond":
				return `[${block.name}]`
			case "load_mcp_documentation":
				return `[${block.name}]`
			case "attempt_completion":
				return `[${block.name}]`
			case "new_task":
				return `[${block.name} for creating a new task]`
			case "condense":
				return `[${block.name}]`
			case "summarize_task":
				return `[${block.name}]`
			case "report_bug":
				return `[${block.name}]`
			case "new_rule":
				return `[${block.name} for '${block.params.path}']`
			case "web_fetch":
				return `[${block.name} for '${block.params.url}']`
		}
	}

	// The user can approve, reject, or provide feedback (rejection). However the user may also send a message along with an approval, in which case we add a separate user message with this feedback.
	private pushAdditionalToolFeedback = (feedback?: string, images?: string[], fileContentString?: string) => {
		if (!feedback && (!images || images.length === 0) && !fileContentString) {
			return
		}
		const content = formatResponse.toolResult(
			`The user provided the following feedback:\n<feedback>\n${feedback}\n</feedback>`,
			images,
			fileContentString,
		)
		if (typeof content === "string") {
			this.taskState.userMessageContent.push({
				type: "text",
				text: content,
			})
		} else {
			this.taskState.userMessageContent.push(...content)
		}
	}

	private askApproval = async (type: ClineAsk, block: ToolUse, partialMessage: string) => {
		const { response, text, images, files } = await this.ask(type, partialMessage, false)
		if (response !== "yesButtonClicked") {
			// User pressed reject button or responded with a message, which we treat as a rejection
			this.pushToolResult(formatResponse.toolDenied(), block)
			if (text || (images && images.length > 0) || (files && files.length > 0)) {
				let fileContentString = ""
				if (files && files.length > 0) {
					fileContentString = await processFilesIntoText(files)
				}

				this.pushAdditionalToolFeedback(text, images, fileContentString)
				await this.say("user_feedback", text, images, files)
				await this.saveCheckpoint()
			}
			this.taskState.didRejectTool = true // Prevent further tool uses in this message
			return false
		} else {
			// User hit the approve button, and may have provided feedback
			if (text || (images && images.length > 0) || (files && files.length > 0)) {
				let fileContentString = ""
				if (files && files.length > 0) {
					fileContentString = await processFilesIntoText(files)
				}

				this.pushAdditionalToolFeedback(text, images, fileContentString)
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

	// If block is partial, remove partial closing tag so its not presented to user
	private removeClosingTag = (block: ToolUse, tag: ToolParamName, text?: string) => {
		if (!block.partial) {
			return text || ""
		}
		if (!text) {
			return ""
		}
		// This regex dynamically constructs a pattern to match the closing tag:
		// - Optionally matches whitespace before the tag
		// - Matches '<' or '</' optionally followed by any subset of characters from the tag name
		const tagRegex = new RegExp(
			`\\s?<\/?${tag
				.split("")
				.map((char) => `(?:${char})?`)
				.join("")}$`,
			"g",
		)
		return text.replace(tagRegex, "")
	}

	public async executeTool(block: ToolUse): Promise<void> {
		if (this.taskState.didRejectTool) {
			// ignore any tool content after user has rejected tool once
			if (!block.partial) {
				this.taskState.userMessageContent.push({
					type: "text",
					text: `Skipping tool ${this.toolDescription(block)} due to user rejecting a previous tool.`,
				})
			} else {
				// partial tool after user rejected a previous tool
				this.taskState.userMessageContent.push({
					type: "text",
					text: `Tool ${this.toolDescription(block)} was interrupted and not executed due to user rejecting a previous tool.`,
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

		// Use the CoordinatorToolExecutor for tools registered with the coordinator
		if (await this.coordinatorExecutor.execute(block)) {
			return // Tool was handled by the coordinator
		}

		switch (block.name) {
			case "browser_action": {
				const action: BrowserAction | undefined = block.params.action as BrowserAction
				const url: string | undefined = block.params.url
				const coordinate: string | undefined = block.params.coordinate
				const text: string | undefined = block.params.text
				if (!action || !browserActions.includes(action)) {
					// checking for action to ensure it is complete and valid
					if (!block.partial) {
						// if the block is complete and we don't have a valid action this is a mistake
						this.taskState.consecutiveMistakeCount++
						this.pushToolResult(await this.sayAndCreateMissingParamError("browser_action", "action"), block)
						await this.browserSession.closeBrowser()
						await this.saveCheckpoint()
					}
					break
				}

				try {
					if (block.partial) {
						if (action === "launch") {
							if (this.shouldAutoApproveTool(block.name)) {
								this.removeLastPartialMessageIfExistsWithType("ask", "browser_action_launch")
								await this.say(
									"browser_action_launch",
									this.removeClosingTag(block, "url", url),
									undefined,
									undefined,
									block.partial,
								)
							} else {
								this.removeLastPartialMessageIfExistsWithType("say", "browser_action_launch")
								await this.ask(
									"browser_action_launch",
									this.removeClosingTag(block, "url", url),
									block.partial,
								).catch(() => {})
							}
						} else {
							await this.say(
								"browser_action",
								JSON.stringify({
									action: action as BrowserAction,
									coordinate: this.removeClosingTag(block, "coordinate", coordinate),
									text: this.removeClosingTag(block, "text", text),
								} satisfies ClineSayBrowserAction),
								undefined,
								undefined,
								block.partial,
							)
						}
						break
					} else {
						let browserActionResult: BrowserActionResult
						if (action === "launch") {
							if (!url) {
								this.taskState.consecutiveMistakeCount++
								this.pushToolResult(await this.sayAndCreateMissingParamError("browser_action", "url"), block)
								await this.browserSession.closeBrowser()
								await this.saveCheckpoint()
								break
							}
							this.taskState.consecutiveMistakeCount = 0

							if (this.shouldAutoApproveTool(block.name)) {
								this.removeLastPartialMessageIfExistsWithType("ask", "browser_action_launch")
								await this.say("browser_action_launch", url, undefined, undefined, false)
								this.taskState.consecutiveAutoApprovedRequestsCount++
							} else {
								showNotificationForApprovalIfAutoApprovalEnabled(
									`Cline wants to use a browser and launch ${url}`,
									this.autoApprovalSettings.enabled,
									this.autoApprovalSettings.enableNotifications,
								)
								this.removeLastPartialMessageIfExistsWithType("say", "browser_action_launch")
								const didApprove = await this.askApproval("browser_action_launch", block, url)
								if (!didApprove) {
									await this.saveCheckpoint()
									break
								}
							}

							// NOTE: it's okay that we call this message since the partial inspect_site is finished streaming. The only scenario we have to avoid is sending messages WHILE a partial message exists at the end of the messages array. For example the api_req_finished message would interfere with the partial message, so we needed to remove that.
							// await this.say("inspect_site_result", "") // no result, starts the loading spinner waiting for result
							await this.say("browser_action_result", "") // starts loading spinner

							// Re-make browserSession to make sure latest settings apply
							if (this.context) {
								await this.browserSession.dispose()

								const useWebp = this.api ? !modelDoesntSupportWebp(this.api) : true
								this.browserSession = new BrowserSession(this.context, this.browserSettings, useWebp)
							} else {
								console.warn("no controller context available for browserSession")
							}
							await this.browserSession.launchBrowser()
							browserActionResult = await this.browserSession.navigateToUrl(url)
						} else {
							if (action === "click") {
								if (!coordinate) {
									this.taskState.consecutiveMistakeCount++
									this.pushToolResult(
										await this.sayAndCreateMissingParamError("browser_action", "coordinate"),
										block,
									)
									await this.browserSession.closeBrowser()
									await this.saveCheckpoint()
									break // can't be within an inner switch
								}
							}
							if (action === "type") {
								if (!text) {
									this.taskState.consecutiveMistakeCount++
									this.pushToolResult(await this.sayAndCreateMissingParamError("browser_action", "text"), block)
									await this.browserSession.closeBrowser()
									await this.saveCheckpoint()
									break
								}
							}
							this.taskState.consecutiveMistakeCount = 0
							await this.say(
								"browser_action",
								JSON.stringify({
									action: action as BrowserAction,
									coordinate,
									text,
								} satisfies ClineSayBrowserAction),
								undefined,
								undefined,
								false,
							)
							switch (action) {
								case "click":
									browserActionResult = await this.browserSession.click(coordinate!)
									break
								case "type":
									browserActionResult = await this.browserSession.type(text!)
									break
								case "scroll_down":
									browserActionResult = await this.browserSession.scrollDown()
									break
								case "scroll_up":
									browserActionResult = await this.browserSession.scrollUp()
									break
								case "close":
									browserActionResult = await this.browserSession.closeBrowser()
									break
							}
						}

						switch (action) {
							case "launch":
							case "click":
							case "type":
							case "scroll_down":
							case "scroll_up":
								await this.say("browser_action_result", JSON.stringify(browserActionResult))
								this.pushToolResult(
									formatResponse.toolResult(
										`The browser action has been executed. The console logs and screenshot have been captured for your analysis.\n\nConsole logs:\n${
											browserActionResult.logs || "(No new logs)"
										}\n\n(REMEMBER: if you need to proceed to using non-\`browser_action\` tools or launch a new browser, you MUST first close this browser. For example, if after analyzing the logs and screenshot you need to edit a file, you must first close the browser before you can use the write_to_file tool.)`,
										browserActionResult.screenshot ? [browserActionResult.screenshot] : [],
									),
									block,
								)

								if (!block.partial) {
									await this.updateFCListFromToolResponse(block.params.task_progress)
								}

								await this.saveCheckpoint()
								break
							case "close":
								this.pushToolResult(
									formatResponse.toolResult(
										`The browser has been closed. You may now proceed to using other tools.`,
									),
									block,
								)
								await this.saveCheckpoint()
								break
						}

						break
					}
				} catch (error) {
					await this.browserSession.closeBrowser() // if any error occurs, the browser session is terminated
					await this.handleError("executing browser action", error, block)
					await this.saveCheckpoint()
					break
				}
			}
			case "summarize_task": {
				const context: string | undefined = block.params.context
				try {
					if (block.partial) {
						// Show streaming summary generation in tool UI
						const partialMessage = JSON.stringify({
							tool: "summarizeTask",
							content: this.removeClosingTag(block, "context", context),
						} satisfies ClineSayTool)

						await this.say("tool", partialMessage, undefined, undefined, block.partial)
						break
					} else {
						if (!context) {
							this.taskState.consecutiveMistakeCount++
							this.pushToolResult(await this.sayAndCreateMissingParamError("summarize_task", "context"), block)
							await this.saveCheckpoint()
							break
						}
						this.taskState.consecutiveMistakeCount = 0

						// Show completed summary in tool UI
						const completeMessage = JSON.stringify({
							tool: "summarizeTask",
							content: context,
						} satisfies ClineSayTool)

						await this.say("tool", completeMessage, undefined, undefined, false)

						// Use the continuationPrompt to format the tool result
						this.pushToolResult(formatResponse.toolResult(continuationPrompt(context)), block)

						const apiConversationHistory = this.messageStateHandler.getApiConversationHistory()
						const keepStrategy = "none"

						// clear the context history at this point in time. note that this will not include the assistant message
						// for summarizing, which we will need to delete later
						this.taskState.conversationHistoryDeletedRange = this.contextManager.getNextTruncationRange(
							apiConversationHistory,
							this.taskState.conversationHistoryDeletedRange,
							keepStrategy,
						)
						await this.messageStateHandler.saveClineMessagesAndUpdateHistory()
						await this.contextManager.triggerApplyStandardContextTruncationNoticeChange(
							Date.now(),
							await ensureTaskDirectoryExists(this.context, this.taskId),
						)
					}
					await this.saveCheckpoint()
					this.taskState.currentlySummarizing = true
					break
				} catch (error) {
					await this.handleError("summarizing context window", error, block)
					await this.saveCheckpoint()
					break
				}
			}
			case "condense": {
				const context: string | undefined = block.params.context
				try {
					if (block.partial) {
						await this.ask("condense", this.removeClosingTag(block, "context", context), block.partial).catch(
							() => {},
						)
						break
					} else {
						if (!context) {
							this.taskState.consecutiveMistakeCount++
							this.pushToolResult(await this.sayAndCreateMissingParamError("condense", "context"), block)
							await this.saveCheckpoint()
							break
						}
						this.taskState.consecutiveMistakeCount = 0

						if (this.autoApprovalSettings.enabled && this.autoApprovalSettings.enableNotifications) {
							showSystemNotification({
								subtitle: "Cline wants to condense the conversation...",
								message: `Cline is suggesting to condense your conversation with: ${context}`,
							})
						}

						const { text, images, files: condenseFiles } = await this.ask("condense", context, false)

						// If the user provided a response, treat it as feedback
						if (text || (images && images.length > 0) || (condenseFiles && condenseFiles.length > 0)) {
							let fileContentString = ""
							if (condenseFiles && condenseFiles.length > 0) {
								fileContentString = await processFilesIntoText(condenseFiles)
							}

							await this.say("user_feedback", text ?? "", images, condenseFiles)
							this.pushToolResult(
								formatResponse.toolResult(
									`The user provided feedback on the condensed conversation summary:\n<feedback>\n${text}\n</feedback>`,
									images,
									fileContentString,
								),
								block,
							)
						} else {
							// If no response, the user accepted the condensed version
							this.pushToolResult(formatResponse.toolResult(formatResponse.condense()), block)
							const apiConversationHistory = this.messageStateHandler.getApiConversationHistory()
							const lastMessage = apiConversationHistory[apiConversationHistory.length - 1]
							const summaryAlreadyAppended = lastMessage && lastMessage.role === "assistant"
							const keepStrategy = summaryAlreadyAppended ? "lastTwo" : "none"

							// clear the context history at this point in time
							this.taskState.conversationHistoryDeletedRange = this.contextManager.getNextTruncationRange(
								apiConversationHistory,
								this.taskState.conversationHistoryDeletedRange,
								keepStrategy,
							)
							await this.messageStateHandler.saveClineMessagesAndUpdateHistory()
							await this.contextManager.triggerApplyStandardContextTruncationNoticeChange(
								Date.now(),
								await ensureTaskDirectoryExists(this.context, this.taskId),
							)
						}
						await this.saveCheckpoint()
						break
					}
				} catch (error) {
					await this.handleError("condensing context window", error, block)
					await this.saveCheckpoint()
					break
				}
			}
			case "report_bug": {
				const title = block.params.title
				const what_happened = block.params.what_happened
				const steps_to_reproduce = block.params.steps_to_reproduce
				const api_request_output = block.params.api_request_output
				const additional_context = block.params.additional_context

				try {
					if (block.partial) {
						await this.ask(
							"report_bug",
							JSON.stringify({
								title: this.removeClosingTag(block, "title", title),
								what_happened: this.removeClosingTag(block, "what_happened", what_happened),
								steps_to_reproduce: this.removeClosingTag(block, "steps_to_reproduce", steps_to_reproduce),
								api_request_output: this.removeClosingTag(block, "api_request_output", api_request_output),
								additional_context: this.removeClosingTag(block, "additional_context", additional_context),
							}),
							block.partial,
						).catch(() => {})
						break
					} else {
						if (!title) {
							this.taskState.consecutiveMistakeCount++
							this.pushToolResult(await this.sayAndCreateMissingParamError("report_bug", "title"), block)
							await this.saveCheckpoint()
							break
						}
						if (!what_happened) {
							this.taskState.consecutiveMistakeCount++
							this.pushToolResult(await this.sayAndCreateMissingParamError("report_bug", "what_happened"), block)
							await this.saveCheckpoint()
							break
						}
						if (!steps_to_reproduce) {
							this.taskState.consecutiveMistakeCount++
							this.pushToolResult(
								await this.sayAndCreateMissingParamError("report_bug", "steps_to_reproduce"),
								block,
							)
							await this.saveCheckpoint()
							break
						}
						if (!api_request_output) {
							this.taskState.consecutiveMistakeCount++
							this.pushToolResult(
								await this.sayAndCreateMissingParamError("report_bug", "api_request_output"),
								block,
							)
							await this.saveCheckpoint()
							break
						}
						if (!additional_context) {
							this.taskState.consecutiveMistakeCount++
							this.pushToolResult(
								await this.sayAndCreateMissingParamError("report_bug", "additional_context"),
								block,
							)
							await this.saveCheckpoint()
							break
						}

						this.taskState.consecutiveMistakeCount = 0

						if (this.autoApprovalSettings.enabled && this.autoApprovalSettings.enableNotifications) {
							showSystemNotification({
								subtitle: "Cline wants to create a github issue...",
								message: `Cline is suggesting to create a github issue with the title: ${title}`,
							})
						}

						// Derive system information values algorithmically
						const operatingSystem = os.platform() + " " + os.release()
						const clineVersion =
							vscode.extensions.getExtension("saoudrizwan.claude-dev")?.packageJSON.version || "Unknown"
						const systemInfo = `VSCode: ${vscode.version}, Node.js: ${process.version}, Architecture: ${os.arch()}`
						const currentMode = this.mode
						const apiConfig = this.cacheService.getApiConfiguration()
						const apiProvider = currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider
						const providerAndModel = `${apiProvider} / ${this.api.getModel().id}`

						// Ask user for confirmation
						const bugReportData = JSON.stringify({
							title,
							what_happened,
							steps_to_reproduce,
							api_request_output,
							additional_context,
							// Include derived values in the JSON for display purposes
							provider_and_model: providerAndModel,
							operating_system: operatingSystem,
							system_info: systemInfo,
							cline_version: clineVersion,
						})

						const { text, images, files: reportBugFiles } = await this.ask("report_bug", bugReportData, false)

						// If the user provided a response, treat it as feedback
						if (text || (images && images.length > 0) || (reportBugFiles && reportBugFiles.length > 0)) {
							let fileContentString = ""
							if (reportBugFiles && reportBugFiles.length > 0) {
								fileContentString = await processFilesIntoText(reportBugFiles)
							}

							await this.say("user_feedback", text ?? "", images, reportBugFiles)
							this.pushToolResult(
								formatResponse.toolResult(
									`The user did not submit the bug, and provided feedback on the Github issue generated instead:\n<feedback>\n${text}\n</feedback>`,
									images,
									fileContentString,
								),
								block,
							)
						} else {
							// If no response, the user accepted the condensed version
							this.pushToolResult(
								formatResponse.toolResult(`The user accepted the creation of the Github issue.`),
								block,
							)

							try {
								// Create a Map of parameters for the GitHub issue
								const params = new Map<string, string>()
								params.set("title", title)
								params.set("operating-system", operatingSystem)
								params.set("cline-version", clineVersion)
								params.set("system-info", systemInfo)
								params.set("additional-context", additional_context)
								params.set("what-happened", what_happened)
								params.set("steps", steps_to_reproduce)
								params.set("provider-model", providerAndModel)
								params.set("logs", api_request_output)

								// Use our utility function to create and open the GitHub issue URL
								// This bypasses VS Code's URI handling issues with special characters
								await createAndOpenGitHubIssue("cline", "cline", "bug_report.yml", params)
							} catch (error) {
								console.error(`An error occurred while attempting to report the bug: ${error}`)
							}
						}
						await this.saveCheckpoint()
						break
					}
				} catch (error) {
					await this.handleError("reporting bug", error, block)
					await this.saveCheckpoint()
					break
				}
			}
		}
	}
}
