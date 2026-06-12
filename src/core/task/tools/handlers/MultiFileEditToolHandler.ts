import { setTimeout as setTimeoutPromise } from "node:timers/promises"
import type { ToolUse } from "@core/assistant-message"
import { constructNewFileContent } from "@core/assistant-message/diff"
import { formatResponse } from "@core/prompts/responses"
import { resolveWorkspacePath } from "@core/workspace"
import { processFilesIntoText } from "@integrations/misc/extract-text"
import { AiHydroSayTool } from "@shared/ExtensionMessage"
import { fileExistsAtPath } from "@utils/fs"
import { getReadablePath, isLocatedInWorkspace } from "@utils/path"
import { fixModelHtmlEscaping, removeInvalidChars } from "@utils/string"
import { telemetryService } from "@/services/telemetry"
import { AiHydroDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import { showNotificationForApprovalIfAutoApprovalEnabled } from "../../utils"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { ToolResultUtils } from "../utils/ToolResultUtils"

interface FileEditSection {
	path: string
	diff: string
}

// Marker that begins each per-file block inside the `edits` param. Seven '>' chars,
// matching the visual style of the SEARCH/REPLACE markers and unlikely to collide with
// real file content.
const FILE_MARKER_REGEX = /^>{7}\s*FILE:\s*(.+?)\s*$/

/**
 * Parses the `edits` param into per-file sections. Each section starts at a
 * ">>>>>>> FILE: <path>" marker line and runs until the next marker (or end).
 */
export function parseMultiFileEdits(raw: string): FileEditSection[] {
	const sections: FileEditSection[] = []
	let current: FileEditSection | null = null
	const lines = raw.split(/\r?\n/)
	for (const line of lines) {
		const match = line.match(FILE_MARKER_REGEX)
		if (match) {
			if (current) {
				sections.push(current)
			}
			current = { path: match[1].trim(), diff: "" }
		} else if (current) {
			current.diff += (current.diff ? "\n" : "") + line
		}
	}
	if (current) {
		sections.push(current)
	}
	return sections.map((s) => ({ path: s.path, diff: s.diff.trim() })).filter((s) => s.path && s.diff)
}

/**
 * Applies SEARCH/REPLACE edits across multiple files from a single tool call.
 *
 * This is the batch counterpart to replace_in_file: instead of one API round-trip per
 * file, the model lists every file's edits in one `edit_files` call. Each file is still
 * opened in its own diff view and approved individually (reusing the shared diff-view
 * provider sequentially), so the approval UX is unchanged — only the round-trip cost
 * collapses from N to 1.
 */
export class MultiFileEditToolHandler implements IFullyManagedTool {
	readonly name = AiHydroDefaultTool.MULTI_FILE_EDIT

	constructor(private validator: ToolValidator) {}

	getDescription(block: ToolUse): string {
		const count = block.params.edits ? parseMultiFileEdits(block.params.edits).length : 0
		return `[edit_files: ${count} file${count === 1 ? "" : "s"}]`
	}

	// Intentionally a no-op: we apply the edits only once the full block has arrived, so a
	// half-streamed `edits` param is never partially applied across files.
	async handlePartialBlock(_block: ToolUse, _uiHelpers: StronglyTypedUIHelpers): Promise<void> {}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const rawEdits = block.params.edits
		if (!rawEdits) {
			config.taskState.consecutiveMistakeCount++
			await config.services.diffViewProvider.reset()
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "edits")
		}

		const sections = parseMultiFileEdits(rawEdits)
		if (sections.length === 0) {
			config.taskState.consecutiveMistakeCount++
			await config.services.diffViewProvider.reset()
			return formatResponse.toolError(
				'No file sections found. Each file must start with a marker line ">>>>>>> FILE: <path>" followed by SEARCH/REPLACE blocks.',
			)
		}

		const results: string[] = []
		let anySuccess = false
		let anyAutoApproved = false

		for (const section of sections) {
			const outcome = await this.applyOneFile(config, block, section)
			results.push(outcome.message)
			if (outcome.success) {
				anySuccess = true
			}
			if (outcome.autoApproved) {
				anyAutoApproved = true
			}
			if (outcome.abort) {
				// User denied this file — stop processing the rest, mirroring single-file semantics.
				config.taskState.didRejectTool = true
				break
			}
		}

		// Count the whole batch as a single auto-approved request (not one per file).
		if (anyAutoApproved && !config.yoloModeToggled) {
			config.taskState.consecutiveAutoApprovedRequestsCount++
		}

		if (anySuccess) {
			config.taskState.didEditFile = true
			// Only clear the mistake counter when at least one file actually applied.
			config.taskState.consecutiveMistakeCount = 0
		} else {
			config.taskState.consecutiveMistakeCount++
		}

		return formatResponse.toolResult(results.join("\n\n"))
	}

	private async applyOneFile(
		config: TaskConfig,
		block: ToolUse,
		section: FileEditSection,
	): Promise<{ success: boolean; abort: boolean; autoApproved: boolean; message: string }> {
		const relPath = section.path
		const diffProvider = config.services.diffViewProvider

		// aihydroignore access check
		const accessValidation = this.validator.checkAiHydroIgnorePath(relPath)
		if (!accessValidation.ok) {
			await config.callbacks.say("aihydroignore_error", relPath)
			return {
				success: false,
				abort: false,
				autoApproved: false,
				message: `[${relPath}] blocked by .aihydroignore — skipped.`,
			}
		}

		const pathResult = resolveWorkspacePath(config, relPath, "MultiFileEditToolHandler.applyOneFile")
		const absolutePath = typeof pathResult === "string" ? pathResult : pathResult.absolutePath

		try {
			const fileExists = await fileExistsAtPath(absolutePath)
			diffProvider.editType = fileExists ? "modify" : "create"

			// Open the editor first so originalContent is populated for diff construction.
			await diffProvider.open(absolutePath, { displayPath: relPath })

			let diff = section.diff
			if (!config.api.getModel().id.includes("claude")) {
				diff = fixModelHtmlEscaping(diff)
				diff = removeInvalidChars(diff)
			}

			let newContent: string
			try {
				newContent = await constructNewFileContent(diff, diffProvider.originalContent || "", true)
			} catch (error) {
				telemetryService.captureDiffEditFailure(
					config.ulid,
					config.api.getModel().id,
					(error as Error)?.message?.includes("does not match anything") ? "search_not_found" : "other_diff_error",
				)
				await config.callbacks.say("diff_error", relPath)
				await diffProvider.revertChanges()
				await diffProvider.reset()
				return {
					success: false,
					abort: false,
					autoApproved: false,
					message: `[${relPath}] diff did not apply: ${(error as Error)?.message}. The file was not changed.`,
				}
			}
			newContent = newContent.trimEnd()

			await diffProvider.update(newContent, true)
			await setTimeoutPromise(300)
			await diffProvider.scrollToFirstDiff()

			const sharedMessageProps: AiHydroSayTool = {
				tool: fileExists ? "editedExistingFile" : "newFileCreated",
				path: getReadablePath(config.cwd, relPath),
				content: diff,
				operationIsLocatedInWorkspace: await isLocatedInWorkspace(relPath),
			}
			const completeMessage = JSON.stringify(sharedMessageProps)

			let autoApproved = false
			if (await config.callbacks.shouldAutoApproveToolWithPath(block.name, relPath)) {
				await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
				await config.callbacks.say("tool", completeMessage, undefined, undefined, false)
				autoApproved = true
			} else {
				showNotificationForApprovalIfAutoApprovalEnabled(
					`AI-Hydro wants to ${fileExists ? "edit" : "create"} ${relPath}`,
					config.autoApprovalSettings.enabled,
					config.autoApprovalSettings.enableNotifications,
				)
				await config.callbacks.removeLastPartialMessageIfExistsWithType("say", "tool")
				const { response, text, images, files } = await config.callbacks.ask("tool", completeMessage, false)
				if (response !== "yesButtonClicked") {
					if (text || (images && images.length > 0) || (files && files.length > 0)) {
						const fileContentString = files && files.length > 0 ? await processFilesIntoText(files) : ""
						ToolResultUtils.pushAdditionalToolFeedback(
							config.taskState.userMessageContent,
							text,
							images,
							fileContentString,
						)
						await config.callbacks.say("user_feedback", text, images, files)
					}
					await diffProvider.revertChanges()
					await diffProvider.reset()
					return {
						success: false,
						abort: true,
						autoApproved: false,
						message: `[${relPath}] the user denied this edit. The file maintains its original contents.`,
					}
				}
				if (text || (images && images.length > 0) || (files && files.length > 0)) {
					const fileContentString = files && files.length > 0 ? await processFilesIntoText(files) : ""
					ToolResultUtils.pushAdditionalToolFeedback(
						config.taskState.userMessageContent,
						text,
						images,
						fileContentString,
					)
					await config.callbacks.say("user_feedback", text, images, files)
				}
			}

			config.services.fileContextTracker.markFileAsEditedByAiHydro(relPath)
			const { newProblemsMessage, userEdits } = await diffProvider.saveChanges()
			config.taskState.fileReadCache.delete(absolutePath.toLowerCase())
			await config.services.fileContextTracker.trackFileContext(relPath, "aihydro_edited")
			await diffProvider.reset()

			telemetryService.captureToolUsage(config.ulid, block.name, config.api.getModel().id, false, true)

			if (userEdits) {
				await config.services.fileContextTracker.trackFileContext(relPath, "user_edited")
			}
			return {
				success: true,
				abort: false,
				autoApproved,
				message: `[${relPath}] edited successfully.${newProblemsMessage ? ` ${newProblemsMessage}` : ""}`,
			}
		} catch (error) {
			await diffProvider.revertChanges()
			await diffProvider.reset()
			return {
				success: false,
				abort: false,
				autoApproved: false,
				message: `[${relPath}] failed to edit: ${(error as Error)?.message}`,
			}
		}
	}
}
