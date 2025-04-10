import * as vscode from "vscode"

import { Cline } from "../Cline"
import { ClineSayTool } from "../../shared/ExtensionMessage"
import { ToolUse } from "../assistant-message"
import { formatResponse } from "../prompts/responses"
import { AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "./types"
import { RecordSource } from "../context-tracking/FileContextTrackerTypes"
import path from "path"
import { fileExistsAtPath } from "../../utils/fs"
import { addLineNumbers, stripLineNumbers } from "../../integrations/misc/extract-text"
import { getReadablePath } from "../../utils/path"
import { isPathOutsideWorkspace } from "../../utils/pathUtils"
import { everyLineHasLineNumbers } from "../../integrations/misc/extract-text"
import delay from "delay"
import { detectCodeOmission } from "../../integrations/editor/detect-omission"

export async function writeToFileTool(
	cline: Cline,
	block: ToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag,
) {
	const relPath: string | undefined = block.params.path
	let newContent: string | undefined = block.params.content
	let predictedLineCount: number | undefined = parseInt(block.params.line_count ?? "0")
	if (!relPath || !newContent) {
		// checking for newContent ensure relPath is complete
		// wait so we can determine if it's a new file or editing an existing file
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

	// pre-processing newContent for cases where weaker models might add artifacts like markdown codeblock markers (deepseek/llama) or extra escape characters (gemini)
	if (newContent.startsWith("```")) {
		// cline handles cases where it includes language specifiers like ```python ```js
		newContent = newContent.split("\n").slice(1).join("\n").trim()
	}
	if (newContent.endsWith("```")) {
		newContent = newContent.split("\n").slice(0, -1).join("\n").trim()
	}

	if (!cline.api.getModel().id.includes("claude")) {
		// it seems not just llama models are doing cline, but also gemini and potentially others
		if (newContent.includes("&gt;") || newContent.includes("&lt;") || newContent.includes("&quot;")) {
			newContent = newContent
				.replace(/&gt;/g, ">")
				.replace(/&lt;/g, "<")
				.replace(/&quot;/g, '"')
		}
	}

	// Determine if the path is outside the workspace
	const fullPath = relPath ? path.resolve(cline.cwd, removeClosingTag("path", relPath)) : ""
	const isOutsideWorkspace = isPathOutsideWorkspace(fullPath)

	const sharedMessageProps: ClineSayTool = {
		tool: fileExists ? "editedExistingFile" : "newFileCreated",
		path: getReadablePath(cline.cwd, removeClosingTag("path", relPath)),
		isOutsideWorkspace,
	}
	try {
		if (block.partial) {
			// update gui message
			const partialMessage = JSON.stringify(sharedMessageProps)
			await cline.ask("tool", partialMessage, block.partial).catch(() => {})
			// update editor
			if (!cline.diffViewProvider.isEditing) {
				// open the editor and prepare to stream content in
				await cline.diffViewProvider.open(relPath)
			}
			// editor is open, stream content in
			await cline.diffViewProvider.update(
				everyLineHasLineNumbers(newContent) ? stripLineNumbers(newContent) : newContent,
				false,
			)
			return
		} else {
			if (!relPath) {
				cline.consecutiveMistakeCount++
				pushToolResult(await cline.sayAndCreateMissingParamError("write_to_file", "path"))
				await cline.diffViewProvider.reset()
				return
			}
			if (!newContent) {
				cline.consecutiveMistakeCount++
				pushToolResult(await cline.sayAndCreateMissingParamError("write_to_file", "content"))
				await cline.diffViewProvider.reset()
				return
			}
			if (!predictedLineCount) {
				cline.consecutiveMistakeCount++
				pushToolResult(await cline.sayAndCreateMissingParamError("write_to_file", "line_count"))
				await cline.diffViewProvider.reset()
				return
			}
			cline.consecutiveMistakeCount = 0

			// if isEditingFile false, that means we have the full contents of the file already.
			// it's important to note how cline function works, you can't make the assumption that the block.partial conditional will always be called since it may immediately get complete, non-partial data. So cline part of the logic will always be called.
			// in other words, you must always repeat the block.partial logic here
			if (!cline.diffViewProvider.isEditing) {
				// show gui message before showing edit animation
				const partialMessage = JSON.stringify(sharedMessageProps)
				await cline.ask("tool", partialMessage, true).catch(() => {}) // sending true for partial even though it's not a partial, cline shows the edit row before the content is streamed into the editor
				await cline.diffViewProvider.open(relPath)
			}
			await cline.diffViewProvider.update(
				everyLineHasLineNumbers(newContent) ? stripLineNumbers(newContent) : newContent,
				true,
			)
			await delay(300) // wait for diff view to update
			cline.diffViewProvider.scrollToFirstDiff()

			// Check for code omissions before proceeding
			if (detectCodeOmission(cline.diffViewProvider.originalContent || "", newContent, predictedLineCount)) {
				if (cline.diffStrategy) {
					await cline.diffViewProvider.revertChanges()
					pushToolResult(
						formatResponse.toolError(
							`Content appears to be truncated (file has ${
								newContent.split("\n").length
							} lines but was predicted to have ${predictedLineCount} lines), and found comments indicating omitted code (e.g., '// rest of code unchanged', '/* previous code */'). Please provide the complete file content without any omissions if possible, or otherwise use the 'apply_diff' tool to apply the diff to the original file.`,
						),
					)
					return
				} else {
					vscode.window
						.showWarningMessage(
							"Potential code truncation detected. cline happens when the AI reaches its max output limit.",
							"Follow cline guide to fix the issue",
						)
						.then((selection) => {
							if (selection === "Follow cline guide to fix the issue") {
								vscode.env.openExternal(
									vscode.Uri.parse(
										"https://github.com/cline/cline/wiki/Troubleshooting-%E2%80%90-Cline-Deleting-Code-with-%22Rest-of-Code-Here%22-Comments",
									),
								)
							}
						})
				}
			}

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
			cline.didEditFile = true // used to determine if we should wait for busy terminal to update before sending api request
			if (userEdits) {
				await cline.say(
					"user_feedback_diff",
					JSON.stringify({
						tool: fileExists ? "editedExistingFile" : "newFileCreated",
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
						`2. Proceed with the task using cline updated file content as the new baseline.\n` +
						`3. If the user's edits have addressed part of the task or changed the requirements, adjust your approach accordingly.` +
						`${newProblemsMessage}`,
				)
			} else {
				pushToolResult(`The content was successfully saved to ${relPath.toPosix()}.${newProblemsMessage}`)
			}
			await cline.diffViewProvider.reset()
			return
		}
	} catch (error) {
		await handleError("writing file", error)
		await cline.diffViewProvider.reset()
		return
	}
}
