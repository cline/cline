import * as path from "path"
import { formatResponse } from "@core/prompts/responses"
import { fileExistsAtPath } from "@utils/fs"
import { fixModelHtmlEscaping, removeInvalidChars } from "@utils/string"
import { setTimeout as setTimeoutPromise } from "node:timers/promises"
import { constructNewFileContent } from "@core/assistant-message/diff"
import type { ToolUse } from "@core/assistant-message"
import type { ToolResponse } from "../../index"
import type { IToolHandler } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"

export class WriteToFileToolHandler implements IToolHandler {
	readonly name = "write_to_file" // This handler supports write_to_file, replace_in_file, and new_rule

	constructor(private validator: ToolValidator) {}

	async execute(config: any, block: ToolUse): Promise<ToolResponse> {
		// For partial blocks, return empty string to let coordinator handle UI
		if (block.partial) {
			return ""
		}

		const relPath: string | undefined = block.params.path
		let content: string | undefined = block.params.content // for write_to_file and new_rule
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
			return `Error: File access blocked by .clineignore rules: ${relPath}`
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
					await config.services.diffViewProvider.revertChanges()
					await config.services.diffViewProvider.reset()
					return `Error: ${(error as Error)?.message}\n\nDiff parsing failed for ${relPath}`
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

			// Open the diff view if not already editing
			if (!config.services.diffViewProvider.isEditing) {
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
