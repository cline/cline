import * as path from "path"
import { formatResponse } from "@core/prompts/responses"
import { fileExistsAtPath } from "@utils/fs"
import { fixModelHtmlEscaping, removeInvalidChars } from "@utils/string"
import { setTimeout as setTimeoutPromise } from "node:timers/promises"
import type { ToolUse } from "@core/assistant-message"
import type { ToolResponse } from "../../index"
import type { IToolHandler } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"

export class WriteToFileToolHandler implements IToolHandler {
	readonly name = "write_to_file"

	constructor(private validator: ToolValidator) {}

	async execute(config: any, block: ToolUse): Promise<ToolResponse> {
		// For partial blocks, don't execute yet
		if (block.partial) {
			return ""
		}

		const relPath: string | undefined = block.params.path
		let content: string | undefined = block.params.content

		// Validate required parameters
		if (!relPath) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError("write_to_file", "path")
		}

		if (!content) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError("write_to_file", "content")
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
		const fileExists = await fileExistsAtPath(absolutePath)
		config.services.diffViewProvider.editType = fileExists ? "modify" : "create"

		// Pre-process content for weaker models
		if (content.startsWith("```")) {
			content = content.split("\n").slice(1).join("\n").trim()
		}
		if (content.endsWith("```")) {
			content = content.split("\n").slice(0, -1).join("\n").trim()
		}

		if (!config.api.getModel().id.includes("claude")) {
			content = fixModelHtmlEscaping(content)
			content = removeInvalidChars(content)
		}

		// Remove trailing newlines
		content = content.trimEnd()

		// Open the diff view if not already editing
		if (!config.services.diffViewProvider.isEditing) {
			await config.services.diffViewProvider.open(relPath)
		}

		// Update the diff view with the new content
		await config.services.diffViewProvider.update(content, true)
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
	}
}
