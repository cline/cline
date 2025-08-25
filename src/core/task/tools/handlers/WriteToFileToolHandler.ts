import { setTimeout as setTimeoutPromise } from "node:timers/promises"
import type { ToolUse } from "@core/assistant-message"
import { constructNewFileContent } from "@core/assistant-message/diff"
import { formatResponse } from "@core/prompts/responses"
import { processFilesIntoText } from "@integrations/misc/extract-text"
import { telemetryService } from "@services/posthog/PostHogClientProvider"
import { ClineSayTool } from "@shared/ExtensionMessage"
import { fileExistsAtPath } from "@utils/fs"
import { getReadablePath, isLocatedInWorkspace } from "@utils/path"
import { fixModelHtmlEscaping, removeInvalidChars } from "@utils/string"
import * as path from "path"
import type { ToolResponse } from "../../index"
import { showNotificationForApprovalIfAutoApprovalEnabled } from "../../utils"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { ToolDisplayUtils } from "../utils/ToolDisplayUtils"
import { ToolResultUtils } from "../utils/ToolResultUtils"

export class WriteToFileToolHandler implements IFullyManagedTool {
	readonly name = "write_to_file" // This handler supports write_to_file, replace_in_file, and new_rule

	constructor(private validator: ToolValidator) {}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const relPath = block.params.path
		const content = block.params.content // for write_to_file
		let diff = block.params.diff // for replace_in_file

		// Early return if we don't have enough data yet
		if (!relPath || (!content && !diff)) {
			// Wait until we have the path and either content or diff
			return
		}

		// Get config access for services
		const config = uiHelpers.getConfig()

		// Check clineignore access first
		const accessValidation = this.validator.checkClineIgnorePath(relPath)
		if (!accessValidation.ok) {
			// Show error and return early (full original behavior)
			await uiHelpers.say("clineignore_error", relPath)

			// Push tool result and save checkpoint using existing utilities
			const errorResponse = formatResponse.toolError(formatResponse.clineIgnoreError(relPath))
			ToolResultUtils.pushToolResult(
				errorResponse,
				block,
				config.taskState.userMessageContent,
				ToolDisplayUtils.getToolDescription,
				config.api,
				() => {
					config.taskState.didAlreadyUseTool = true
				},
			)
			await config.callbacks.saveCheckpoint()
			return
		}

		// Check if file exists to determine the correct UI message
		let fileExists: boolean
		if (config.services.diffViewProvider.editType !== undefined) {
			fileExists = config.services.diffViewProvider.editType === "modify"
		} else {
			const absolutePath = path.resolve(config.cwd, relPath)
			fileExists = await fileExistsAtPath(absolutePath)
			config.services.diffViewProvider.editType = fileExists ? "modify" : "create"
		}

		// Create and show partial UI message
		const sharedMessageProps: ClineSayTool = {
			tool: fileExists ? "editedExistingFile" : "newFileCreated",
			path: getReadablePath(config.cwd, uiHelpers.removeClosingTag(block, "path", relPath)),
			content: uiHelpers.removeClosingTag(block, block.name === "replace_in_file" ? "diff" : "content", content || diff),
			operationIsLocatedInWorkspace: await isLocatedInWorkspace(relPath),
		}

		const partialMessage = JSON.stringify(sharedMessageProps)

		// Handle auto-approval vs manual approval for partial
		if (await uiHelpers.shouldAutoApproveToolWithPath(block.name, relPath)) {
			await uiHelpers.removeLastPartialMessageIfExistsWithType("ask", "tool")
			await uiHelpers.say("tool", partialMessage, undefined, undefined, block.partial)
		} else {
			await uiHelpers.removeLastPartialMessageIfExistsWithType("say", "tool")
			await uiHelpers.ask("tool", partialMessage, block.partial).catch(() => {})
		}

