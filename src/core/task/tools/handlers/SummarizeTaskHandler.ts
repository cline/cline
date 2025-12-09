import type { ToolUse } from "@core/assistant-message"
import { executePreCompactHookWithCleanup, HookCancellationError } from "@core/hooks/precompact-executor"
import { continuationPrompt } from "@core/prompts/contextManagement"
import { formatResponse } from "@core/prompts/responses"
import { ensureTaskDirectoryExists } from "@core/storage/disk"
import { StateManager } from "@core/storage/StateManager"
import { resolveWorkspacePath } from "@core/workspace"
import { extractFileContent } from "@integrations/misc/extract-file-content"
import { ClineSayTool } from "@shared/ExtensionMessage"
import { telemetryService } from "@/services/telemetry"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IPartialBlockHandler, IToolHandler } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

export class SummarizeTaskHandler implements IToolHandler, IPartialBlockHandler {
	readonly name = ClineDefaultTool.SUMMARIZE_TASK

	constructor(private validator: ToolValidator) {}

	getDescription(block: ToolUse): string {
		return `[${block.name}]`
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		try {
			const context: string | undefined = block.params.context

			// Validate required parameters
			if (!context) {
				config.taskState.consecutiveMistakeCount++
				return await config.callbacks.sayAndCreateMissingParamError(this.name, "context")
			}

			config.taskState.consecutiveMistakeCount = 0

			// Variable to store context modification from PreCompact hook
			let hookContextModification: string | undefined

			// Run PreCompact hook right before showing the condensing message
			const hooksEnabled = StateManager.get().getGlobalSettingsKey("hooksEnabled")
			if (hooksEnabled) {
				try {
					// Determine compaction strategy
					const useAutoCondense = StateManager.get().getGlobalSettingsKey("useAutoCondense")
					const strategy = useAutoCondense ? "auto-condense" : "standard-truncation-firstpair"

					const apiHistory = config.messageState.getApiConversationHistory()

					const result = await executePreCompactHookWithCleanup({
						taskId: config.taskId,
						ulid: config.ulid,
						apiConversationHistory: apiHistory,
						conversationHistoryDeletedRange: config.taskState.conversationHistoryDeletedRange,
						contextManager: config.services.contextManager,
						clineMessages: config.messageState.getClineMessages(),
						messageStateHandler: config.messageState,
						compactionStrategy: strategy,
						say: config.callbacks.say,
						setActiveHookExecution: async (hookExecution) => {
							if (hookExecution) {
								await config.callbacks.setActiveHookExecution(hookExecution)
							}
						},
						clearActiveHookExecution: config.callbacks.clearActiveHookExecution,
						postStateToWebview: config.callbacks.postStateToWebview,
						taskState: config.taskState,
						cancelTask: config.callbacks.cancelTask,
						hooksEnabled,
					})

					// Hook completed successfully - capture context modification if provided
					if (result.contextModification) {
						hookContextModification = result.contextModification
						console.log(`[PreCompact] Hook provided context modification for task ${config.taskId}`)
					}
				} catch (error) {
					// Check if this is a hook cancellation error
					if (error instanceof HookCancellationError) {
						// Hook was cancelled - show message and return early without executing summarization
						// (State already saved and task already cancelled by executePreCompactHookWithCleanup)
						await config.callbacks.say(
							"error",
							"Context compaction was cancelled by PreCompact hook. Task has been aborted.",
						)
						return "Context compaction was cancelled. Task has been aborted."
					}

					// Graceful degradation: Show warning but continue with compaction
					// Hook UI already shows "Failed" status with error details
					await config.callbacks.say(
						"error",
						`PreCompact hook failed, continuing with compaction: ${error instanceof Error ? error.message : String(error)}`,
					)
					console.error("[PreCompact] Hook execution failed, continuing with compaction:", error)
				}
			}

			// Show completed summary in tool UI
			const completeMessage = JSON.stringify({
				tool: "summarizeTask",
				content: context,
			} satisfies ClineSayTool)

			await config.callbacks.say("tool", completeMessage, undefined, undefined, false)

			// Parse "Required Files" section from context and read files
			// We impose a max number of files which are allowed to be read in as well as on
			// the number of files which are allowed to be processed in total
			// We also impose a limit on the max number of chars these files reads can consume
			const loadedFilePaths: string[] = []
			let fileContents = ""
			const filePathRegex = /9\.\s*(?:Optional\s+)?Required Files:\s*((?:\n\s*-\s*.+)+)/m
			const match = context.match(filePathRegex)

			if (match) {
				const fileListText = match[1]
				const filePaths: string[] = []
				const lines = fileListText.split("\n")

				for (const line of lines) {
					const pathMatch = line.match(/^\s*-\s*(.+)$/)
					if (pathMatch) {
						filePaths.push(pathMatch[1].trim())
					}
				}

				let filesProcessed = 0
				let filesLoaded = 0
				let totalChars = 0
				const MAX_FILES_LOADED = 8
				const MAX_FILES_PROCESSED = 10
				const MAX_CHARS = 100_000

				// Prevents duplicate file reads, if occurs
				const loadedFiles = new Set<string>()

				// Read each file only if auto-approved
				// We consider the list of files still good context for task continuation even if user doesn't have auto approval on
				for (const relPath of filePaths) {
					// Validate that we have not loaded this file previously
					const normalizedPath = relPath.toLowerCase()
					if (loadedFiles.has(normalizedPath)) {
						continue
					}
					loadedFiles.add(normalizedPath)

					filesProcessed++
					if (filesProcessed > MAX_FILES_PROCESSED) {
						break
					}

					// Check .clineignore first and skip ignored files
					const accessValidation = this.validator.checkClineIgnorePath(relPath)
					if (!accessValidation.ok) {
						continue
					}

					// Only process if auto-approved (respects workspace/outside-workspace settings)
					if (await config.callbacks.shouldAutoApproveToolWithPath(ClineDefaultTool.FILE_READ, relPath)) {
						try {
							// Resolve path (handles multi-root workspaces)
							const pathResult = resolveWorkspacePath(config, relPath, "SummarizeTaskHandler")
							const { absolutePath, displayPath } =
								typeof pathResult === "string" ? { absolutePath: pathResult, displayPath: relPath } : pathResult

							// Read file content, we dont allow images to be read here
							// This throws if an image or if we can't read the file, implicitly skipping
							const fileContent = await extractFileContent(absolutePath, false)

							// Check if adding this file would exceed character limit
							if (totalChars + fileContent.text.length > MAX_CHARS) {
								break // exceed our character alotment
							}

							// Track the file read
							await config.services.fileContextTracker.trackFileContext(relPath, "file_mentioned")

							// Append file content in the same format as file mentions
							fileContents += `\n\n<file_content path="${displayPath}">\n${fileContent.text}\n</file_content>`
							loadedFilePaths.push(displayPath)

							totalChars += fileContent.text.length
							filesLoaded++

							if (filesLoaded >= MAX_FILES_LOADED) {
								break
							}
						} catch (error) {
							// File read failed - log but continue with other files
							console.error(`Failed to read ${relPath} during summarization:`, error)
						}
					}
					// If not auto-approved, skip silently
				}
			}

			// Use the continuationPrompt to format the tool result, appending file contents
			if (fileContents) {
				const fileMentionString = loadedFilePaths.map((path) => `'${path}'`).join(", ") + " (see below for file content)"
				fileContents =
					`\n\nThe following files were automatically read based on the files listed in the Required Files section: ${fileMentionString}. These are the latest versions of these files - you should reference them directly and not re-read them:` +
					fileContents
			}

			// Build the tool result with all components
			let toolResultContent = continuationPrompt(context) + fileContents

			// Append hook's context modification if provided
			if (hookContextModification) {
				toolResultContent += `\n\n[Context Modification from PreCompact Hook]\n${hookContextModification}`
			}

			const toolResult = formatResponse.toolResult(toolResultContent)

			// Handle context management
			const apiConversationHistory = config.messageState.getApiConversationHistory()
			const keepStrategy = "none"

			// clear the context history at this point in time. note that this will not include the assistant message
			// for summarizing, which we will need to delete later
			config.taskState.conversationHistoryDeletedRange = config.services.contextManager.getNextTruncationRange(
				apiConversationHistory,
				config.taskState.conversationHistoryDeletedRange,
				keepStrategy,
			)
			await config.messageState.saveClineMessagesAndUpdateHistory()
			await config.services.contextManager.triggerApplyStandardContextTruncationNoticeChange(
				Date.now(),
				await ensureTaskDirectoryExists(config.taskId),
				apiConversationHistory,
			)

			// Set summarizing state
			config.taskState.currentlySummarizing = true

			// Capture telemetry after main business logic is complete
			const telemetryData = config.services.contextManager.getContextTelemetryData(
				config.messageState.getClineMessages(),
				config.api,
				config.taskState.lastAutoCompactTriggerIndex,
			)

			if (telemetryData) {
				// Extract provider information for telemetry
				const apiConfig = config.services.stateManager.getApiConfiguration()
				const currentMode = config.services.stateManager.getGlobalSettingsKey("mode")
				const provider = (currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string

				telemetryService.captureSummarizeTask(
					config.ulid,
					config.api.getModel().id,
					provider,
					telemetryData.tokensUsed,
					telemetryData.maxContextWindow,
				)
			}

			return toolResult
		} catch (error) {
			return `Error summarizing context window: ${(error as Error).message}`
		}
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const context = block.params.context || ""

		// Show streaming summary generation in tool UI
		const partialMessage = JSON.stringify({
			tool: "summarizeTask",
			content: uiHelpers.removeClosingTag(block, "context", context),
		} satisfies ClineSayTool)

		await uiHelpers.say("tool", partialMessage, undefined, undefined, block.partial)
	}
}
