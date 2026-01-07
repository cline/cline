import path from "node:path"
import { setTimeout as setTimeoutPromise } from "node:timers/promises"
import type { ToolUse } from "@core/assistant-message"
import { constructNewFileContent } from "@core/assistant-message/diff"
import { formatResponse } from "@core/prompts/responses"
import { getWorkspaceBasename, resolveWorkspacePath } from "@core/workspace"
import { processFilesIntoText } from "@integrations/misc/extract-text"
import { ClineSayTool } from "@shared/ExtensionMessage"
import { fileExistsAtPath } from "@utils/fs"
import { arePathsEqual, getReadablePath, isLocatedInWorkspace } from "@utils/path"
import { telemetryService } from "@/services/telemetry"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import { showNotificationForApproval } from "../../utils"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { applyModelContentFixes } from "../utils/ModelContentProcessor"
import { ToolDisplayUtils } from "../utils/ToolDisplayUtils"
import { ToolResultUtils } from "../utils/ToolResultUtils"

export class WriteToFileToolHandler implements IFullyManagedTool {
	readonly name = ClineDefaultTool.FILE_NEW // This handler supports write_to_file, replace_in_file, and new_rule

	constructor(private validator: ToolValidator) {}

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.path || block.params.absolutePath}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const rawRelPath = block.params.path || block.params.absolutePath
		const rawContent = block.params.content // for write_to_file
		const rawDiff = block.params.diff // for replace_in_file

		// Early return if we don't have enough data yet
		if (!rawRelPath || (!rawContent && !rawDiff)) {
			// Wait until we have the path and either content or diff
			return
		}

		const config = uiHelpers.getConfig()

		// Creates file if it doesn't exist, and opens editor to stream content in. We don't want to handle this in the try/catch below since the error handler for it resets the diff view, which wouldn't be open if this failed.
		const result = await this.validateAndPrepareFileOperation(config, block, rawRelPath, rawDiff, rawContent)
		if (!result) {
			return
		}

		try {
			const { relPath, absolutePath, fileExists, diff, content, newContent } = result

			// Create and show partial UI message
			const sharedMessageProps: ClineSayTool = {
				tool: fileExists ? "editedExistingFile" : "newFileCreated",
				path: getReadablePath(
					config.cwd,
					uiHelpers.removeClosingTag(block, block.params.path ? "path" : "absolutePath", relPath),
				),
				content: diff || content,
				operationIsLocatedInWorkspace: await isLocatedInWorkspace(relPath),
			}
			const partialMessage = JSON.stringify(sharedMessageProps)

			// Handle auto-approval vs manual approval for partial
			if (await uiHelpers.shouldAutoApproveToolWithPath(block.name, relPath)) {
				await uiHelpers.removeLastPartialMessageIfExistsWithType("ask", "tool") // in case the user changes auto-approval settings mid stream
				await uiHelpers.say("tool", partialMessage, undefined, undefined, block.partial)
			} else {
				await uiHelpers.removeLastPartialMessageIfExistsWithType("say", "tool")
				await uiHelpers.ask("tool", partialMessage, block.partial).catch(() => {})
			}

			// CRITICAL: Open editor and stream content in real-time (from original code)
			if (!config.services.diffViewProvider.isEditing) {
				// Open the editor and prepare to stream content in
				await config.services.diffViewProvider.open(absolutePath, { displayPath: relPath })
			}
			// Editor is open, stream content in real-time (false = don't finalize yet)
			await config.services.diffViewProvider.update(newContent, false)
		} catch (error) {
			// Reset diff view on error
			await config.services.diffViewProvider.revertChanges()
			await config.services.diffViewProvider.reset()
			throw error
		}
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const rawRelPath = block.params.path || block.params.absolutePath
		const rawContent = block.params.content // for write_to_file
		const rawDiff = block.params.diff // for replace_in_file

		// Extract provider information for telemetry
		const { providerId, modelId } = this.getModelInfo(config)

		// Validate required parameters based on tool type
		if (!rawRelPath) {
			config.taskState.consecutiveMistakeCount++
			await config.services.diffViewProvider.reset()
			return await config.callbacks.sayAndCreateMissingParamError(
				block.name,
				block.params.absolutePath ? "absolutePath" : "path",
			)
		}

		if (block.name === "replace_in_file" && !rawDiff) {
			config.taskState.consecutiveMistakeCount++
			await config.services.diffViewProvider.reset()
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "diff")
		}

		if (block.name === "write_to_file" && !rawContent) {
			config.taskState.consecutiveMistakeCount++
			await config.services.diffViewProvider.reset()
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "content")
		}

		if (block.name === "new_rule" && !rawContent) {
			config.taskState.consecutiveMistakeCount++
			await config.services.diffViewProvider.reset()
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "content")
		}

		config.taskState.consecutiveMistakeCount = 0

		try {
			const result = await this.validateAndPrepareFileOperation(config, block, rawRelPath, rawDiff, rawContent)
			if (!result) {
				return "" // can only happen if the sharedLogic adds an error to userMessages
			}

			const { relPath, absolutePath, fileExists, diff, content, newContent, workspaceContext } = result

			// Handle approval flow
			const sharedMessageProps: ClineSayTool = {
				tool: fileExists ? "editedExistingFile" : "newFileCreated",
				path: getReadablePath(config.cwd, relPath),
				content: diff || content,
				operationIsLocatedInWorkspace: await isLocatedInWorkspace(relPath),
			}
			// if isEditingFile false, that means we have the full contents of the file already.
			// it's important to note how this function works, you can't make the assumption that the block.partial conditional will always be called since it may immediately get complete, non-partial data. So this part of the logic will always be called.
			// in other words, you must always repeat the block.partial logic here
			if (!config.services.diffViewProvider.isEditing) {
				// show gui message before showing edit animation
				const partialMessage = JSON.stringify(sharedMessageProps)
				await config.callbacks.ask("tool", partialMessage, true).catch(() => {}) // sending true for partial even though it's not a partial, this shows the edit row before the content is streamed into the editor
				await config.services.diffViewProvider.open(absolutePath, { displayPath: relPath })
			}
			await config.services.diffViewProvider.update(newContent, true)
			await setTimeoutPromise(300) // wait for diff view to update
			await config.services.diffViewProvider.scrollToFirstDiff()
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

			if (await config.callbacks.shouldAutoApproveToolWithPath(block.name, relPath)) {
				// Auto-approval flow
				await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
				await config.callbacks.say("tool", completeMessage, undefined, undefined, false)

				// Capture telemetry
				telemetryService.captureToolUsage(
					config.ulid,
					block.name,
					modelId,
					providerId,
					true,
					true,
					workspaceContext,
					block.isNativeToolCall,
				)

				// we need an artificial delay to let the diagnostics catch up to the changes
				await setTimeoutPromise(3_500)
			} else {
				// Manual approval flow with detailed feedback handling
				const notificationMessage = `Cline wants to ${fileExists ? "edit" : "create"} ${getWorkspaceBasename(relPath, "WriteToFile.notification")}`

				// Show notification
				showNotificationForApproval(notificationMessage, config.autoApprovalSettings.enableNotifications)

				await config.callbacks.removeLastPartialMessageIfExistsWithType("say", "tool")

				// Need a more customized tool response for file edits to highlight the fact that the file was not updated (particularly important for deepseek)

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
					}

					// // Clean up the diff view when operation is rejected
					// await config.services.diffViewProvider.revertChanges()
					// await config.services.diffViewProvider.reset()

					config.taskState.didRejectTool = true
					telemetryService.captureToolUsage(
						config.ulid,
						block.name,
						modelId,
						providerId,
						false,
						false,
						workspaceContext,
						block.isNativeToolCall,
					)

					await config.services.diffViewProvider.revertChanges()
					return `The user denied this operation. ${fileDeniedNote}`
				} else {
					// User hit the approve button, and may have provided feedback
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
					}

					telemetryService.captureToolUsage(
						config.ulid,
						block.name,
						modelId,
						providerId,
						false,
						true,
						workspaceContext,
						block.isNativeToolCall,
					)
				}
			}

			// Run PreToolUse hook after approval but before execution
			try {
				const { ToolHookUtils } = await import("../utils/ToolHookUtils")
				await ToolHookUtils.runPreToolUseIfEnabled(config, block)
			} catch (error) {
				const { PreToolUseHookCancellationError } = await import("@core/hooks/PreToolUseHookCancellationError")
				if (error instanceof PreToolUseHookCancellationError) {
					await config.services.diffViewProvider.revertChanges()
					await config.services.diffViewProvider.reset()
					return formatResponse.toolDenied()
				}
				throw error
			}

			// Mark the file as edited by Cline
			config.services.fileContextTracker.markFileAsEditedByCline(relPath)

			// Save the changes and get the result
			const { newProblemsMessage, userEdits, autoFormattingEdits, finalContent } =
				await config.services.diffViewProvider.saveChanges()

			config.taskState.didEditFile = true // used to determine if we should wait for busy terminal to update before sending api request

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
			throw error
		}
	}

	/**
	 * Shared validation and preparation logic used by both handlePartialBlock and execute methods.
	 * This validates file access permissions, checks if the file exists, and constructs the new content
	 * from either direct content or diff patches. It handles both creation of new files and modifications
	 * to existing ones.
	 *
	 * @param config The task configuration containing services and state
	 * @param block The tool use block containing the operation parameters
	 * @param relPath The relative path to the target file
	 * @param diff Optional diff content for replace operations
	 * @param content Optional direct content for write operations
	 * @param provider Optional provider string for telemetry (used when capturing diff edit failures)
	 * @returns Object containing validated path, file existence status, diff/content, and constructed new content,
	 *          or undefined if validation fails
	 */
	async validateAndPrepareFileOperation(config: TaskConfig, block: ToolUse, relPath: string, diff?: string, content?: string) {
		// Parse workspace hint and resolve path for multi-workspace support
		const pathResult = resolveWorkspacePath(config, relPath, "WriteToFileToolHandler.validateAndPrepareFileOperation")
		const { absolutePath, resolvedPath } =
			typeof pathResult === "string"
				? { absolutePath: pathResult, resolvedPath: relPath }
				: { absolutePath: pathResult.absolutePath, resolvedPath: pathResult.resolvedPath }

		// Determine workspace context for telemetry
		const fallbackAbsolutePath = path.resolve(config.cwd, relPath)
		const workspaceContext = {
			isMultiRootEnabled: config.isMultiRootEnabled || false,
			usedWorkspaceHint: typeof pathResult !== "string", // multi-root path result indicates hint usage
			resolvedToNonPrimary: !arePathsEqual(absolutePath, fallbackAbsolutePath),
			resolutionMethod: (typeof pathResult !== "string" ? "hint" : "primary_fallback") as "hint" | "primary_fallback",
		}

		// Check clineignore access first
		const accessValidation = this.validator.checkClineIgnorePath(resolvedPath)
		if (!accessValidation.ok) {
			// Show error and return early (full original behavior)
			await config.callbacks.say("clineignore_error", resolvedPath)

			// Push tool result and save checkpoint using existing utilities
			const errorResponse = formatResponse.toolError(formatResponse.clineIgnoreError(resolvedPath))
			ToolResultUtils.pushToolResult(
				errorResponse,
				block,
				config.taskState.userMessageContent,
				ToolDisplayUtils.getToolDescription,
				config.api,
				config.coordinator,
				config.taskState.toolUseIdMap,
			)
			if (!config.enableParallelToolCalling) {
				config.taskState.didAlreadyUseTool = true
			}

			return
		}

		// Check if file exists to determine the correct UI message
		let fileExists: boolean
		if (config.services.diffViewProvider.editType !== undefined) {
			fileExists = config.services.diffViewProvider.editType === "modify"
		} else {
			fileExists = await fileExistsAtPath(absolutePath)
			config.services.diffViewProvider.editType = fileExists ? "modify" : "create"
		}

		// Construct newContent from diff
		let newContent: string
		newContent = "" // default to original content if not editing

		if (diff) {
			// Handle replace_in_file with diff construction
			// Apply model-specific fixes (deepseek models tend to use unescaped html entities in diffs)
			diff = applyModelContentFixes(diff, config.api.getModel().id, resolvedPath)

			// open the editor if not done already.  This is to fix diff error when model provides correct search-replace text but Cline throws error
			// because file is not open.
			if (!config.services.diffViewProvider.isEditing) {
				await config.services.diffViewProvider.open(absolutePath, { displayPath: relPath })
			}

			try {
				newContent = await constructNewFileContent(
					diff,
					config.services.diffViewProvider.originalContent || "",
					!block.partial, // Pass the partial flag correctly
				)
			} catch (error) {
				// As we set the didAlreadyUseTool flag when the tool has failed once, we don't want to add the error message to the
				// userMessages array again on each new streaming chunk received.
				if (!config.enableParallelToolCalling && config.taskState.didAlreadyUseTool) {
					return
				}
				// Full original behavior - comprehensive error handling even for partial blocks
				await config.callbacks.say("diff_error", relPath)

				// Extract provider information for telemetry
				const { providerId, modelId } = this.getModelInfo(config)

				// Extract error type from error message if possible
				const errorType =
					error instanceof Error && error.message.includes("does not match anything")
						? "search_not_found"
						: "other_diff_error"

				// Add telemetry for diff edit failure
				const isNativeToolCall = block.isNativeToolCall === true
				telemetryService.captureDiffEditFailure(config.ulid, modelId, providerId, errorType, isNativeToolCall)

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
					config.coordinator,
					config.taskState.toolUseIdMap,
				)
				if (!config.enableParallelToolCalling) {
					config.taskState.didAlreadyUseTool = true
				}

				// Revert changes and reset diff view
				await config.services.diffViewProvider.revertChanges()
				await config.services.diffViewProvider.reset()

				return
			}
		} else if (content) {
			// Handle write_to_file with direct content
			newContent = content

			// pre-processing newContent for cases where weaker models might add artifacts like markdown codeblock markers (deepseek/llama) or extra escape characters (gemini)
			if (newContent.startsWith("```")) {
				// this handles cases where it includes language specifiers like ```python ```js
				newContent = newContent.split("\n").slice(1).join("\n").trim()
			}
			if (newContent.endsWith("```")) {
				newContent = newContent.split("\n").slice(0, -1).join("\n").trim()
			}

			// Apply model-specific fixes (llama, gemini, and other models may add escape characters)
			newContent = applyModelContentFixes(newContent, config.api.getModel().id, resolvedPath)
		} else {
			// can't happen, since we already checked for content/diff above. but need to do this for type error
			return
		}

		newContent = newContent.trimEnd() // remove any trailing newlines, since it's automatically inserted by the editor

		return { relPath, absolutePath, fileExists, diff, content, newContent, workspaceContext }
	}

	private getModelInfo(config: TaskConfig) {
		// Extract provider information for telemetry
		const apiConfig = config.services.stateManager.getApiConfiguration()
		const currentMode = config.services.stateManager.getGlobalSettingsKey("mode")
		const providerId = (currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string
		const modelId = config.api.getModel().id
		return { providerId, modelId }
	}
}