		// CRITICAL: Add the missing real-time diff view streaming logic from original code
		try {
			// Construct newContent from diff or content
			let newContent: string = ""

			if (diff) {
				// Handle replace_in_file with diff construction
				if (!config.api.getModel().id.includes("claude")) {
					// deepseek models tend to use unescaped html entities in diffs
					diff = fixModelHtmlEscaping(diff)
					diff = removeInvalidChars(diff)
				}

				// Open the editor if not done already - CRITICAL for real-time streaming
				if (!config.services.diffViewProvider.isEditing) {
					await config.services.diffViewProvider.open(relPath)
				}

				try {
					newContent = await constructNewFileContent(
						diff,
						config.services.diffViewProvider.originalContent || "",
						!block.partial, // Pass the partial flag correctly
					)
				} catch (error) {
					// Full original behavior - comprehensive error handling even for partial blocks
					await config.callbacks.say("diff_error", relPath)

					// Extract error type from error message if possible
					const errorType =
						error instanceof Error && error.message.includes("does not match anything")
							? "search_not_found"
							: "other_diff_error"

					// Add telemetry for diff edit failure
					telemetryService.captureDiffEditFailure(config.ulid, config.api.getModel().id, errorType)

					// Push tool result with detailed error using existing utilities
					const errorResponse = formatResponse.toolError(
						`${(error as Error)?.message}\n\n` +
							formatResponse.diffError(relPath, config.services.diffViewProvider.originalContent),
					)
					ToolResultUtils.pushToolResult(
						errorResponse,
						block,
						config.taskState.userMessageContent,
						ToolDisplayUtils.getToolDescription,
						config.api,
						() => {
							config.taskState.didAlreadyUseTool = true
						},
					)

					// Revert changes and reset diff view
					await config.services.diffViewProvider.revertChanges()
					await config.services.diffViewProvider.reset()

					// Save checkpoint after error
					await config.callbacks.saveCheckpoint()
					return
				}
			} else if (content) {
				// Handle write_to_file with direct content
				newContent = content

				// Pre-processing newContent for cases where weaker models might add artifacts
				if (newContent.startsWith("```")) {
					newContent = newContent.split("\n").slice(1).join("\n").trim()
				}
				if (newContent.endsWith("```")) {
					newContent = newContent.split("\n").slice(0, -1).join("\n").trim()
				}

				if (!config.api.getModel().id.includes("claude")) {
					newContent = fixModelHtmlEscaping(newContent)
					newContent = removeInvalidChars(newContent)
				}
			}

			// CRITICAL: Open editor and stream content in real-time (from original code)
			if (!config.services.diffViewProvider.isEditing) {
				// Open the editor and prepare to stream content in
				await config.services.diffViewProvider.open(relPath)
			}
			// Editor is open, stream content in real-time (false = don't finalize yet)
			await config.services.diffViewProvider.update(newContent, false)
		} catch (error) {
			// For partial blocks, we'll silently handle errors and wait for more content
			// The complete block handler will handle actual errors
			if (!block.partial) {
				console.error("Error in partial write tool block:", error)
			}
		}
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		// For partial blocks, return empty string to let coordinator handle UI
		if (block.partial) {
			return ""
		}

		const relPath: string | undefined = block.params.path
		const content: string | undefined = block.params.content // for write_to_file and new_rule
		let diff: string | undefined = block.params.diff // for replace_in_file

		// Validate required parameters based on tool type
		if (!relPath) {
			config.taskState.consecutiveMistakeCount++
			return "Missing required parameter: path"
		}

		if (block.name === "replace_in_file" && !diff) {
			config.taskState.consecutiveMistakeCount++
			return "Missing required parameter: diff"
		}

		if ((block.name === "write_to_file" || block.name === "new_rule") && !content) {
			config.taskState.consecutiveMistakeCount++
			return "Missing required parameter: content"
		}

		// Check clineignore access
		const accessValidation = this.validator.checkClineIgnorePath(relPath)
		if (!accessValidation.ok) {
			await config.callbacks.say("clineignore_error", relPath)
			return formatResponse.toolError(formatResponse.clineIgnoreError(relPath))
		}

