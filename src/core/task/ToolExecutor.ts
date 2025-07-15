import { showSystemNotification } from "@/integrations/notifications"
import { listFiles } from "@/services/glob/list-files"
import { telemetryService } from "@/services/posthog/telemetry/TelemetryService"
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
import { extractTextFromFile, processFilesIntoText } from "@integrations/misc/extract-text"
import WorkspaceTracker from "@integrations/workspace/WorkspaceTracker"
import { BrowserSession } from "@services/browser/BrowserSession"
import { UrlContentFetcher } from "@services/browser/UrlContentFetcher"
import { McpHub } from "@services/mcp/McpHub"
import { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import { BrowserSettings } from "@shared/BrowserSettings"
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
import { COMMAND_REQ_APP_STRING } from "@shared/combineCommandSequences"
import { fileExistsAtPath } from "@utils/fs"
import { isClaude4ModelFamily, isGemini2dot5ModelFamily } from "@utils/model-utils"
import { fixModelHtmlEscaping, removeInvalidChars } from "@utils/string"
import { setTimeout as setTimeoutPromise } from "node:timers/promises"
import os from "os"
import * as path from "path"
import { serializeError } from "serialize-error"
import * as vscode from "vscode"
import { ToolResponse, USE_EXPERIMENTAL_CLAUDE4_FEATURES } from "."
import { ToolParamName, ToolUse, ToolUseName } from "../assistant-message"
import { constructNewFileContent } from "../assistant-message/diff"
import { ChangeLocation, StreamingJsonReplacer } from "../assistant-message/diff-json"
import { ContextManager } from "../context/context-management/ContextManager"
import { loadMcpDocumentation } from "../prompts/loadMcpDocumentation"
import { formatResponse } from "../prompts/responses"
import { ensureTaskDirectoryExists } from "../storage/disk"
import { getGlobalState, getWorkspaceState } from "../storage/state"
import { TaskState } from "./TaskState"
import { MessageStateHandler } from "./message-state"
import { AutoApprove } from "./tools/autoApprove"
import { showNotificationForApprovalIfAutoApprovalEnabled } from "./utils"

export class ToolExecutor {
	private autoApprover: AutoApprove

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
		private workspaceTracker: WorkspaceTracker,
		private contextManager: ContextManager,

		// Configuration & Settings
		private autoApprovalSettings: AutoApprovalSettings,
		private browserSettings: BrowserSettings,
		private cwd: string,
		private taskId: string,

		// Callbacks to the Task (Entity)
		private say: (
			type: ClineSay,
			text?: string,
			images?: string[],
			files?: string[],
			partial?: boolean,
		) => Promise<undefined>,
		private ask: (
			type: ClineAsk,
			text?: string,
			partial?: boolean,
		) => Promise<{ response: ClineAskResponse; text?: string; images?: string[]; files?: string[] }>,
		private saveCheckpoint: (isAttemptCompletionMessage?: boolean) => Promise<void>,
		private sayAndCreateMissingParamError: (toolName: ToolUseName, paramName: string, relPath?: string) => Promise<any>,
		private removeLastPartialMessageIfExistsWithType: (type: "ask" | "say", askOrSay: ClineAsk | ClineSay) => Promise<void>,
		private executeCommandTool: (command: string) => Promise<[boolean, any]>,
		private doesLatestTaskCompletionHaveNewChanges: () => Promise<boolean>,
	) {
		this.autoApprover = new AutoApprove(autoApprovalSettings)
	}

	/**
	 * Updates the auto approval settings
	 */
	public updateAutoApprovalSettings(settings: AutoApprovalSettings): void {
		this.autoApprover.updateSettings(settings)
	}

	private pushToolResult = (content: ToolResponse, block: ToolUse) => {
		const isNextGenModel = isClaude4ModelFamily(this.api) || isGemini2dot5ModelFamily(this.api)

		if (typeof content === "string") {
			const resultText = content || "(tool did not return anything)"

			if (isNextGenModel && USE_EXPERIMENTAL_CLAUDE4_FEATURES) {
				// Claude 4 family: Use function_results format
				this.taskState.userMessageContent.push({
					type: "text",
					text: `<function_results>\n${resultText}\n</function_results>`,
				})
			} else {
				// Non-Claude 4: Use traditional format with header
				this.taskState.userMessageContent.push({
					type: "text",
					text: `${this.toolDescription(block)} Result:`,
				})
				this.taskState.userMessageContent.push({
					type: "text",
					text: resultText,
				})
			}
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

	// Handle streaming JSON replacement for Claude 4 model family
	private async handleStreamingJsonReplacement(
		block: any,
		relPath: string,
		currentFullJson: string,
	): Promise<{ shouldBreak: boolean; newContent?: string; error?: string }> {
		// Calculate the delta - what's new since last time
		const newJsonChunk = currentFullJson.substring(this.taskState.lastProcessedJsonLength)
		if (block.partial) {
			// Initialize on first chunk
			if (!this.taskState.streamingJsonReplacer) {
				if (!this.diffViewProvider.isEditing) {
					await this.diffViewProvider.open(relPath)
				}

				// Set up callbacks
				const onContentUpdated = (newContent: string, _isFinalItem: boolean, changeLocation?: ChangeLocation) => {
					// Update diff view incrementally
					this.diffViewProvider.update(newContent, false, changeLocation)
				}

				const onError = (error: Error) => {
					console.error("StreamingJsonReplacer error:", error)
					console.log("Failed StreamingJsonReplacer update:")
					// Handle error: push tool result, cleanup
					this.taskState.userMessageContent.push({
						type: "text",
						text: formatResponse.toolError(`JSON replacement error: ${error.message}`),
					})
					this.taskState.didAlreadyUseTool = true
					this.taskState.userMessageContentReady = true
					this.taskState.streamingJsonReplacer = undefined
					this.taskState.lastProcessedJsonLength = 0
					throw error
				}

				this.taskState.streamingJsonReplacer = new StreamingJsonReplacer(
					this.diffViewProvider.originalContent || "",
					onContentUpdated,
					onError,
				)
				this.taskState.lastProcessedJsonLength = 0
			}

			// Feed only the new chunk
			if (newJsonChunk.length > 0) {
				try {
					this.taskState.streamingJsonReplacer.write(newJsonChunk)
					this.taskState.lastProcessedJsonLength = currentFullJson.length
				} catch (e) {
					// Handle write error
					return { shouldBreak: true, error: `Write error: ${e}` }
				}
			}

			return { shouldBreak: true } // Wait for more chunks
		} else {
			// Final chunk (!block.partial)
			if (!this.taskState.streamingJsonReplacer) {
				// JSON came all at once, initialize
				if (!this.diffViewProvider.isEditing) {
					await this.diffViewProvider.open(relPath)
				}

				// Initialize StreamingJsonReplacer for non-streaming case
				const onContentUpdated = (newContent: string, _isFinalItem: boolean, changeLocation?: ChangeLocation) => {
					// Update diff view incrementally
					this.diffViewProvider.update(newContent, false, changeLocation)
				}

				const onError = (error: Error) => {
					console.error("StreamingJsonReplacer error:", error)
					// Handle error
					this.taskState.userMessageContent.push({
						type: "text",
						text: formatResponse.toolError(`JSON replacement error: ${error.message}`),
					})
					this.taskState.didAlreadyUseTool = true
					this.taskState.userMessageContentReady = true
					throw error
				}

				this.taskState.streamingJsonReplacer = new StreamingJsonReplacer(
					this.diffViewProvider.originalContent || "",
					onContentUpdated,
					onError,
				)

				// Write the entire JSON at once
				this.taskState.streamingJsonReplacer.write(currentFullJson)

				// Get the final content
				const newContent = this.taskState.streamingJsonReplacer.getCurrentContent()

				// Cleanup
				this.taskState.streamingJsonReplacer = undefined
				this.taskState.lastProcessedJsonLength = 0

				// Update diff view with final content
				await this.diffViewProvider.update(newContent, true)

				return { shouldBreak: false, newContent }
			}

			// Feed final delta
			if (newJsonChunk.length > 0) {
				this.taskState.streamingJsonReplacer.write(newJsonChunk)
			}

			const newContent = this.taskState.streamingJsonReplacer.getCurrentContent()

			// Get final list of replacements
			const allReplacements = this.taskState.streamingJsonReplacer.getSuccessfullyParsedItems()

			// Cleanup
			this.taskState.streamingJsonReplacer = undefined
			this.taskState.lastProcessedJsonLength = 0

			// Update diff view with final content
			await this.diffViewProvider.update(newContent, true)

			return { shouldBreak: false, newContent }
		}
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

		if (block.name !== "browser_action") {
			await this.browserSession.closeBrowser()
		}

		switch (block.name) {
			case "new_rule":
			case "write_to_file":
			case "replace_in_file": {
				const relPath: string | undefined = block.params.path
				let content: string | undefined = block.params.content // for write_to_file
				let diff: string | undefined = block.params.diff // for replace_in_file
				if (!relPath || (!content && !diff)) {
					// checking for content/diff ensures relPath is complete
					// wait so we can determine if it's a new file or editing an existing file
					break
				}

				const accessAllowed = this.clineIgnoreController.validateAccess(relPath)
				if (!accessAllowed) {
					await this.say("clineignore_error", relPath)
					this.pushToolResult(formatResponse.toolError(formatResponse.clineIgnoreError(relPath)), block)
					await this.saveCheckpoint()
					break
				}

				// Check if file exists using cached map or fs.access
				let fileExists: boolean
				if (this.diffViewProvider.editType !== undefined) {
					fileExists = this.diffViewProvider.editType === "modify"
				} else {
					const absolutePath = path.resolve(this.cwd, relPath)
					fileExists = await fileExistsAtPath(absolutePath)
					this.diffViewProvider.editType = fileExists ? "modify" : "create"
				}

				try {
					// Construct newContent from diff
					let newContent: string
					newContent = "" // default to original content if not editing
					if (diff) {
						if (!this.api.getModel().id.includes("claude")) {
							// deepseek models tend to use unescaped html entities in diffs
							diff = fixModelHtmlEscaping(diff)
							diff = removeInvalidChars(diff)
						}

						// open the editor if not done already.  This is to fix diff error when model provides correct search-replace text but Cline throws error
						// because file is not open.
						if (!this.diffViewProvider.isEditing) {
							await this.diffViewProvider.open(relPath)
						}

						const currentFullJson = block.params.diff
						// Check if we should use streaming (e.g., for specific models)
						const isNextGenModel = isClaude4ModelFamily(this.api) || isGemini2dot5ModelFamily(this.api)
						// Going through claude family of models
						if (isNextGenModel && USE_EXPERIMENTAL_CLAUDE4_FEATURES && currentFullJson) {
							const streamingResult = await this.handleStreamingJsonReplacement(block, relPath, currentFullJson)

							if (streamingResult.error) {
								await this.say("diff_error", relPath)
								this.pushToolResult(formatResponse.toolError(streamingResult.error), block)
								await this.diffViewProvider.revertChanges()
								await this.diffViewProvider.reset()
								await this.saveCheckpoint()
								break
							}

							if (streamingResult.shouldBreak) {
								break // Wait for more chunks or handle initialization
							}

							// If we get here, we have the final content
							if (streamingResult.newContent) {
								newContent = streamingResult.newContent
								// Continue with approval flow...
							}
						} else {
							try {
								newContent = await constructNewFileContent(
									diff,
									this.diffViewProvider.originalContent || "",
									!block.partial,
								)
							} catch (error) {
								await this.say("diff_error", relPath)

								// Extract error type from error message if possible, or use a generic type
								const errorType =
									error instanceof Error && error.message.includes("does not match anything")
										? "search_not_found"
										: "other_diff_error"

								// Add telemetry for diff edit failure
								telemetryService.captureDiffEditFailure(this.taskId, this.api.getModel().id, errorType)

								this.pushToolResult(
									formatResponse.toolError(
										`${(error as Error)?.message}\n\n` +
											formatResponse.diffError(relPath, this.diffViewProvider.originalContent),
									),
									block,
								)
								await this.diffViewProvider.revertChanges()
								await this.diffViewProvider.reset()
								await this.saveCheckpoint()
								break
							}
						}
					} else if (content) {
						newContent = content

						// pre-processing newContent for cases where weaker models might add artifacts like markdown codeblock markers (deepseek/llama) or extra escape characters (gemini)
						if (newContent.startsWith("```")) {
							// this handles cases where it includes language specifiers like ```python ```js
							newContent = newContent.split("\n").slice(1).join("\n").trim()
						}
						if (newContent.endsWith("```")) {
							newContent = newContent.split("\n").slice(0, -1).join("\n").trim()
						}

						if (!this.api.getModel().id.includes("claude")) {
							// it seems not just llama models are doing this, but also gemini and potentially others
							newContent = fixModelHtmlEscaping(newContent)
							newContent = removeInvalidChars(newContent)
						}
					} else {
						// can't happen, since we already checked for content/diff above. but need to do this for type error
						break
					}

					newContent = newContent.trimEnd() // remove any trailing newlines, since it's automatically inserted by the editor

					const sharedMessageProps: ClineSayTool = {
						tool: fileExists ? "editedExistingFile" : "newFileCreated",
						path: getReadablePath(this.cwd, this.removeClosingTag(block, "path", relPath)),
						content: diff || content,
						operationIsLocatedInWorkspace: await isLocatedInWorkspace(relPath),
					}

					if (block.partial) {
						// update gui message
						const partialMessage = JSON.stringify(sharedMessageProps)

						if (await this.shouldAutoApproveToolWithPath(block.name, relPath)) {
							this.removeLastPartialMessageIfExistsWithType("ask", "tool") // in case the user changes auto-approval settings mid stream
							await this.say("tool", partialMessage, undefined, undefined, block.partial)
						} else {
							this.removeLastPartialMessageIfExistsWithType("say", "tool")
							await this.ask("tool", partialMessage, block.partial).catch(() => {})
						}
						// update editor
						if (!this.diffViewProvider.isEditing) {
							// open the editor and prepare to stream content in
							await this.diffViewProvider.open(relPath)
						}
						// editor is open, stream content in
						await this.diffViewProvider.update(newContent, false)
						break
					} else {
						if (!relPath) {
							this.taskState.consecutiveMistakeCount++
							this.pushToolResult(await this.sayAndCreateMissingParamError(block.name, "path"), block)
							await this.diffViewProvider.reset()
							await this.saveCheckpoint()
							break
						}
						if (block.name === "replace_in_file" && !diff) {
							this.taskState.consecutiveMistakeCount++
							this.pushToolResult(await this.sayAndCreateMissingParamError("replace_in_file", "diff"), block)
							await this.diffViewProvider.reset()
							await this.saveCheckpoint()
							break
						}
						if (block.name === "write_to_file" && !content) {
							this.taskState.consecutiveMistakeCount++
							this.pushToolResult(await this.sayAndCreateMissingParamError("write_to_file", "content"), block)
							await this.diffViewProvider.reset()
							await this.saveCheckpoint()
							break
						}
						if (block.name === "new_rule" && !content) {
							this.taskState.consecutiveMistakeCount++
							this.pushToolResult(await this.sayAndCreateMissingParamError("new_rule", "content"), block)
							await this.diffViewProvider.reset()
							await this.saveCheckpoint()
							break
						}

						this.taskState.consecutiveMistakeCount = 0

						// if isEditingFile false, that means we have the full contents of the file already.
						// it's important to note how this function works, you can't make the assumption that the block.partial conditional will always be called since it may immediately get complete, non-partial data. So this part of the logic will always be called.
						// in other words, you must always repeat the block.partial logic here
						if (!this.diffViewProvider.isEditing) {
							// show gui message before showing edit animation
							const partialMessage = JSON.stringify(sharedMessageProps)
							await this.ask("tool", partialMessage, true).catch(() => {}) // sending true for partial even though it's not a partial, this shows the edit row before the content is streamed into the editor
							await this.diffViewProvider.open(relPath)
						}
						await this.diffViewProvider.update(newContent, true)
						await setTimeoutPromise(300) // wait for diff view to update
						this.diffViewProvider.scrollToFirstDiff()
						// showOmissionWarning(this.diffViewProvider.originalContent || "", newContent)

						const completeMessage = JSON.stringify({
							...sharedMessageProps,
							content: diff || content,
							operationIsLocatedInWorkspace: await isLocatedInWorkspace(relPath),
							// ? formatResponse.createPrettyPatch(
							// 		relPath,
							// 		this.diffViewProvider.originalContent,
							// 		newContent,
							// 	)
							// : undefined,
						} satisfies ClineSayTool)
						if (await this.shouldAutoApproveToolWithPath(block.name, relPath)) {
							this.removeLastPartialMessageIfExistsWithType("ask", "tool")
							await this.say("tool", completeMessage, undefined, undefined, false)
							this.taskState.consecutiveAutoApprovedRequestsCount++
							telemetryService.captureToolUsage(this.taskId, block.name, this.api.getModel().id, true, true)

							// we need an artificial delay to let the diagnostics catch up to the changes
							await setTimeoutPromise(3_500)
						} else {
							// If auto-approval is enabled but this tool wasn't auto-approved, send notification
							showNotificationForApprovalIfAutoApprovalEnabled(
								`Cline wants to ${fileExists ? "edit" : "create"} ${path.basename(relPath)}`,
								this.autoApprovalSettings.enabled,
								this.autoApprovalSettings.enableNotifications,
							)
							this.removeLastPartialMessageIfExistsWithType("say", "tool")

							// Need a more customized tool response for file edits to highlight the fact that the file was not updated (particularly important for deepseek)
							let didApprove = true
							const { response, text, images, files: askFiles } = await this.ask("tool", completeMessage, false)
							if (response !== "yesButtonClicked") {
								// User either sent a message or pressed reject button
								// TODO: add similar context for other tool denial responses, to emphasize ie that a command was not run
								const fileDeniedNote = fileExists
									? "The file was not updated, and maintains its original contents."
									: "The file was not created."
								this.pushToolResult(`The user denied this operation. ${fileDeniedNote}`, block)
								if (text || (images && images.length > 0) || (askFiles && askFiles.length > 0)) {
									let fileContentString = ""
									if (askFiles && askFiles.length > 0) {
										fileContentString = await processFilesIntoText(askFiles)
									}

									this.pushAdditionalToolFeedback(text, images, fileContentString)
									await this.say("user_feedback", text, images, askFiles)
									await this.saveCheckpoint()
								}
								this.taskState.didRejectTool = true
								didApprove = false
								telemetryService.captureToolUsage(this.taskId, block.name, this.api.getModel().id, false, false)
							} else {
								// User hit the approve button, and may have provided feedback
								if (text || (images && images.length > 0) || (askFiles && askFiles.length > 0)) {
									let fileContentString = ""
									if (askFiles && askFiles.length > 0) {
										fileContentString = await processFilesIntoText(askFiles)
									}

									this.pushAdditionalToolFeedback(text, images, fileContentString)
									await this.say("user_feedback", text, images, askFiles)
									await this.saveCheckpoint()
								}
								telemetryService.captureToolUsage(this.taskId, block.name, this.api.getModel().id, false, true)
							}

							if (!didApprove) {
								await this.diffViewProvider.revertChanges()
								await this.saveCheckpoint()
								break
							}
						}

						// Mark the file as edited by Cline to prevent false "recently modified" warnings
						this.fileContextTracker.markFileAsEditedByCline(relPath)

						const { newProblemsMessage, userEdits, autoFormattingEdits, finalContent } =
							await this.diffViewProvider.saveChanges()
						this.taskState.didEditFile = true // used to determine if we should wait for busy terminal to update before sending api request

						// Track file edit operation
						await this.fileContextTracker.trackFileContext(relPath, "cline_edited")

						if (userEdits) {
							// Track file edit operation
							await this.fileContextTracker.trackFileContext(relPath, "user_edited")

							await this.say(
								"user_feedback_diff",
								JSON.stringify({
									tool: fileExists ? "editedExistingFile" : "newFileCreated",
									path: getReadablePath(this.cwd, relPath),
									diff: userEdits,
								} satisfies ClineSayTool),
							)
							this.pushToolResult(
								formatResponse.fileEditWithUserChanges(
									relPath,
									userEdits,
									autoFormattingEdits,
									finalContent,
									newProblemsMessage,
								),
								block,
							)
						} else {
							this.pushToolResult(
								formatResponse.fileEditWithoutUserChanges(
									relPath,
									autoFormattingEdits,
									finalContent,
									newProblemsMessage,
								),
								block,
							)
						}

						if (!fileExists) {
							this.workspaceTracker.populateFilePaths()
						}

						await this.diffViewProvider.reset()

						await this.saveCheckpoint()

						break
					}
				} catch (error) {
					await this.handleError("writing file", error, block)
					await this.diffViewProvider.revertChanges()
					await this.diffViewProvider.reset()
					await this.saveCheckpoint()
					break
				}
			}
			case "read_file": {
				const relPath: string | undefined = block.params.path
				const sharedMessageProps: ClineSayTool = {
					tool: "readFile",
					path: getReadablePath(this.cwd, this.removeClosingTag(block, "path", relPath)),
				}
				try {
					if (block.partial) {
						const partialMessage = JSON.stringify({
							...sharedMessageProps,
							content: undefined,
							operationIsLocatedInWorkspace: await isLocatedInWorkspace(relPath),
						} satisfies ClineSayTool)
						if (await this.shouldAutoApproveToolWithPath(block.name, block.params.path)) {
							this.removeLastPartialMessageIfExistsWithType("ask", "tool")
							await this.say("tool", partialMessage, undefined, undefined, block.partial)
						} else {
							this.removeLastPartialMessageIfExistsWithType("say", "tool")
							await this.ask("tool", partialMessage, block.partial).catch(() => {})
						}
						break
					} else {
						if (!relPath) {
							this.taskState.consecutiveMistakeCount++
							this.pushToolResult(await this.sayAndCreateMissingParamError("read_file", "path"), block)
							await this.saveCheckpoint()
							break
						}

						const accessAllowed = this.clineIgnoreController.validateAccess(relPath)
						if (!accessAllowed) {
							await this.say("clineignore_error", relPath)
							this.pushToolResult(formatResponse.toolError(formatResponse.clineIgnoreError(relPath)), block)
							await this.saveCheckpoint()
							break
						}

						this.taskState.consecutiveMistakeCount = 0
						const absolutePath = path.resolve(this.cwd, relPath)
						const completeMessage = JSON.stringify({
							...sharedMessageProps,
							content: absolutePath,
							operationIsLocatedInWorkspace: await isLocatedInWorkspace(relPath),
						} satisfies ClineSayTool)
						if (await this.shouldAutoApproveToolWithPath(block.name, block.params.path)) {
							this.removeLastPartialMessageIfExistsWithType("ask", "tool")
							await this.say("tool", completeMessage, undefined, undefined, false) // need to be sending partialValue bool, since undefined has its own purpose in that the message is treated neither as a partial or completion of a partial, but as a single complete message
							this.taskState.consecutiveAutoApprovedRequestsCount++
							telemetryService.captureToolUsage(this.taskId, block.name, this.api.getModel().id, true, true)
						} else {
							showNotificationForApprovalIfAutoApprovalEnabled(
								`Cline wants to read ${path.basename(absolutePath)}`,
								this.autoApprovalSettings.enabled,
								this.autoApprovalSettings.enableNotifications,
							)
							this.removeLastPartialMessageIfExistsWithType("say", "tool")
							const didApprove = await this.askApproval("tool", block, completeMessage)
							if (!didApprove) {
								await this.saveCheckpoint()
								telemetryService.captureToolUsage(this.taskId, block.name, this.api.getModel().id, false, false)
								break
							}
							telemetryService.captureToolUsage(this.taskId, block.name, this.api.getModel().id, false, true)
						}
						// now execute the tool like normal
						const content = await extractTextFromFile(absolutePath)

						// Track file read operation
						await this.fileContextTracker.trackFileContext(relPath, "read_tool")

						this.pushToolResult(content, block)
						await this.saveCheckpoint()
						break
					}
				} catch (error) {
					await this.handleError("reading file", error, block)
					await this.saveCheckpoint()
					break
				}
			}
			case "list_files": {
				const relDirPath: string | undefined = block.params.path
				const recursiveRaw: string | undefined = block.params.recursive
				const recursive = recursiveRaw?.toLowerCase() === "true"
				const sharedMessageProps: ClineSayTool = {
					tool: !recursive ? "listFilesTopLevel" : "listFilesRecursive",
					path: getReadablePath(this.cwd, this.removeClosingTag(block, "path", relDirPath)),
				}
				try {
					if (block.partial) {
						const partialMessage = JSON.stringify({
							...sharedMessageProps,
							content: "",
							operationIsLocatedInWorkspace: await isLocatedInWorkspace(block.params.path),
						} satisfies ClineSayTool)
						if (await this.shouldAutoApproveToolWithPath(block.name, block.params.path)) {
							this.removeLastPartialMessageIfExistsWithType("ask", "tool")
							await this.say("tool", partialMessage, undefined, undefined, block.partial)
						} else {
							this.removeLastPartialMessageIfExistsWithType("say", "tool")
							await this.ask("tool", partialMessage, block.partial).catch(() => {})
						}
						break
					} else {
						if (!relDirPath) {
							this.taskState.consecutiveMistakeCount++
							this.pushToolResult(await this.sayAndCreateMissingParamError("list_files", "path"), block)
							await this.saveCheckpoint()
							break
						}
						this.taskState.consecutiveMistakeCount = 0

						const absolutePath = path.resolve(this.cwd, relDirPath)

						const [files, didHitLimit] = await listFiles(absolutePath, recursive, 200)

						const result = formatResponse.formatFilesList(
							absolutePath,
							files,
							didHitLimit,
							this.clineIgnoreController,
						)
						const completeMessage = JSON.stringify({
							...sharedMessageProps,
							content: result,
							operationIsLocatedInWorkspace: await isLocatedInWorkspace(block.params.path),
						} satisfies ClineSayTool)
						if (await this.shouldAutoApproveToolWithPath(block.name, block.params.path)) {
							this.removeLastPartialMessageIfExistsWithType("ask", "tool")
							await this.say("tool", completeMessage, undefined, undefined, false)
							this.taskState.consecutiveAutoApprovedRequestsCount++
							telemetryService.captureToolUsage(this.taskId, block.name, this.api.getModel().id, true, true)
						} else {
							showNotificationForApprovalIfAutoApprovalEnabled(
								`Cline wants to view directory ${path.basename(absolutePath)}/`,
								this.autoApprovalSettings.enabled,
								this.autoApprovalSettings.enableNotifications,
							)
							this.removeLastPartialMessageIfExistsWithType("say", "tool")
							const didApprove = await this.askApproval("tool", block, completeMessage)
							if (!didApprove) {
								telemetryService.captureToolUsage(this.taskId, block.name, this.api.getModel().id, false, false)
								await this.saveCheckpoint()
								break
							}
							telemetryService.captureToolUsage(this.taskId, block.name, this.api.getModel().id, false, true)
						}
						this.pushToolResult(result, block)
						await this.saveCheckpoint()
						break
					}
				} catch (error) {
					await this.handleError("listing files", error, block)
					await this.saveCheckpoint()
					break
				}
			}
			case "list_code_definition_names": {
				const relDirPath: string | undefined = block.params.path
				const sharedMessageProps: ClineSayTool = {
					tool: "listCodeDefinitionNames",
					path: getReadablePath(this.cwd, this.removeClosingTag(block, "path", relDirPath)),
				}
				try {
					if (block.partial) {
						const partialMessage = JSON.stringify({
							...sharedMessageProps,
							content: "",
							operationIsLocatedInWorkspace: await isLocatedInWorkspace(block.params.path),
						} satisfies ClineSayTool)
						if (await this.shouldAutoApproveToolWithPath(block.name, block.params.path)) {
							this.removeLastPartialMessageIfExistsWithType("ask", "tool")
							await this.say("tool", partialMessage, undefined, undefined, block.partial)
						} else {
							this.removeLastPartialMessageIfExistsWithType("say", "tool")
							await this.ask("tool", partialMessage, block.partial).catch(() => {})
						}
						break
					} else {
						if (!relDirPath) {
							this.taskState.consecutiveMistakeCount++
							this.pushToolResult(
								await this.sayAndCreateMissingParamError("list_code_definition_names", "path"),
								block,
							)
							await this.saveCheckpoint()
							break
						}

						this.taskState.consecutiveMistakeCount = 0

						const absolutePath = path.resolve(this.cwd, relDirPath)
						const result = await parseSourceCodeForDefinitionsTopLevel(absolutePath, this.clineIgnoreController)

						const completeMessage = JSON.stringify({
							...sharedMessageProps,
							content: result,
							operationIsLocatedInWorkspace: await isLocatedInWorkspace(block.params.path),
						} satisfies ClineSayTool)
						if (await this.shouldAutoApproveToolWithPath(block.name, block.params.path)) {
							this.removeLastPartialMessageIfExistsWithType("ask", "tool")
							await this.say("tool", completeMessage, undefined, undefined, false)
							this.taskState.consecutiveAutoApprovedRequestsCount++
							telemetryService.captureToolUsage(this.taskId, block.name, this.api.getModel().id, true, true)
						} else {
							showNotificationForApprovalIfAutoApprovalEnabled(
								`Cline wants to view source code definitions in ${path.basename(absolutePath)}/`,
								this.autoApprovalSettings.enabled,
								this.autoApprovalSettings.enableNotifications,
							)
							this.removeLastPartialMessageIfExistsWithType("say", "tool")
							const didApprove = await this.askApproval("tool", block, completeMessage)
							if (!didApprove) {
								telemetryService.captureToolUsage(this.taskId, block.name, this.api.getModel().id, false, false)
								await this.saveCheckpoint()
								break
							}
							telemetryService.captureToolUsage(this.taskId, block.name, this.api.getModel().id, false, true)
						}
						this.pushToolResult(result, block)
						await this.saveCheckpoint()
						break
					}
				} catch (error) {
					await this.handleError("parsing source code definitions", error, block)
					await this.saveCheckpoint()
					break
				}
			}
			case "search_files": {
				const relDirPath: string | undefined = block.params.path
				const regex: string | undefined = block.params.regex
				const filePattern: string | undefined = block.params.file_pattern
				const sharedMessageProps: ClineSayTool = {
					tool: "searchFiles",
					path: getReadablePath(this.cwd, this.removeClosingTag(block, "path", relDirPath)),
					regex: this.removeClosingTag(block, "regex", regex),
					filePattern: this.removeClosingTag(block, "file_pattern", filePattern),
				}
				try {
					if (block.partial) {
						const partialMessage = JSON.stringify({
							...sharedMessageProps,
							content: "",
							operationIsLocatedInWorkspace: await isLocatedInWorkspace(block.params.path),
						} satisfies ClineSayTool)
						if (await this.shouldAutoApproveToolWithPath(block.name, block.params.path)) {
							this.removeLastPartialMessageIfExistsWithType("ask", "tool")
							await this.say("tool", partialMessage, undefined, undefined, block.partial)
						} else {
							this.removeLastPartialMessageIfExistsWithType("say", "tool")
							await this.ask("tool", partialMessage, block.partial).catch(() => {})
						}
						break
					} else {
						if (!relDirPath) {
							this.taskState.consecutiveMistakeCount++
							this.pushToolResult(await this.sayAndCreateMissingParamError("search_files", "path"), block)
							await this.saveCheckpoint()
							break
						}
						if (!regex) {
							this.taskState.consecutiveMistakeCount++
							this.pushToolResult(await this.sayAndCreateMissingParamError("search_files", "regex"), block)
							await this.saveCheckpoint()
							break
						}
						this.taskState.consecutiveMistakeCount = 0

						const absolutePath = path.resolve(this.cwd, relDirPath)
						const results = await regexSearchFiles(
							this.cwd,
							absolutePath,
							regex,
							filePattern,
							this.clineIgnoreController,
						)

						const completeMessage = JSON.stringify({
							...sharedMessageProps,
							content: results,
							operationIsLocatedInWorkspace: await isLocatedInWorkspace(block.params.path),
						} satisfies ClineSayTool)
						if (await this.shouldAutoApproveToolWithPath(block.name, block.params.path)) {
							this.removeLastPartialMessageIfExistsWithType("ask", "tool")
							await this.say("tool", completeMessage, undefined, undefined, false)
							this.taskState.consecutiveAutoApprovedRequestsCount++
							telemetryService.captureToolUsage(this.taskId, block.name, this.api.getModel().id, true, true)
						} else {
							showNotificationForApprovalIfAutoApprovalEnabled(
								`Cline wants to search files in ${path.basename(absolutePath)}/`,
								this.autoApprovalSettings.enabled,
								this.autoApprovalSettings.enableNotifications,
							)
							this.removeLastPartialMessageIfExistsWithType("say", "tool")
							const didApprove = await this.askApproval("tool", block, completeMessage)
							if (!didApprove) {
								telemetryService.captureToolUsage(this.taskId, block.name, this.api.getModel().id, false, false)
								await this.saveCheckpoint()
								break
							}
							telemetryService.captureToolUsage(this.taskId, block.name, this.api.getModel().id, false, true)
						}
						this.pushToolResult(results, block)
						await this.saveCheckpoint()
						break
					}
				} catch (error) {
					await this.handleError("searching files", error, block)
					await this.saveCheckpoint()
					break
				}
			}
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
								this.browserSession = new BrowserSession(this.context, this.browserSettings)
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
			case "execute_command": {
				let command: string | undefined = block.params.command
				const requiresApprovalRaw: string | undefined = block.params.requires_approval
				const requiresApprovalPerLLM = requiresApprovalRaw?.toLowerCase() === "true"

				try {
					if (block.partial) {
						if (this.shouldAutoApproveTool(block.name)) {
							// since depending on an upcoming parameter, requiresApproval this may become an ask - we can't partially stream a say prematurely. So in this particular case we have to wait for the requiresApproval parameter to be completed before presenting it.
							// await this.say(
							// 	"command",
							// 	removeClosingTag("command", command),
							// 	undefined,
							// 	block.partial,
							// ).catch(() => {})
						} else {
							// don't need to remove last partial since we couldn't have streamed a say
							await this.ask("command", this.removeClosingTag(block, "command", command), block.partial).catch(
								() => {},
							)
						}
						break
					} else {
						if (!command) {
							this.taskState.consecutiveMistakeCount++
							this.pushToolResult(await this.sayAndCreateMissingParamError("execute_command", "command"), block)
							await this.saveCheckpoint()
							break
						}
						if (!requiresApprovalRaw) {
							this.taskState.consecutiveMistakeCount++
							this.pushToolResult(
								await this.sayAndCreateMissingParamError("execute_command", "requires_approval"),
								block,
							)
							await this.saveCheckpoint()
							break
						}
						this.taskState.consecutiveMistakeCount = 0

						// gemini models tend to use unescaped html entities in commands
						if (this.api.getModel().id.includes("gemini")) {
							command = fixModelHtmlEscaping(command)
						}

						const ignoredFileAttemptedToAccess = this.clineIgnoreController.validateCommand(command)
						if (ignoredFileAttemptedToAccess) {
							await this.say("clineignore_error", ignoredFileAttemptedToAccess)
							this.pushToolResult(
								formatResponse.toolError(formatResponse.clineIgnoreError(ignoredFileAttemptedToAccess)),
								block,
							)
							await this.saveCheckpoint()
							break
						}

						let didAutoApprove = false

						// If the model says this command is safe and auto approval for safe commands is true, execute the command
						// If the model says the command is risky, but *BOTH* auto approve settings are true, execute the command
						const autoApproveResult = this.shouldAutoApproveTool(block.name)
						const [autoApproveSafe, autoApproveAll] = Array.isArray(autoApproveResult)
							? autoApproveResult
							: [autoApproveResult, false]

						if (
							(!requiresApprovalPerLLM && autoApproveSafe) ||
							(requiresApprovalPerLLM && autoApproveSafe && autoApproveAll)
						) {
							this.removeLastPartialMessageIfExistsWithType("ask", "command")
							await this.say("command", command, undefined, undefined, false)
							this.taskState.consecutiveAutoApprovedRequestsCount++
							didAutoApprove = true
						} else {
							showNotificationForApprovalIfAutoApprovalEnabled(
								`Cline wants to execute a command: ${command}`,
								this.autoApprovalSettings.enabled,
								this.autoApprovalSettings.enableNotifications,
							)
							// this.removeLastPartialMessageIfExistsWithType("say", "command")
							const didApprove = await this.askApproval(
								"command",
								block,
								command +
									`${this.shouldAutoApproveTool(block.name) && requiresApprovalPerLLM ? COMMAND_REQ_APP_STRING : ""}`, // ugly hack until we refactor combineCommandSequences
							)
							if (!didApprove) {
								await this.saveCheckpoint()
								break
							}
						}

						let timeoutId: NodeJS.Timeout | undefined
						if (didAutoApprove && this.autoApprovalSettings.enableNotifications) {
							// if the command was auto-approved, and it's long running we need to notify the user after some time has passed without proceeding
							timeoutId = setTimeout(() => {
								showSystemNotification({
									subtitle: "Command is still running",
									message: "An auto-approved command has been running for 30s, and may need your attention.",
								})
							}, 30_000)
						}

						const [userRejected, result] = await this.executeCommandTool(command)
						if (timeoutId) {
							clearTimeout(timeoutId)
						}
						if (userRejected) {
							this.taskState.didRejectTool = true
						}

						// Re-populate file paths in case the command modified the workspace (vscode listeners do not trigger unless the user manually creates/deletes files)
						this.workspaceTracker.populateFilePaths()

						this.pushToolResult(result, block)

						await this.saveCheckpoint()

						break
					}
				} catch (error) {
					await this.handleError("executing command", error, block)
					await this.saveCheckpoint()
					break
				}
			}
			case "use_mcp_tool": {
				const server_name: string | undefined = block.params.server_name
				const tool_name: string | undefined = block.params.tool_name
				const mcp_arguments: string | undefined = block.params.arguments
				try {
					if (block.partial) {
						const partialMessage = JSON.stringify({
							type: "use_mcp_tool",
							serverName: this.removeClosingTag(block, "server_name", server_name),
							toolName: this.removeClosingTag(block, "tool_name", tool_name),
							arguments: this.removeClosingTag(block, "arguments", mcp_arguments),
						} satisfies ClineAskUseMcpServer)

						if (this.shouldAutoApproveTool(block.name)) {
							this.removeLastPartialMessageIfExistsWithType("ask", "use_mcp_server")
							await this.say("use_mcp_server", partialMessage, undefined, undefined, block.partial)
						} else {
							this.removeLastPartialMessageIfExistsWithType("say", "use_mcp_server")
							await this.ask("use_mcp_server", partialMessage, block.partial).catch(() => {})
						}

						break
					} else {
						if (!server_name) {
							this.taskState.consecutiveMistakeCount++
							this.pushToolResult(await this.sayAndCreateMissingParamError("use_mcp_tool", "server_name"), block)
							await this.saveCheckpoint()
							break
						}
						if (!tool_name) {
							this.taskState.consecutiveMistakeCount++
							this.pushToolResult(await this.sayAndCreateMissingParamError("use_mcp_tool", "tool_name"), block)
							await this.saveCheckpoint()
							break
						}
						// arguments are optional, but if they are provided they must be valid JSON
						// if (!mcp_arguments) {
						// 	this.consecutiveMistakeCount++
						// 	pushToolResult(await this.sayAndCreateMissingParamError("use_mcp_tool", "arguments"))
						// 	break
						// }
						let parsedArguments: Record<string, unknown> | undefined
						if (mcp_arguments) {
							try {
								parsedArguments = JSON.parse(mcp_arguments)
							} catch (error) {
								this.taskState.consecutiveMistakeCount++
								await this.say(
									"error",
									`Cline tried to use ${tool_name} with an invalid JSON argument. Retrying...`,
								)
								this.pushToolResult(
									formatResponse.toolError(formatResponse.invalidMcpToolArgumentError(server_name, tool_name)),
									block,
								)
								await this.saveCheckpoint()
								break
							}
						}
						this.taskState.consecutiveMistakeCount = 0
						const completeMessage = JSON.stringify({
							type: "use_mcp_tool",
							serverName: server_name,
							toolName: tool_name,
							arguments: mcp_arguments,
						} satisfies ClineAskUseMcpServer)

						const isToolAutoApproved = this.mcpHub.connections
							?.find((conn) => conn.server.name === server_name)
							?.server.tools?.find((tool) => tool.name === tool_name)?.autoApprove

						if (this.shouldAutoApproveTool(block.name) && isToolAutoApproved) {
							this.removeLastPartialMessageIfExistsWithType("ask", "use_mcp_server")
							await this.say("use_mcp_server", completeMessage, undefined, undefined, false)
							this.taskState.consecutiveAutoApprovedRequestsCount++
						} else {
							showNotificationForApprovalIfAutoApprovalEnabled(
								`Cline wants to use ${tool_name} on ${server_name}`,
								this.autoApprovalSettings.enabled,
								this.autoApprovalSettings.enableNotifications,
							)
							this.removeLastPartialMessageIfExistsWithType("say", "use_mcp_server")
							const didApprove = await this.askApproval("use_mcp_server", block, completeMessage)
							if (!didApprove) {
								await this.saveCheckpoint()
								break
							}
						}

						// now execute the tool
						await this.say("mcp_server_request_started") // same as browser_action_result

						// Check for any pending notifications before the tool call
						const notificationsBefore = this.mcpHub.getPendingNotifications()
						for (const notification of notificationsBefore) {
							await this.say("mcp_notification", `[${notification.serverName}] ${notification.message}`)
						}

						const toolResult = await this.mcpHub.callTool(server_name, tool_name, parsedArguments)

						// Check for any pending notifications after the tool call
						const notificationsAfter = this.mcpHub.getPendingNotifications()
						for (const notification of notificationsAfter) {
							await this.say("mcp_notification", `[${notification.serverName}] ${notification.message}`)
						}

						// TODO: add progress indicator

						const toolResultImages =
							toolResult?.content
								.filter((item) => item.type === "image")
								.map((item) => `data:${item.mimeType};base64,${item.data}`) || []
						let toolResultText =
							(toolResult?.isError ? "Error:\n" : "") +
								toolResult?.content
									.map((item) => {
										if (item.type === "text") {
											return item.text
										}
										if (item.type === "resource") {
											const { blob, ...rest } = item.resource
											return JSON.stringify(rest, null, 2)
										}
										return ""
									})
									.filter(Boolean)
									.join("\n\n") || "(No response)"
						// webview extracts images from the text response to display in the UI
						const toolResultToDisplay = toolResultText + toolResultImages?.map((image) => `\n\n${image}`).join("")
						await this.say("mcp_server_response", toolResultToDisplay)

						// MCP's might return images to display to the user, but the model may not support them
						const supportsImages = this.api.getModel().info.supportsImages ?? false
						if (toolResultImages.length > 0 && !supportsImages) {
							toolResultText += `\n\n[${toolResultImages.length} images were provided in the response, and while they are displayed to the user, you do not have the ability to view them.]`
						}

						// only passes in images if model supports them
						this.pushToolResult(
							formatResponse.toolResult(toolResultText, supportsImages ? toolResultImages : undefined),
							block,
						)

						await this.saveCheckpoint()

						break
					}
				} catch (error) {
					await this.handleError("executing MCP tool", error, block)
					await this.saveCheckpoint()
					break
				}
			}
			case "access_mcp_resource": {
				const server_name: string | undefined = block.params.server_name
				const uri: string | undefined = block.params.uri
				try {
					if (block.partial) {
						const partialMessage = JSON.stringify({
							type: "access_mcp_resource",
							serverName: this.removeClosingTag(block, "server_name", server_name),
							uri: this.removeClosingTag(block, "uri", uri),
						} satisfies ClineAskUseMcpServer)

						if (this.shouldAutoApproveTool(block.name)) {
							this.removeLastPartialMessageIfExistsWithType("ask", "use_mcp_server")
							await this.say("use_mcp_server", partialMessage, undefined, undefined, block.partial)
						} else {
							this.removeLastPartialMessageIfExistsWithType("say", "use_mcp_server")
							await this.ask("use_mcp_server", partialMessage, block.partial).catch(() => {})
						}

						break
					} else {
						if (!server_name) {
							this.taskState.consecutiveMistakeCount++
							this.pushToolResult(
								await this.sayAndCreateMissingParamError("access_mcp_resource", "server_name"),
								block,
							)
							await this.saveCheckpoint()
							break
						}
						if (!uri) {
							this.taskState.consecutiveMistakeCount++
							this.pushToolResult(await this.sayAndCreateMissingParamError("access_mcp_resource", "uri"), block)
							await this.saveCheckpoint()
							break
						}
						this.taskState.consecutiveMistakeCount = 0
						const completeMessage = JSON.stringify({
							type: "access_mcp_resource",
							serverName: server_name,
							uri,
						} satisfies ClineAskUseMcpServer)

						if (this.shouldAutoApproveTool(block.name)) {
							this.removeLastPartialMessageIfExistsWithType("ask", "use_mcp_server")
							await this.say("use_mcp_server", completeMessage, undefined, undefined, false)
							this.taskState.consecutiveAutoApprovedRequestsCount++
						} else {
							showNotificationForApprovalIfAutoApprovalEnabled(
								`Cline wants to access ${uri} on ${server_name}`,
								this.autoApprovalSettings.enabled,
								this.autoApprovalSettings.enableNotifications,
							)
							this.removeLastPartialMessageIfExistsWithType("say", "use_mcp_server")
							const didApprove = await this.askApproval("use_mcp_server", block, completeMessage)
							if (!didApprove) {
								await this.saveCheckpoint()
								break
							}
						}

						// now execute the tool
						await this.say("mcp_server_request_started")
						const resourceResult = await this.mcpHub.readResource(server_name, uri)
						const resourceResultPretty =
							resourceResult?.contents
								.map((item) => {
									if (item.text) {
										return item.text
									}
									return ""
								})
								.filter(Boolean)
								.join("\n\n") || "(Empty response)"
						await this.say("mcp_server_response", resourceResultPretty)
						this.pushToolResult(formatResponse.toolResult(resourceResultPretty), block)
						await this.saveCheckpoint()
						break
					}
				} catch (error) {
					await this.handleError("accessing MCP resource", error, block)
					await this.saveCheckpoint()
					break
				}
			}
			case "ask_followup_question": {
				const question: string | undefined = block.params.question
				const optionsRaw: string | undefined = block.params.options
				const sharedMessage = {
					question: this.removeClosingTag(block, "question", question),
					options: parsePartialArrayString(this.removeClosingTag(block, "options", optionsRaw)),
				} satisfies ClineAskQuestion
				try {
					if (block.partial) {
						await this.ask("followup", JSON.stringify(sharedMessage), block.partial).catch(() => {})
						break
					} else {
						if (!question) {
							this.taskState.consecutiveMistakeCount++
							this.pushToolResult(
								await this.sayAndCreateMissingParamError("ask_followup_question", "question"),
								block,
							)
							await this.saveCheckpoint()
							break
						}
						this.taskState.consecutiveMistakeCount = 0

						if (this.autoApprovalSettings.enabled && this.autoApprovalSettings.enableNotifications) {
							showSystemNotification({
								subtitle: "Cline has a question...",
								message: question.replace(/\n/g, " "),
							})
						}

						// Store the number of options for telemetry
						const options = parsePartialArrayString(optionsRaw || "[]")

						const {
							text,
							images,
							files: followupFiles,
						} = await this.ask("followup", JSON.stringify(sharedMessage), false)

						// Check if options contains the text response
						if (optionsRaw && text && parsePartialArrayString(optionsRaw).includes(text)) {
							// Valid option selected, don't show user message in UI
							// Update last followup message with selected option
							const lastFollowupMessage = findLast(
								this.messageStateHandler.getClineMessages(),
								(m) => m.ask === "followup",
							)
							if (lastFollowupMessage) {
								lastFollowupMessage.text = JSON.stringify({
									...sharedMessage,
									selected: text,
								} satisfies ClineAskQuestion)
								await this.messageStateHandler.saveClineMessagesAndUpdateHistory()
							}
						} else {
							// Option not selected, send user feedback
							telemetryService.captureOptionsIgnored(this.taskId, options.length, "act")
							await this.say("user_feedback", text ?? "", images, followupFiles)
						}

						let fileContentString = ""
						if (followupFiles && followupFiles.length > 0) {
							fileContentString = await processFilesIntoText(followupFiles)
						}

						this.pushToolResult(
							formatResponse.toolResult(`<answer>\n${text}\n</answer>`, images, fileContentString),
							block,
						)
						await this.saveCheckpoint()
						break
					}
				} catch (error) {
					await this.handleError("asking question", error, block)
					await this.saveCheckpoint()
					break
				}
			}
			case "new_task": {
				const context: string | undefined = block.params.context
				try {
					if (block.partial) {
						await this.ask("new_task", this.removeClosingTag(block, "context", context), block.partial).catch(
							() => {},
						)
						break
					} else {
						if (!context) {
							this.taskState.consecutiveMistakeCount++
							this.pushToolResult(await this.sayAndCreateMissingParamError("new_task", "context"), block)
							await this.saveCheckpoint()
							break
						}
						this.taskState.consecutiveMistakeCount = 0

						if (this.autoApprovalSettings.enabled && this.autoApprovalSettings.enableNotifications) {
							showSystemNotification({
								subtitle: "Cline wants to start a new task...",
								message: `Cline is suggesting to start a new task with: ${context}`,
							})
						}

						const { text, images, files: newTaskFiles } = await this.ask("new_task", context, false)

						// If the user provided a response, treat it as feedback
						if (text || (images && images.length > 0) || (newTaskFiles && newTaskFiles.length > 0)) {
							let fileContentString = ""
							if (newTaskFiles && newTaskFiles.length > 0) {
								fileContentString = await processFilesIntoText(newTaskFiles)
							}

							await this.say("user_feedback", text ?? "", images, newTaskFiles)
							this.pushToolResult(
								formatResponse.toolResult(
									`The user provided feedback instead of creating a new task:\n<feedback>\n${text}\n</feedback>`,
									images,
									fileContentString,
								),
								block,
							)
						} else {
							// If no response, the user clicked the "Create New Task" button
							this.pushToolResult(
								formatResponse.toolResult(`The user has created a new task with the provided context.`),
								block,
							)
						}
						await this.saveCheckpoint()
						break
					}
				} catch (error) {
					await this.handleError("creating new task", error, block)
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
						const providerAndModel = `${await getGlobalState(this.context, "apiProvider")} / ${this.api.getModel().id}`

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
			case "web_fetch": {
				const url: string | undefined = block.params.url
				// TODO: Implement caching for web_fetch
				const sharedMessageProps: ClineSayTool = {
					tool: "webFetch",
					path: this.removeClosingTag(block, "url", url),
					content: `Fetching URL: ${this.removeClosingTag(block, "url", url)}`,
				}

				try {
					if (block.partial) {
						const partialMessage = JSON.stringify({
							...sharedMessageProps,
							operationIsLocatedInWorkspace: false, // web_fetch is always external
						} satisfies ClineSayTool)

						// WebFetch is a read-only operation, generally safe.
						// Let's assume it follows similar auto-approval logic to read_file for now.
						// We might need a dedicated auto-approval setting for it later.
						if (this.shouldAutoApproveTool("web_fetch" as ToolUseName)) {
							this.removeLastPartialMessageIfExistsWithType("ask", "tool")
							await this.say("tool", partialMessage, undefined, undefined, block.partial)
						} else {
							this.removeLastPartialMessageIfExistsWithType("say", "tool")
							await this.ask("tool", partialMessage, block.partial).catch(() => {})
						}
						break
					} else {
						if (!url) {
							this.taskState.consecutiveMistakeCount++
							this.pushToolResult(await this.sayAndCreateMissingParamError("web_fetch", "url"), block)
							await this.saveCheckpoint()
							break
						}

						this.taskState.consecutiveMistakeCount = 0
						const completeMessage = JSON.stringify({
							...sharedMessageProps,
							operationIsLocatedInWorkspace: false,
						} satisfies ClineSayTool)

						if (this.shouldAutoApproveTool("web_fetch" as ToolUseName)) {
							this.removeLastPartialMessageIfExistsWithType("ask", "tool")
							await this.say("tool", completeMessage, undefined, undefined, false)
							this.taskState.consecutiveAutoApprovedRequestsCount++
							telemetryService.captureToolUsage(
								this.taskId,
								"web_fetch" as ToolUseName,
								this.api.getModel().id,
								true,
								true,
							)
						} else {
							showNotificationForApprovalIfAutoApprovalEnabled(
								`Cline wants to fetch content from ${url}`,
								this.autoApprovalSettings.enabled,
								this.autoApprovalSettings.enableNotifications,
							)
							this.removeLastPartialMessageIfExistsWithType("say", "tool")
							const didApprove = await this.askApproval("tool", block, completeMessage)
							if (!didApprove) {
								telemetryService.captureToolUsage(
									this.taskId,
									"web_fetch" as ToolUseName,
									this.api.getModel().id,
									false,
									false,
								)
								await this.saveCheckpoint()
								break
							}
							telemetryService.captureToolUsage(
								this.taskId,
								"web_fetch" as ToolUseName,
								this.api.getModel().id,
								false,
								true,
							)
						}

						// Fetch Markdown contentcc
						await this.urlContentFetcher.launchBrowser()
						const markdownContent = await this.urlContentFetcher.urlToMarkdown(url)
						await this.urlContentFetcher.closeBrowser()

						// TODO: Implement secondary AI call to process markdownContent with prompt
						// For now, returning markdown directly.
						// This will be a significant sub-task.
						// Placeholder for processed summary:
						const processedSummary = `Fetched Markdown for ${url}:\n\n${markdownContent}`

						this.pushToolResult(formatResponse.toolResult(processedSummary), block)
						await this.saveCheckpoint()
						break
					}
				} catch (error) {
					await this.urlContentFetcher.closeBrowser() // Ensure browser is closed on error
					await this.handleError("fetching web content", error, block)
					await this.saveCheckpoint()
					break
				}
			}
			case "plan_mode_respond": {
				const response: string | undefined = block.params.response
				const optionsRaw: string | undefined = block.params.options
				const sharedMessage = {
					response: this.removeClosingTag(block, "response", response),
					options: parsePartialArrayString(this.removeClosingTag(block, "options", optionsRaw)),
				} satisfies ClinePlanModeResponse
				try {
					if (block.partial) {
						await this.ask("plan_mode_respond", JSON.stringify(sharedMessage), block.partial).catch(() => {})
						break
					} else {
						if (!response) {
							this.taskState.consecutiveMistakeCount++
							this.pushToolResult(await this.sayAndCreateMissingParamError("plan_mode_respond", "response"), block)
							//
							break
						}
						this.taskState.consecutiveMistakeCount = 0

						// if (this.autoApprovalSettings.enabled && this.autoApprovalSettings.enableNotifications) {
						// 	showSystemNotification({
						// 		subtitle: "Cline has a response...",
						// 		message: response.replace(/\n/g, " "),
						// 	})
						// }

						// Store the number of options for telemetry
						const options = parsePartialArrayString(optionsRaw || "[]")

						this.taskState.isAwaitingPlanResponse = true
						let {
							text,
							images,
							files: planResponseFiles,
						} = await this.ask("plan_mode_respond", JSON.stringify(sharedMessage), false)
						this.taskState.isAwaitingPlanResponse = false

						// webview invoke sendMessage will send this marker in order to put webview into the proper state (responding to an ask) and as a flag to extension that the user switched to ACT mode.
						if (text === "PLAN_MODE_TOGGLE_RESPONSE") {
							text = ""
						}

						// Check if options contains the text response
						if (optionsRaw && text && parsePartialArrayString(optionsRaw).includes(text)) {
							// Valid option selected, don't show user message in UI
							// Update last followup message with selected option
							const lastPlanMessage = findLast(
								this.messageStateHandler.getClineMessages(),
								(m) => m.ask === "plan_mode_respond",
							)
							if (lastPlanMessage) {
								lastPlanMessage.text = JSON.stringify({
									...sharedMessage,
									selected: text,
								} satisfies ClinePlanModeResponse)
								await this.messageStateHandler.saveClineMessagesAndUpdateHistory()
							}
						} else {
							// Option not selected, send user feedback
							if (text || (images && images.length > 0) || (planResponseFiles && planResponseFiles.length > 0)) {
								telemetryService.captureOptionsIgnored(this.taskId, options.length, "plan")
								await this.say("user_feedback", text ?? "", images, planResponseFiles)
								await this.saveCheckpoint()
							}
						}

						let fileContentString = ""
						if (planResponseFiles && planResponseFiles.length > 0) {
							fileContentString = await processFilesIntoText(planResponseFiles)
						}

						if (this.taskState.didRespondToPlanAskBySwitchingMode) {
							this.pushToolResult(
								formatResponse.toolResult(
									`[The user has switched to ACT MODE, so you may now proceed with the task.]` +
										(text
											? `\n\nThe user also provided the following message when switching to ACT MODE:\n<user_message>\n${text}\n</user_message>`
											: ""),
									images,
									fileContentString,
								),
								block,
							)
						} else {
							// if we didn't switch to ACT MODE, then we can just send the user_feedback message
							this.pushToolResult(
								formatResponse.toolResult(`<user_message>\n${text}\n</user_message>`, images, fileContentString),
								block,
							)
						}

						//
						break
					}
				} catch (error) {
					await this.handleError("responding to inquiry", error, block)
					//
					break
				}
			}
			case "load_mcp_documentation": {
				try {
					if (block.partial) {
						// shouldn't happen
						break
					} else {
						await this.say("load_mcp_documentation", "", undefined, undefined, false)
						this.pushToolResult(await loadMcpDocumentation(this.mcpHub), block)
						break
					}
				} catch (error) {
					await this.handleError("loading MCP documentation", error, block)
					break
				}
			}
			case "attempt_completion": {
				const result: string | undefined = block.params.result
				const command: string | undefined = block.params.command

				const addNewChangesFlagToLastCompletionResultMessage = async () => {
					// Add newchanges flag if there are new changes to the workspace

					const hasNewChanges = await this.doesLatestTaskCompletionHaveNewChanges()

					const clineMessages = this.messageStateHandler.getClineMessages()

					const lastCompletionResultMessageIndex = findLastIndex(clineMessages, (m) => m.say === "completion_result")
					const lastCompletionResultMessage =
						lastCompletionResultMessageIndex !== -1 ? clineMessages[lastCompletionResultMessageIndex] : undefined
					if (
						lastCompletionResultMessage &&
						lastCompletionResultMessageIndex !== -1 &&
						hasNewChanges &&
						!lastCompletionResultMessage.text?.endsWith(COMPLETION_RESULT_CHANGES_FLAG)
					) {
						await this.messageStateHandler.updateClineMessage(lastCompletionResultMessageIndex, {
							text: lastCompletionResultMessage.text + COMPLETION_RESULT_CHANGES_FLAG,
						})
					}
				}

				try {
					const lastMessage = this.messageStateHandler.getClineMessages().at(-1)
					if (block.partial) {
						if (command) {
							// the attempt_completion text is done, now we're getting command
							// remove the previous partial attempt_completion ask, replace with say, post state to webview, then stream command

							// const secondLastMessage = this.clineMessages.at(-2)
							// NOTE: we do not want to auto approve a command run as part of the attempt_completion tool
							if (lastMessage && lastMessage.ask === "command") {
								// update command
								await this.ask("command", this.removeClosingTag(block, "command", command), block.partial).catch(
									() => {},
								)
							} else {
								// last message is completion_result
								// we have command string, which means we have the result as well, so finish it (doesn't have to exist yet)
								await this.say(
									"completion_result",
									this.removeClosingTag(block, "result", result),
									undefined,
									undefined,
									false,
								)
								await this.saveCheckpoint(true)
								await addNewChangesFlagToLastCompletionResultMessage()
								await this.ask("command", this.removeClosingTag(block, "command", command), block.partial).catch(
									() => {},
								)
							}
						} else {
							// no command, still outputting partial result
							await this.say(
								"completion_result",
								this.removeClosingTag(block, "result", result),
								undefined,
								undefined,
								block.partial,
							)
						}
						break
					} else {
						if (!result) {
							this.taskState.consecutiveMistakeCount++
							this.pushToolResult(await this.sayAndCreateMissingParamError("attempt_completion", "result"), block)
							break
						}
						this.taskState.consecutiveMistakeCount = 0

						if (this.autoApprovalSettings.enabled && this.autoApprovalSettings.enableNotifications) {
							showSystemNotification({
								subtitle: "Task Completed",
								message: result.replace(/\n/g, " "),
							})
						}

						let commandResult: ToolResponse | undefined
						if (command) {
							if (lastMessage && lastMessage.ask !== "command") {
								// haven't sent a command message yet so first send completion_result then command
								await this.say("completion_result", result, undefined, undefined, false)
								await this.saveCheckpoint(true)
								await addNewChangesFlagToLastCompletionResultMessage()
								telemetryService.captureTaskCompleted(this.taskId)
							} else {
								// we already sent a command message, meaning the complete completion message has also been sent
								await this.saveCheckpoint(true)
							}

							// complete command message
							const didApprove = await this.askApproval("command", block, command)
							if (!didApprove) {
								await this.saveCheckpoint()
								break
							}
							const [userRejected, execCommandResult] = await this.executeCommandTool(command!)
							if (userRejected) {
								this.taskState.didRejectTool = true
								this.pushToolResult(execCommandResult, block)
								await this.saveCheckpoint()
								break
							}
							// user didn't reject, but the command may have output
							commandResult = execCommandResult
						} else {
							await this.say("completion_result", result, undefined, undefined, false)
							await this.saveCheckpoint(true)
							await addNewChangesFlagToLastCompletionResultMessage()
							telemetryService.captureTaskCompleted(this.taskId)
						}

						// we already sent completion_result says, an empty string asks relinquishes control over button and field
						const { response, text, images, files: completionFiles } = await this.ask("completion_result", "", false)
						if (response === "yesButtonClicked") {
							this.pushToolResult("", block) // signals to recursive loop to stop (for now this never happens since yesButtonClicked will trigger a new task)
							break
						}
						await this.say("user_feedback", text ?? "", images, completionFiles)
						await this.saveCheckpoint()

						const toolResults: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[] = []
						if (commandResult) {
							if (typeof commandResult === "string") {
								toolResults.push({
									type: "text",
									text: commandResult,
								})
							} else if (Array.isArray(commandResult)) {
								toolResults.push(...commandResult)
							}
						}
						toolResults.push({
							type: "text",
							text: `The user has provided feedback on the results. Consider their input to continue the task, and then attempt completion again.\n<feedback>\n${text}\n</feedback>`,
						})
						toolResults.push(...formatResponse.imageBlocks(images))
						this.taskState.userMessageContent.push({
							type: "text",
							text: `${this.toolDescription(block)} Result:`,
						})
						this.taskState.userMessageContent.push(...toolResults)

						let fileContentString = ""
						if (completionFiles && completionFiles.length > 0) {
							fileContentString = await processFilesIntoText(completionFiles)
						}

						if (fileContentString) {
							this.taskState.userMessageContent.push({
								type: "text",
								text: fileContentString,
							})
						}
						break
					}
				} catch (error) {
					await this.handleError("attempting completion", error, block)
					await this.saveCheckpoint()
					break
				}
			}
		}
	}
}
