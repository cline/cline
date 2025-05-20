import path from "path"
import fs from "fs/promises"

import { ClineSayTool } from "../../shared/ExtensionMessage"
import { getReadablePath } from "../../utils/path"
import { Task } from "../task/Task"
import { ToolUse, RemoveClosingTag, AskApproval, HandleError, PushToolResult } from "../../shared/tools"
import { formatResponse } from "../prompts/responses"
import { fileExistsAtPath } from "../../utils/fs"
import { addLineNumbers } from "../../integrations/misc/extract-text"
import { RecordSource } from "../context-tracking/FileContextTrackerTypes"
import { telemetryService } from "../../services/telemetry/TelemetryService"
import { unescapeHtmlEntities } from "../../utils/text-normalization"

export async function applyDiffTool(
	cline: Task,
	block: ToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag,
) {
	const relPath: string | undefined = block.params.path
	let diffContent: string | undefined = block.params.diff

	if (diffContent && !cline.api.getModel().id.includes("claude")) {
		diffContent = unescapeHtmlEntities(diffContent)
	}

	const sharedMessageProps: ClineSayTool = {
		tool: "appliedDiff",
		path: getReadablePath(cline.cwd, removeClosingTag("path", relPath)),
		diff: diffContent,
	}

	try {
		if (block.partial) {
			// Update GUI message
			let toolProgressStatus

			if (cline.diffStrategy && cline.diffStrategy.getProgressStatus) {
				toolProgressStatus = cline.diffStrategy.getProgressStatus(block)
			}

			if (toolProgressStatus && Object.keys(toolProgressStatus).length === 0) {
				return
			}

			await cline
				.ask("tool", JSON.stringify(sharedMessageProps), block.partial, toolProgressStatus)
				.catch(() => {})

			return
		} else {
			if (!relPath) {
				cline.consecutiveMistakeCount++
				cline.recordToolError("apply_diff")
				pushToolResult(await cline.sayAndCreateMissingParamError("apply_diff", "path"))
				return
			}

			if (!diffContent) {
				cline.consecutiveMistakeCount++
				cline.recordToolError("apply_diff")
				pushToolResult(await cline.sayAndCreateMissingParamError("apply_diff", "diff"))
				return
			}

			const accessAllowed = cline.rooIgnoreController?.validateAccess(relPath)

			if (!accessAllowed) {
				await cline.say("rooignore_error", relPath)
				pushToolResult(formatResponse.toolError(formatResponse.rooIgnoreError(relPath)))
				return
			}

			const absolutePath = path.resolve(cline.cwd, relPath)
			const fileExists = await fileExistsAtPath(absolutePath)

			if (!fileExists) {
				cline.consecutiveMistakeCount++
				cline.recordToolError("apply_diff")
				const formattedError = `File does not exist at path: ${absolutePath}\n\n<error_details>\nThe specified file could not be found. Please verify the file path and try again.\n</error_details>`
				await cline.say("error", formattedError)
				pushToolResult(formattedError)
				return
			}

			const originalContent = await fs.readFile(absolutePath, "utf-8")

			// Apply the diff to the original content
			const diffResult = (await cline.diffStrategy?.applyDiff(
				originalContent,
				diffContent,
				parseInt(block.params.start_line ?? ""),
			)) ?? {
				success: false,
				error: "No diff strategy available",
			}

			if (!diffResult.success) {
				cline.consecutiveMistakeCount++
				const currentCount = (cline.consecutiveMistakeCountForApplyDiff.get(relPath) || 0) + 1
				cline.consecutiveMistakeCountForApplyDiff.set(relPath, currentCount)
				let formattedError = ""
				telemetryService.captureDiffApplicationError(cline.taskId, currentCount)

				if (diffResult.failParts && diffResult.failParts.length > 0) {
					for (const failPart of diffResult.failParts) {
						if (failPart.success) {
							continue
						}

						const errorDetails = failPart.details ? JSON.stringify(failPart.details, null, 2) : ""

						formattedError = `<error_details>\n${
							failPart.error
						}${errorDetails ? `\n\nDetails:\n${errorDetails}` : ""}\n</error_details>`
					}
				} else {
					const errorDetails = diffResult.details ? JSON.stringify(diffResult.details, null, 2) : ""

					formattedError = `Unable to apply diff to file: ${absolutePath}\n\n<error_details>\n${
						diffResult.error
					}${errorDetails ? `\n\nDetails:\n${errorDetails}` : ""}\n</error_details>`
				}

				if (currentCount >= 2) {
					await cline.say("diff_error", formattedError)
				}

				cline.recordToolError("apply_diff", formattedError)

				pushToolResult(formattedError)
				return
			}

			cline.consecutiveMistakeCount = 0
			cline.consecutiveMistakeCountForApplyDiff.delete(relPath)

			// Show diff view before asking for approval
			cline.diffViewProvider.editType = "modify"
			await cline.diffViewProvider.open(relPath)
			await cline.diffViewProvider.update(diffResult.content, true)
			await cline.diffViewProvider.scrollToFirstDiff()

			const completeMessage = JSON.stringify({
				...sharedMessageProps,
				diff: diffContent,
			} satisfies ClineSayTool)

			let toolProgressStatus

			if (cline.diffStrategy && cline.diffStrategy.getProgressStatus) {
				toolProgressStatus = cline.diffStrategy.getProgressStatus(block, diffResult)
			}

			const didApprove = await askApproval("tool", completeMessage, toolProgressStatus)

			if (!didApprove) {
				await cline.diffViewProvider.revertChanges() // Cline likely handles closing the diff view
				return
			}

			const { newProblemsMessage, userEdits, finalContent } = await cline.diffViewProvider.saveChanges()

			// Track file edit operation
			if (relPath) {
				await cline.fileContextTracker.trackFileContext(relPath, "roo_edited" as RecordSource)
			}

			// Used to determine if we should wait for busy terminal to update before sending api request
			cline.didEditFile = true
			let partFailHint = ""

			if (diffResult.failParts && diffResult.failParts.length > 0) {
				partFailHint = `But unable to apply all diff parts to file: ${absolutePath}, silently use <read_file> tool to check newest file version and re-apply diffs\n`
			}

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
						partFailHint +
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
				pushToolResult(
					`Changes successfully applied to ${relPath.toPosix()}:\n\n${newProblemsMessage}\n` + partFailHint,
				)
			}

			await cline.diffViewProvider.reset()

			return
		}
	} catch (error) {
		await handleError("applying diff", error)
		await cline.diffViewProvider.reset()
		return
	}
}