		config.taskState.consecutiveMistakeCount = 0

		// Check if file exists
		const absolutePath = path.resolve(config.cwd, relPath)
		let fileExists: boolean
		if (config.services.diffViewProvider.editType !== undefined) {
			fileExists = config.services.diffViewProvider.editType === "modify"
		} else {
			fileExists = await fileExistsAtPath(absolutePath)
			config.services.diffViewProvider.editType = fileExists ? "modify" : "create"
		}

		// Handle approval flow
		const sharedMessageProps: ClineSayTool = {
			tool: fileExists ? "editedExistingFile" : "newFileCreated",
			path: getReadablePath(config.cwd, relPath),
			content: diff || content,
			operationIsLocatedInWorkspace: await isLocatedInWorkspace(relPath),
		}

		const completeMessage = JSON.stringify(sharedMessageProps)

		if (await config.callbacks.shouldAutoApproveToolWithPath(block.name, relPath)) {
			// Auto-approval flow
			await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
			await config.callbacks.say("tool", completeMessage, undefined, undefined, false)
			config.taskState.consecutiveAutoApprovedRequestsCount++

			// Capture telemetry
			telemetryService.captureToolUsage(config.ulid, block.name, config.api.getModel().id, true, true)

			// Add diagnostic delay
			await setTimeoutPromise(3_500)
		} else {
			// Manual approval flow with detailed feedback handling
			const notificationMessage = `Cline wants to ${fileExists ? "edit" : "create"} ${path.basename(relPath)}`

			// Show notification
			showNotificationForApprovalIfAutoApprovalEnabled(
				notificationMessage,
				config.autoApprovalSettings.enabled,
				config.autoApprovalSettings.enableNotifications,
			)

			await config.callbacks.removeLastPartialMessageIfExistsWithType("say", "tool")

			// Ask for approval with full feedback handling
			const { response, text, images, files } = await config.callbacks.ask("tool", completeMessage, false)

			if (response !== "yesButtonClicked") {
				// Handle rejection with detailed messages
				const fileDeniedNote = fileExists
					? "The file was not updated, and maintains its original contents."
					: "The file was not created."

				// Process user feedback if provided (with file content processing)
				if (text || (images && images.length > 0) || (files && files.length > 0)) {
					let fileContentString = ""
					if (files && files.length > 0) {
						fileContentString = await processFilesIntoText(files)
					}

					// Push additional tool feedback using existing utilities
					ToolResultUtils.pushAdditionalToolFeedback(
						config.taskState.userMessageContent,
						text,
						images,
						fileContentString,
					)
					await config.callbacks.say("user_feedback", text, images, files)
					await config.callbacks.saveCheckpoint()
				}

				config.taskState.didRejectTool = true
				telemetryService.captureToolUsage(config.ulid, block.name, config.api.getModel().id, false, false)
				return `The user denied this operation. ${fileDeniedNote}`
			} else {
				// Handle approval feedback if provided (with file content processing)
				if (text || (images && images.length > 0) || (files && files.length > 0)) {
					let fileContentString = ""
					if (files && files.length > 0) {
						fileContentString = await processFilesIntoText(files)
					}

					// Push additional tool feedback using existing utilities
					ToolResultUtils.pushAdditionalToolFeedback(
						config.taskState.userMessageContent,
						text,
						images,
						fileContentString,
					)
					await config.callbacks.say("user_feedback", text, images, files)
					await config.callbacks.saveCheckpoint()
				}

				telemetryService.captureToolUsage(config.ulid, block.name, config.api.getModel().id, false, true)
			}
		}

