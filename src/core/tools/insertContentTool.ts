import { getReadablePath } from "../../utils/path"
import { Cline } from "../Cline"
import { ToolUse } from "../assistant-message"
import { AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "./types"
import { formatResponse } from "../prompts/responses"
import { ClineSayTool } from "../../shared/ExtensionMessage"
import path from "path"
import { fileExistsAtPath } from "../../utils/fs"
import { insertGroups } from "../diff/insert-groups"
import delay from "delay"
import fs from "fs/promises"

export async function insertContentTool(
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
			const partialMessage = JSON.stringify(sharedMessageProps)
			await cline.ask("tool", partialMessage, block.partial).catch(() => {})
			return
		}

		// Validate required parameters
		if (!relPath) {
			cline.consecutiveMistakeCount++
			pushToolResult(await cline.sayAndCreateMissingParamError("insert_content", "path"))
			return
		}

		if (!operations) {
			cline.consecutiveMistakeCount++
			pushToolResult(await cline.sayAndCreateMissingParamError("insert_content", "operations"))
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
			start_line: number
			content: string
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

		cline.consecutiveMistakeCount = 0

		// Read the file
		const fileContent = await fs.readFile(absolutePath, "utf8")
		cline.diffViewProvider.editType = "modify"
		cline.diffViewProvider.originalContent = fileContent
		const lines = fileContent.split("\n")

		const updatedContent = insertGroups(
			lines,
			parsedOperations.map((elem) => {
				return {
					index: elem.start_line - 1,
					elements: elem.content.split("\n"),
				}
			}),
		).join("\n")

		// Show changes in diff view
		if (!cline.diffViewProvider.isEditing) {
			await cline.ask("tool", JSON.stringify(sharedMessageProps), true).catch(() => {})
			// First open with original content
			await cline.diffViewProvider.open(relPath)
			await cline.diffViewProvider.update(fileContent, false)
			cline.diffViewProvider.scrollToFirstDiff()
			await delay(200)
		}

		const diff = formatResponse.createPrettyPatch(relPath, fileContent, updatedContent)

		if (!diff) {
			pushToolResult(`No changes needed for '${relPath}'`)
			return
		}

		await cline.diffViewProvider.update(updatedContent, true)

		const completeMessage = JSON.stringify({
			...sharedMessageProps,
			diff,
		} satisfies ClineSayTool)

		const didApprove = await cline
			.ask("tool", completeMessage, false)
			.then((response) => response.response === "yesButtonClicked")

		if (!didApprove) {
			await cline.diffViewProvider.revertChanges()
			pushToolResult("Changes were rejected by the user.")
			return
		}

		const { newProblemsMessage, userEdits, finalContent } = await cline.diffViewProvider.saveChanges()
		cline.didEditFile = true

		if (!userEdits) {
			pushToolResult(`The content was successfully inserted in ${relPath.toPosix()}.${newProblemsMessage}`)
			await cline.diffViewProvider.reset()
			return
		}

		const userFeedbackDiff = JSON.stringify({
			tool: "appliedDiff",
			path: getReadablePath(cline.cwd, relPath),
			diff: userEdits,
		} satisfies ClineSayTool)

		console.debug("[DEBUG] User made edits, sending feedback diff:", userFeedbackDiff)
		await cline.say("user_feedback_diff", userFeedbackDiff)
		pushToolResult(
			`The user made the following updates to your content:\n\n${userEdits}\n\n` +
				`The updated content, which includes both your original modifications and the user's edits, has been successfully saved to ${relPath.toPosix()}. Here is the full, updated content of the file:\n\n` +
				`<final_file_content path="${relPath.toPosix()}">\n${finalContent}\n</final_file_content>\n\n` +
				`Please note:\n` +
				`1. You do not need to re-write the file with these changes, as they have already been applied.\n` +
				`2. Proceed with the task using cline updated file content as the new baseline.\n` +
				`3. If the user's edits have addressed part of the task or changed the requirements, adjust your approach accordingly.` +
				`${newProblemsMessage}`,
		)
		await cline.diffViewProvider.reset()
	} catch (error) {
		handleError("insert content", error)
		await cline.diffViewProvider.reset()
	}
}
