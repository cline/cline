import { Cline } from "../Cline"
import { ToolUse } from "../assistant-message"
import { AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "./types"
import { formatResponse } from "../prompts/responses"
import { ClineSayTool } from "../../shared/ExtensionMessage"
import { getReadablePath } from "../../utils/path"
import path from "path"
import { fileExistsAtPath } from "../../utils/fs"
import { addLineNumbers } from "../../integrations/misc/extract-text"
import fs from "fs/promises"

export async function searchAndReplaceTool(
	cline: Cline,
	block: ToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag,
) {
	const relPath: string | undefined = block.params.path
	const operations: string | undefined = block.params.operations

	const sharedMessageProps: ClineSayTool = {
		tool: "appliedDiff",
		path: getReadablePath(cline.cwd, removeClosingTag("path", relPath)),
	}

	try {
		if (block.partial) {
			const partialMessage = JSON.stringify({
				path: removeClosingTag("path", relPath),
				operations: removeClosingTag("operations", operations),
			})
			await cline.ask("tool", partialMessage, block.partial).catch(() => {})
			return
		} else {
			if (!relPath) {
				cline.consecutiveMistakeCount++
				pushToolResult(await cline.sayAndCreateMissingParamError("search_and_replace", "path"))
				return
			}
			if (!operations) {
				cline.consecutiveMistakeCount++
				pushToolResult(await cline.sayAndCreateMissingParamError("search_and_replace", "operations"))
				return
			}

			const absolutePath = path.resolve(cline.cwd, relPath)
			const fileExists = await fileExistsAtPath(absolutePath)

			if (!fileExists) {
				cline.consecutiveMistakeCount++
				const formattedError = `File does not exist at path: ${absolutePath}\n\n<error_details>\nThe specified file could not be found. Please verify the file path and try again.\n</error_details>`
				await cline.say("error", formattedError)
				pushToolResult(formattedError)
				return
			}

			let parsedOperations: Array<{
				search: string
				replace: string
				start_line?: number
				end_line?: number
				use_regex?: boolean
				ignore_case?: boolean
				regex_flags?: string
			}>

			try {
				parsedOperations = JSON.parse(operations)
				if (!Array.isArray(parsedOperations)) {
					throw new Error("Operations must be an array")
				}
			} catch (error) {
				cline.consecutiveMistakeCount++
				await cline.say("error", `Failed to parse operations JSON: ${error.message}`)
				pushToolResult(formatResponse.toolError("Invalid operations JSON format"))
				return
			}

			// Read the original file content
			const fileContent = await fs.readFile(absolutePath, "utf-8")
			cline.diffViewProvider.editType = "modify"
			cline.diffViewProvider.originalContent = fileContent
			let lines = fileContent.split("\n")

			for (const op of parsedOperations) {
				const flags = op.regex_flags ?? (op.ignore_case ? "gi" : "g")
				const multilineFlags = flags.includes("m") ? flags : flags + "m"

				const searchPattern = op.use_regex
					? new RegExp(op.search, multilineFlags)
					: new RegExp(escapeRegExp(op.search), multilineFlags)

				if (op.start_line || op.end_line) {
					const startLine = Math.max((op.start_line ?? 1) - 1, 0)
					const endLine = Math.min((op.end_line ?? lines.length) - 1, lines.length - 1)

					// Get the content before and after the target section
					const beforeLines = lines.slice(0, startLine)
					const afterLines = lines.slice(endLine + 1)

					// Get the target section and perform replacement
					const targetContent = lines.slice(startLine, endLine + 1).join("\n")
					const modifiedContent = targetContent.replace(searchPattern, op.replace)
					const modifiedLines = modifiedContent.split("\n")

					// Reconstruct the full content with the modified section
					lines = [...beforeLines, ...modifiedLines, ...afterLines]
				} else {
					// Global replacement
					const fullContent = lines.join("\n")
					const modifiedContent = fullContent.replace(searchPattern, op.replace)
					lines = modifiedContent.split("\n")
				}
			}

			const newContent = lines.join("\n")

			cline.consecutiveMistakeCount = 0

			// Show diff preview
			const diff = formatResponse.createPrettyPatch(relPath, fileContent, newContent)

			if (!diff) {
				pushToolResult(`No changes needed for '${relPath}'`)
				return
			}

			await cline.diffViewProvider.open(relPath)
			await cline.diffViewProvider.update(newContent, true)
			cline.diffViewProvider.scrollToFirstDiff()

			const completeMessage = JSON.stringify({
				...sharedMessageProps,
				diff: diff,
			} satisfies ClineSayTool)

			const didApprove = await askApproval("tool", completeMessage)
			if (!didApprove) {
				await cline.diffViewProvider.revertChanges() // cline likely handles closing the diff view
				return
			}

			const { newProblemsMessage, userEdits, finalContent } = await cline.diffViewProvider.saveChanges()
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
						`<final_file_content path="${relPath.toPosix()}">\n${addLineNumbers(finalContent || "")}\n</final_file_content>\n\n` +
						`Please note:\n` +
						`1. You do not need to re-write the file with these changes, as they have already been applied.\n` +
						`2. Proceed with the task using cline updated file content as the new baseline.\n` +
						`3. If the user's edits have addressed part of the task or changed the requirements, adjust your approach accordingly.` +
						`${newProblemsMessage}`,
				)
			} else {
				pushToolResult(`Changes successfully applied to ${relPath.toPosix()}:\n\n${newProblemsMessage}`)
			}
			await cline.diffViewProvider.reset()
			return
		}
	} catch (error) {
		await handleError("applying search and replace", error)
		await cline.diffViewProvider.reset()
		return
	}
}

function escapeRegExp(string: string): string {
	return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