		try {
			// Construct newContent from diff or content
			let newContent: string = ""

			if (diff) {
				// Handle replace_in_file with diff construction
				if (!config.api.getModel().id.includes("claude")) {
					// deepseek models tend to use unescaped html entities in diffs
					diff = fixModelHtmlEscaping(diff)
					diff = removeInvalidChars(diff)
				}

				// Open the editor if not done already
				if (!config.services.diffViewProvider.isEditing) {
					await config.services.diffViewProvider.open(relPath)
				}

				try {
					newContent = await constructNewFileContent(
						diff,
						config.services.diffViewProvider.originalContent || "",
						true, // isFinal = true since we're not streaming
					)
				} catch (error) {
					// Show diff error UI message (from original implementation)
					await config.callbacks.say("diff_error", relPath)

					// Extract error type from error message if possible
					const errorType =
						error instanceof Error && error.message.includes("does not match anything")
							? "search_not_found"
							: "other_diff_error"

					// Add telemetry for diff edit failure
					telemetryService.captureDiffEditFailure(config.ulid, config.api.getModel().id, errorType)

					await config.services.diffViewProvider.revertChanges()
					await config.services.diffViewProvider.reset()

					// Save checkpoint after error (from original implementation)
					await config.callbacks.saveCheckpoint()

					// Return detailed error with original content for context
					return formatResponse.toolError(
						`${(error as Error)?.message}\n\n` +
							formatResponse.diffError(relPath, config.services.diffViewProvider.originalContent),
					)
				}
			} else if (content) {
				// Handle write_to_file and new_rule with direct content
				newContent = content

				// Pre-processing newContent for cases where weaker models might add artifacts
				if (newContent.startsWith("```")) {
					newContent = newContent.split("\n").slice(1).join("\n").trim()
				}
				if (newContent.endsWith("```")) {
					newContent = newContent.split("\n").slice(0, -1).join("\n").trim()
				}

				if (!config.api.getModel().id.includes("claude")) {
					newContent = fixModelHtmlEscaping(newContent)
					newContent = removeInvalidChars(newContent)
				}
			}

			// Remove trailing newlines
			newContent = newContent.trimEnd()

			// CRITICAL: Handle the UI animation logic from original code
			// "it's important to note how this function works, you can't make the assumption that the block.partial conditional will always be called since it may immediately get complete, non-partial data. So this part of the logic will always be called.
			// in other words, you must always repeat the block.partial logic here"
			if (!config.services.diffViewProvider.isEditing) {
				// Show GUI message before showing edit animation
				const partialMessage = JSON.stringify(sharedMessageProps)
				await config.callbacks.ask("tool", partialMessage, true).catch(() => {}) // sending true for partial even though it's not a partial, this shows the edit row before the content is streamed into the editor
				await config.services.diffViewProvider.open(relPath)
			}

			// Update the diff view with the new content
			await config.services.diffViewProvider.update(newContent, true)
			await setTimeoutPromise(300) // wait for diff view to update
			await config.services.diffViewProvider.scrollToFirstDiff()

			// Mark the file as edited by Cline
			config.services.fileContextTracker.markFileAsEditedByCline(relPath)

			// Save the changes and get the result
			const { newProblemsMessage, userEdits, autoFormattingEdits, finalContent } =
				await config.services.diffViewProvider.saveChanges()

			config.taskState.didEditFile = true

			// Track file edit operation
			await config.services.fileContextTracker.trackFileContext(relPath, "cline_edited")

			// Reset the diff view
			await config.services.diffViewProvider.reset()

			// Handle user edits if any
			if (userEdits) {
				await config.services.fileContextTracker.trackFileContext(relPath, "user_edited")
				await config.callbacks.say(
					"user_feedback_diff",
					JSON.stringify({
						tool: fileExists ? "editedExistingFile" : "newFileCreated",
						path: relPath,
						diff: userEdits,
					}),
				)
				return formatResponse.fileEditWithUserChanges(
					relPath,
					userEdits,
					autoFormattingEdits,
					finalContent,
					newProblemsMessage,
				)
			} else {
				return formatResponse.fileEditWithoutUserChanges(relPath, autoFormattingEdits, finalContent, newProblemsMessage)
			}
		} catch (error) {
			// Reset diff view on error
			await config.services.diffViewProvider.revertChanges()
			await config.services.diffViewProvider.reset()
			return `Error: ${(error as Error)?.message}`
		}
	}
}
