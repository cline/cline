import path from "path"
import delay from "delay"

import { Cline } from "../Cline"
import { ClineSayTool } from "../../shared/ExtensionMessage"
import { formatResponse } from "../prompts/responses"
import { ToolUse, AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "../../shared/tools"
import { RecordSource } from "../context-tracking/FileContextTrackerTypes"
import { fileExistsAtPath } from "../../utils/fs"
import { addLineNumbers, stripLineNumbers } from "../../integrations/misc/extract-text"
import { getReadablePath } from "../../utils/path"
import { isPathOutsideWorkspace } from "../../utils/pathUtils"
import { everyLineHasLineNumbers } from "../../integrations/misc/extract-text"
import { unescapeHtmlEntities } from "../../utils/text-normalization"

export async function appendToFileTool(
	cline: Cline,
	block: ToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag,
) {
	const relPath: string | undefined = block.params.path
	let newContent: string | undefined = block.params.content

	if (!relPath || !newContent) {
		return
	}

	const accessAllowed = cline.rooIgnoreController?.validateAccess(relPath)

	if (!accessAllowed) {
		await cline.say("rooignore_error", relPath)
		pushToolResult(formatResponse.toolError(formatResponse.rooIgnoreError(relPath)))
		return
	}

	// Check if file exists using cached map or fs.access
	let fileExists: boolean
	if (cline.diffViewProvider.editType !== undefined) {
		fileExists = cline.diffViewProvider.editType === "modify"
	} else {
		const absolutePath = path.resolve(cline.cwd, relPath)
		fileExists = await fileExistsAtPath(absolutePath)
		cline.diffViewProvider.editType = fileExists ? "modify" : "create"
	}

	// pre-processing newContent for cases where weaker models might add artifacts
	if (newContent.startsWith("```")) {
		newContent = newContent.split("\n").slice(1).join("\n").trim()
	}

	if (newContent.endsWith("```")) {
		newContent = newContent.split("\n").slice(0, -1).join("\n").trim()
	}

	if (!cline.api.getModel().id.includes("claude")) {
		newContent = unescapeHtmlEntities(newContent)
	}

	// Determine if the path is outside the workspace
	const fullPath = relPath ? path.resolve(cline.cwd, removeClosingTag("path", relPath)) : ""
	const isOutsideWorkspace = isPathOutsideWorkspace(fullPath)

	const sharedMessageProps: ClineSayTool = {
		tool: fileExists ? "appliedDiff" : "newFileCreated",
		path: getReadablePath(cline.cwd, removeClosingTag("path", relPath)),
		isOutsideWorkspace,
	}

	try {
		if (block.partial) {
			// Update GUI message
			const partialMessage = JSON.stringify(sharedMessageProps)
			await cline.ask("tool", partialMessage, block.partial).catch(() => {})

			// Update editor
			if (!cline.diffViewProvider.isEditing) {
				await cline.diffViewProvider.open(relPath)
			}

			// If file exists, append newContent to existing content
			if (fileExists && cline.diffViewProvider.originalContent) {
				newContent = cline.diffViewProvider.originalContent + "\n" + newContent
			}

			// Editor is open, stream content in
			await cline.diffViewProvider.update(
				everyLineHasLineNumbers(newContent) ? stripLineNumbers(newContent) : newContent,
				false,
			)

			return
		} else {
			if (!relPath) {
				cline.consecutiveMistakeCount++
				cline.recordToolError("append_to_file")
				pushToolResult(await cline.sayAndCreateMissingParamError("append_to_file", "path"))
				await cline.diffViewProvider.reset()
				return
			}

			if (!newContent) {
				cline.consecutiveMistakeCount++
				cline.recordToolError("append_to_file")
				pushToolResult(await cline.sayAndCreateMissingParamError("append_to_file", "content"))
				await cline.diffViewProvider.reset()
				return
			}

			cline.consecutiveMistakeCount = 0

			if (!cline.diffViewProvider.isEditing) {
				const partialMessage = JSON.stringify(sharedMessageProps)
				await cline.ask("tool", partialMessage, true).catch(() => {})
				await cline.diffViewProvider.open(relPath)
			}

			// If file exists, append newContent to existing content
			if (fileExists && cline.diffViewProvider.originalContent) {
				newContent = cline.diffViewProvider.originalContent + "\n" + newContent
			}

			await cline.diffViewProvider.update(
				everyLineHasLineNumbers(newContent) ? stripLineNumbers(newContent) : newContent,
				true,
			)
			await delay(300) // wait for diff view to update
			cline.diffViewProvider.scrollToFirstDiff()

			const completeMessage = JSON.stringify({
				...sharedMessageProps,
				content: fileExists ? undefined : newContent,
				diff: fileExists
					? formatResponse.createPrettyPatch(relPath, cline.diffViewProvider.originalContent, newContent)
					: undefined,
			} satisfies ClineSayTool)

			const didApprove = await askApproval("tool", completeMessage)

			if (!didApprove) {
				await cline.diffViewProvider.revertChanges()
				return
			}

			const { newProblemsMessage, userEdits, finalContent } = await cline.diffViewProvider.saveChanges()

			// Track file edit operation
			if (relPath) {
				await cline.getFileContextTracker().trackFileContext(relPath, "roo_edited" as RecordSource)
			}

			cline.didEditFile = true

			if (userEdits) {
				await cline.say(
					"user_feedback_diff",
					JSON.stringify({
						tool: fileExists ? "appliedDiff" : "newFileCreated",
						path: getReadablePath(cline.cwd, relPath),
						diff: userEdits,
					} satisfies ClineSayTool),
				)

				pushToolResult(
					`The user made the following updates to your content:\n\n${userEdits}\n\n` +
						`The updated content, which includes both your original modifications and the user's edits, has been successfully saved to ${relPath.toPosix()}. Here is the full, updated content of the file, including line numbers:\n\n` +
						`<final_file_content path="${relPath.toPosix()}">\n${addLineNumbers(
							finalContent || "",
						)}\n</final_file_content>\n\n` +
						`Please note:\n` +
						`1. You do not need to re-write the file with these changes, as they have already been applied.\n` +
						`2. Proceed with the task using this updated file content as the new baseline.\n` +
						`3. If the user's edits have addressed part of the task or changed the requirements, adjust your approach accordingly.` +
						`${newProblemsMessage}`,
				)
			} else {
				pushToolResult(`The content was successfully appended to ${relPath.toPosix()}.${newProblemsMessage}`)
			}

			await cline.diffViewProvider.reset()

			return
		}
	} catch (error) {
		await handleError("appending to file", error)
		await cline.diffViewProvider.reset()
		return
	}
}
