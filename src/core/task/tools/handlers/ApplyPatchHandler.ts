import { promises as fs } from "node:fs"
import { dirname } from "node:path"
import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { resolveWorkspacePath } from "@core/workspace"
import { processFilesIntoText } from "@integrations/misc/extract-text"
import { ClineSayTool } from "@shared/ExtensionMessage"
import { fileExistsAtPath } from "@utils/fs"
import { telemetryService } from "@/services/telemetry"
import { ClineDefaultTool } from "@/shared/tools"
import { isLocatedInWorkspace } from "@/utils/path"
import type { ToolResponse } from "../../index"
import { showNotificationForApprovalIfAutoApprovalEnabled } from "../../utils"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { ToolDisplayUtils } from "../utils/ToolDisplayUtils"
import { ToolResultUtils } from "../utils/ToolResultUtils"

// Domain objects
enum ActionType {
	ADD = "add",
	DELETE = "delete",
	UPDATE = "update",
}

interface FileChange {
	type: ActionType
	oldContent?: string
	newContent?: string
	movePath?: string
}

interface Commit {
	changes: Record<string, FileChange>
}

// Exceptions
class DiffError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "DiffError"
	}
}

// Helper classes for parsing
interface Chunk {
	origIndex: number
	delLines: string[]
	insLines: string[]
}

interface PatchAction {
	type: ActionType
	newFile?: string
	chunks: Chunk[]
	movePath?: string
}

interface Patch {
	actions: Record<string, PatchAction>
}

export class ApplyPatchHandler implements IFullyManagedTool {
	readonly name = ClineDefaultTool.APPLY_PATCH

	constructor(private validator: ToolValidator) {}

	getDescription(block: ToolUse): string {
		return `[${block.name} for patch application]`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const rawInput = block.params.input

		// Early return if we don't have enough data yet
		if (!rawInput) {
			return
		}

		try {
			// Extract information from the patch for UI display
			const allFilesInPatch = this.identifyAllFilesInPatch(rawInput)

			if (allFilesInPatch.length === 0) {
				// Not enough patch data yet, wait for more
				return
			}

			// Create summary of what the patch will do
			const patchSummary = this.createPatchSummary(rawInput)
			const primaryFilePath = allFilesInPatch[0] || ""

			// Create shared message props for patch application
			const sharedMessageProps: ClineSayTool = {
				tool: "editedExistingFile",
				content: patchSummary,
				operationIsLocatedInWorkspace: primaryFilePath ? await isLocatedInWorkspace(primaryFilePath) : true,
			}
			const partialMessage = JSON.stringify(sharedMessageProps)

			// Handle auto-approval vs manual approval for partial
			if (await uiHelpers.shouldAutoApproveToolWithPath(block.name, primaryFilePath)) {
				await uiHelpers.removeLastPartialMessageIfExistsWithType("ask", "tool") // in case the user changes auto-approval settings mid stream
				await uiHelpers.say("tool", partialMessage, undefined, undefined, block.partial)
			} else {
				await uiHelpers.removeLastPartialMessageIfExistsWithType("say", "tool")
				await uiHelpers.ask("tool", partialMessage, block.partial).catch(() => {})
			}
		} catch {
			// If we can't parse the partial patch yet, just wait for more data
			return
		}
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const rawInput = block.params.input

		// Validate required parameters
		if (!rawInput) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "input")
		}

		config.taskState.consecutiveMistakeCount = 0

		try {
			// Parse the patch text
			const patch = this.parsePatchText(rawInput)

			// Check that we have at least one file operation
			const allFilesInPatch = this.identifyAllFilesInPatch(rawInput)
			if (allFilesInPatch.length === 0) {
				throw new DiffError(
					"No files found in patch - patch must contain at least one *** Update File:, *** Delete File:, or *** Add File: directive",
				)
			}

			// Get files that need to be loaded (only Update and Delete operations)
			const filesToLoad = this.identifyFilesNeeded(rawInput)
			const currentFiles: Record<string, string> = {}

			// Load existing files
			for (const filePath of filesToLoad) {
				const pathResult = resolveWorkspacePath(config, filePath, "ApplyPatchHandler.execute")
				const absolutePath = typeof pathResult === "string" ? pathResult : pathResult.absolutePath
				const resolvedPath = typeof pathResult === "string" ? filePath : pathResult.resolvedPath

				// Check clineignore access
				const accessValidation = this.validator.checkClineIgnorePath(resolvedPath)
				if (!accessValidation.ok) {
					await config.callbacks.say("clineignore_error", resolvedPath)
					const errorResponse = formatResponse.toolError(formatResponse.clineIgnoreError(resolvedPath))
					ToolResultUtils.pushToolResult(
						errorResponse,
						block,
						config.taskState.userMessageContent,
						ToolDisplayUtils.getToolDescription,
						config.api,
						() => {
							config.taskState.didAlreadyUseTool = true
						},
						config.coordinator,
					)
					return ""
				}

				if (await fileExistsAtPath(absolutePath)) {
					currentFiles[filePath] = await fs.readFile(absolutePath, "utf-8")
				} else {
					throw new DiffError(`File not found: ${filePath}`)
				}
			}

			// Convert patch to commit
			const commit = this.patchToCommit(patch, currentFiles)

			// Apply the commit
			await this.applyCommit(config, commit)

			// Create summary of changes
			const changedFiles = Object.keys(commit.changes)
			const summary = changedFiles
				.map((file) => {
					const change = commit.changes[file]
					switch (change.type) {
						case ActionType.ADD:
							return `Added: ${file}`
						case ActionType.DELETE:
							return `Deleted: ${file}`
						case ActionType.UPDATE:
							return `Updated: ${file}${change.movePath ? ` (moved to ${change.movePath})` : ""}`
						default:
							return `Modified: ${file}`
					}
				})
				.join("\n")

			const primaryFilePath = allFilesInPatch[0] || ""

			// Create shared message props for patch application
			const sharedMessageProps: ClineSayTool = {
				tool: "editedExistingFile",
				content: `Applied patch to ${changedFiles.length} file(s):\n${summary}`,
				operationIsLocatedInWorkspace: primaryFilePath ? await isLocatedInWorkspace(primaryFilePath) : true,
			}

			const completeMessage = JSON.stringify(sharedMessageProps)

			if (await config.callbacks.shouldAutoApproveToolWithPath(block.name, changedFiles[0] || "")) {
				// Auto-approval flow
				await config.callbacks.say("tool", completeMessage, undefined, undefined, false)
				config.taskState.consecutiveAutoApprovedRequestsCount++
				telemetryService.captureToolUsage(config.ulid, block.name, config.api.getModel().id, true, true)
			} else {
				// Manual approval flow
				const notificationMessage = `Cline wants to apply a patch to ${changedFiles.length} file(s)`

				showNotificationForApprovalIfAutoApprovalEnabled(
					notificationMessage,
					config.autoApprovalSettings.enabled,
					config.autoApprovalSettings.enableNotifications,
				)

				const { response, text, images, files } = await config.callbacks.ask("tool", completeMessage, false)

				if (response !== "yesButtonClicked") {
					// Handle rejection
					if (text || (images && images.length > 0) || (files && files.length > 0)) {
						let fileContentString = ""
						if (files && files.length > 0) {
							fileContentString = await processFilesIntoText(files)
						}

						ToolResultUtils.pushAdditionalToolFeedback(
							config.taskState.userMessageContent,
							text,
							images,
							fileContentString,
						)
						await config.callbacks.say("user_feedback", text, images, files)
					}

					config.taskState.didRejectTool = true
					telemetryService.captureToolUsage(config.ulid, block.name, config.api.getModel().id, false, false)

					return "The user denied this patch operation."
				} else {
					// User approved
					if (text || (images && images.length > 0) || (files && files.length > 0)) {
						let fileContentString = ""
						if (files && files.length > 0) {
							fileContentString = await processFilesIntoText(files)
						}

						ToolResultUtils.pushAdditionalToolFeedback(
							config.taskState.userMessageContent,
							text,
							images,
							fileContentString,
						)
						await config.callbacks.say("user_feedback", text, images, files)
					}

					telemetryService.captureToolUsage(config.ulid, block.name, config.api.getModel().id, false, true)
				}
			}

			// Mark files as edited
			for (const filePath of changedFiles) {
				config.services.fileContextTracker.markFileAsEditedByCline(filePath)
				await config.services.fileContextTracker.trackFileContext(filePath, "cline_edited")
			}

			config.taskState.didEditFile = true

			return formatResponse.toolResult(`Successfully applied patch to ${changedFiles.length} file(s):\n${summary}`)
		} catch (error) {
			throw error
		}
	}

	// Patch parsing methods
	private parsePatchText(text: string): Patch {
		let lines = text.split("\n")
		let startIndex = 0

		// Log the original input for debugging
		console.log("Original patch input:", text.substring(0, 500) + (text.length > 500 ? "..." : ""))

		// Remove bash command wrapper if present
		lines = this.stripBashWrapper(lines)

		// Log the filtered lines for debugging
		console.log("Filtered lines:", lines.slice(0, 10).join("\n") + (lines.length > 10 ? "\n..." : ""))

		// Check if the input has sentinels, if not, add them
		const hasBeginSentinel = lines.length > 0 && this.norm(lines[0]).startsWith("*** Begin Patch")
		const hasEndSentinel = lines.length > 0 && this.norm(lines[lines.length - 1]) === "*** End Patch"

		if (!hasBeginSentinel && !hasEndSentinel) {
			// Input doesn't have sentinels, wrap it
			lines = ["*** Begin Patch", ...lines, "*** End Patch"]
			startIndex = 1
		} else if (hasBeginSentinel && hasEndSentinel) {
			// Input has both sentinels, use as-is
			startIndex = 1
		} else {
			// Input has only one sentinel, which is invalid
			throw new DiffError("Invalid patch text - incomplete sentinels (missing either Begin or End)")
		}

		const parser = new PatchParser(lines, startIndex)
		parser.parse()
		return parser.patch
	}

	private stripBashWrapper(lines: string[]): string[] {
		const filteredLines: string[] = []
		let insidePatch = false
		let foundBeginPatch = false
		let foundAnyPatchContent = false

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]
			const normalizedLine = this.norm(line)

			// Skip bash-related lines but only if they're not part of patch content
			if (
				!insidePatch &&
				(normalizedLine.startsWith("%%bash") ||
					normalizedLine.startsWith("apply_patch") ||
					normalizedLine === "EOF" ||
					normalizedLine.startsWith("```"))
			) {
				continue
			}

			// Check for patch boundaries
			if (normalizedLine.startsWith("*** Begin Patch")) {
				insidePatch = true
				foundBeginPatch = true
				filteredLines.push(line)
				continue
			}

			if (normalizedLine === "*** End Patch") {
				insidePatch = false
				filteredLines.push(line)
				continue
			}

			// Check if this looks like patch content
			const isPatchContent = this.looksLikePatchContent(normalizedLine)
			if (isPatchContent) {
				foundAnyPatchContent = true
			}

			// Include the line if:
			// 1. We're inside a patch block, or
			// 2. We haven't found the begin patch yet but this looks like patch content, or
			// 3. It's an empty line and we've found some patch content (to preserve formatting)
			if (insidePatch || (!foundBeginPatch && isPatchContent) || (normalizedLine === "" && foundAnyPatchContent)) {
				filteredLines.push(line)
			}
		}

		// If no structured patch content was found, return the original lines
		// This handles cases where the input might be a simple diff without our custom format
		if (!foundBeginPatch && !foundAnyPatchContent) {
			return lines
		}

		return filteredLines
	}

	private looksLikePatchContent(line: string): boolean {
		return (
			line.startsWith("*** Add File:") ||
			line.startsWith("*** Update File:") ||
			line.startsWith("*** Delete File:") ||
			line.startsWith("*** Move to:") ||
			line.startsWith("@@") ||
			line.startsWith("+") ||
			line.startsWith("-") ||
			line.startsWith(" ") ||
			line === "***"
		)
	}

	private identifyFilesNeeded(text: string): string[] {
		// First try to strip bash wrapper like we do in parsing
		let lines = text.split("\n")
		lines = this.stripBashWrapper(lines)

		// Only files that need to be loaded (Update and Delete operations)
		// Add operations don't need existing files to be loaded
		const files = [
			...lines
				.filter((line) => this.norm(line).startsWith("*** Update File: "))
				.map((line) => this.norm(line).substring("*** Update File: ".length).trim()),
			...lines
				.filter((line) => this.norm(line).startsWith("*** Delete File: "))
				.map((line) => this.norm(line).substring("*** Delete File: ".length).trim()),
		]

		// Log for debugging
		console.log("Files that need to be loaded (Update/Delete only):", files)

		return files
	}

	private identifyAllFilesInPatch(text: string): string[] {
		// Get all files mentioned in the patch (Add, Update, Delete)
		let lines = text.split("\n")
		lines = this.stripBashWrapper(lines)

		const files = [
			...lines
				.filter((line) => this.norm(line).startsWith("*** Add File: "))
				.map((line) => this.norm(line).substring("*** Add File: ".length).trim()),
			...lines
				.filter((line) => this.norm(line).startsWith("*** Update File: "))
				.map((line) => this.norm(line).substring("*** Update File: ".length).trim()),
			...lines
				.filter((line) => this.norm(line).startsWith("*** Delete File: "))
				.map((line) => this.norm(line).substring("*** Delete File: ".length).trim()),
		]

		// Log for debugging
		console.log("All files in patch:", files)

		return files
	}

	private createPatchSummary(text: string): string {
		let lines = text.split("\n")
		lines = this.stripBashWrapper(lines)

		const addFiles = lines
			.filter((line) => this.norm(line).startsWith("*** Add File: "))
			.map((line) => this.norm(line).substring("*** Add File: ".length).trim())

		const updateFiles = lines
			.filter((line) => this.norm(line).startsWith("*** Update File: "))
			.map((line) => this.norm(line).substring("*** Update File: ".length).trim())

		const deleteFiles = lines
			.filter((line) => this.norm(line).startsWith("*** Delete File: "))
			.map((line) => this.norm(line).substring("*** Delete File: ".length).trim())

		const operations: string[] = []

		if (addFiles.length > 0) {
			operations.push(`Adding ${addFiles.length} file(s): ${addFiles.join(", ")}`)
		}

		if (updateFiles.length > 0) {
			operations.push(`Updating ${updateFiles.length} file(s): ${updateFiles.join(", ")}`)
		}

		if (deleteFiles.length > 0) {
			operations.push(`Deleting ${deleteFiles.length} file(s): ${deleteFiles.join(", ")}`)
		}

		const totalFiles = addFiles.length + updateFiles.length + deleteFiles.length
		const summary =
			operations.length > 0
				? `Applying patch to ${totalFiles} file(s):\n${operations.join("\n")}`
				: "Preparing to apply patch..."

		return summary
	}

	private patchToCommit(patch: Patch, orig: Record<string, string>): Commit {
		const commit: Commit = { changes: {} }

		for (const [path, action] of Object.entries(patch.actions)) {
			if (action.type === ActionType.DELETE) {
				commit.changes[path] = {
					type: ActionType.DELETE,
					oldContent: orig[path],
				}
			} else if (action.type === ActionType.ADD) {
				if (!action.newFile) {
					throw new DiffError("ADD action without file content")
				}
				commit.changes[path] = {
					type: ActionType.ADD,
					newContent: action.newFile,
				}
			} else if (action.type === ActionType.UPDATE) {
				const newContent = this.getUpdatedFile(orig[path], action, path)
				commit.changes[path] = {
					type: ActionType.UPDATE,
					oldContent: orig[path],
					newContent: newContent,
					movePath: action.movePath,
				}
			}
		}

		return commit
	}

	private getUpdatedFile(text: string, action: PatchAction, path: string): string {
		if (action.type !== ActionType.UPDATE) {
			throw new DiffError("_getUpdatedFile called with non-update action")
		}

		const origLines = text.split("\n")
		const destLines: string[] = []
		let origIndex = 0

		for (const chunk of action.chunks) {
			if (chunk.origIndex > origLines.length) {
				throw new DiffError(`${path}: chunk.origIndex ${chunk.origIndex} exceeds file length`)
			}
			if (origIndex > chunk.origIndex) {
				throw new DiffError(`${path}: overlapping chunks at ${origIndex} > ${chunk.origIndex}`)
			}

			destLines.push(...origLines.slice(origIndex, chunk.origIndex))
			origIndex = chunk.origIndex

			destLines.push(...chunk.insLines)
			origIndex += chunk.delLines.length
		}

		destLines.push(...origLines.slice(origIndex))
		return destLines.join("\n")
	}

	private async applyCommit(config: TaskConfig, commit: Commit): Promise<void> {
		for (const [path, change] of Object.entries(commit.changes)) {
			const pathResult = resolveWorkspacePath(config, path, "ApplyPatchHandler.applyCommit")
			const absolutePath = typeof pathResult === "string" ? pathResult : pathResult.absolutePath

			if (change.type === ActionType.DELETE) {
				await fs.unlink(absolutePath).catch(() => {}) // ignore if file doesn't exist
			} else if (change.type === ActionType.ADD) {
				if (!change.newContent) {
					throw new DiffError(`ADD change for ${path} has no content`)
				}
				await fs.mkdir(dirname(absolutePath), { recursive: true })
				await fs.writeFile(absolutePath, change.newContent, "utf-8")
			} else if (change.type === ActionType.UPDATE) {
				if (!change.newContent) {
					throw new DiffError(`UPDATE change for ${path} has no new content`)
				}
				const targetPath = change.movePath
					? typeof resolveWorkspacePath(config, change.movePath, "ApplyPatchHandler.applyCommit.move") === "string"
						? (resolveWorkspacePath(config, change.movePath, "ApplyPatchHandler.applyCommit.move") as string)
						: (resolveWorkspacePath(config, change.movePath, "ApplyPatchHandler.applyCommit.move") as any)
								.absolutePath
					: absolutePath

				await fs.mkdir(dirname(targetPath), { recursive: true })
				await fs.writeFile(targetPath, change.newContent, "utf-8")

				if (change.movePath) {
					await fs.unlink(absolutePath).catch(() => {}) // ignore if original file doesn't exist
				}
			}
		}
	}

	private norm(line: string): string {
		return line.replace(/\r$/, "")
	}
}

// Patch parser class
class PatchParser {
	public patch: Patch = { actions: {} }
	private index: number

	constructor(
		private lines: string[],
		startIndex: number,
	) {
		this.index = startIndex
	}

	private curLine(): string {
		if (this.index >= this.lines.length) {
			throw new DiffError("Unexpected end of input while parsing patch")
		}
		return this.lines[this.index]
	}

	private norm(line: string): string {
		return line.replace(/\r$/, "")
	}

	private isDone(prefixes?: string[]): boolean {
		if (this.index >= this.lines.length) {
			return true
		}
		if (prefixes && prefixes.length > 0 && prefixes.some((prefix) => this.norm(this.curLine()).startsWith(prefix))) {
			return true
		}
		return false
	}

	private startsWith(prefix: string | string[]): boolean {
		const prefixes = Array.isArray(prefix) ? prefix : [prefix]
		return prefixes.some((p) => this.norm(this.curLine()).startsWith(p))
	}

	private readStr(prefix: string): string {
		if (prefix === "") {
			throw new Error("readStr() requires a non-empty prefix")
		}
		if (this.norm(this.curLine()).startsWith(prefix)) {
			const text = this.curLine().substring(prefix.length)
			this.index++
			return text
		}
		return ""
	}

	private readLine(): string {
		const line = this.curLine()
		this.index++
		return line
	}

	public parse(): void {
		while (!this.isDone(["*** End Patch"])) {
			// UPDATE
			const updatePath = this.readStr("*** Update File: ")
			if (updatePath) {
				if (updatePath in this.patch.actions) {
					throw new DiffError(`Duplicate update for file: ${updatePath}`)
				}
				const moveTo = this.readStr("*** Move to: ")
				const action = this.parseUpdateFile()
				action.movePath = moveTo || undefined
				this.patch.actions[updatePath] = action
				continue
			}

			// DELETE
			const deletePath = this.readStr("*** Delete File: ")
			if (deletePath) {
				if (deletePath in this.patch.actions) {
					throw new DiffError(`Duplicate delete for file: ${deletePath}`)
				}
				this.patch.actions[deletePath] = { type: ActionType.DELETE, chunks: [] }
				continue
			}

			// ADD
			const addPath = this.readStr("*** Add File: ")
			if (addPath) {
				if (addPath in this.patch.actions) {
					throw new DiffError(`Duplicate add for file: ${addPath}`)
				}
				this.patch.actions[addPath] = this.parseAddFile()
				continue
			}

			throw new DiffError(`Unknown line while parsing: ${this.curLine()}`)
		}

		if (!this.startsWith("*** End Patch")) {
			throw new DiffError("Missing *** End Patch sentinel")
		}
		this.index++ // consume sentinel
	}

	private parseUpdateFile(): PatchAction {
		const action: PatchAction = { type: ActionType.UPDATE, chunks: [] }

		while (!this.isDone(["*** End Patch", "*** Update File:", "*** Delete File:", "*** Add File:", "*** End of File"])) {
			const defStr = this.readStr("@@ ")
			const sectionStr = this.norm(this.curLine()) === "@@" ? this.readLine() : ""

			if (!defStr && !sectionStr && this.index !== 0) {
				throw new DiffError(`Invalid line in update section:\n${this.curLine()}`)
			}

			const [, chunks, endIdx] = this.peekNextSection()
			action.chunks.push(...chunks)
			this.index = endIdx
		}

		return action
	}

	private parseAddFile(): PatchAction {
		const lines: string[] = []

		while (!this.isDone(["*** End Patch", "*** Update File:", "*** Delete File:", "*** Add File:"])) {
			const s = this.readLine()
			if (!s.startsWith("+")) {
				throw new DiffError(`Invalid Add File line (missing '+'): ${s}`)
			}
			lines.push(s.substring(1)) // strip leading '+'
		}

		return { type: ActionType.ADD, newFile: lines.join("\n"), chunks: [] }
	}

	private peekNextSection(): [string[], Chunk[], number, boolean] {
		const old: string[] = []
		let delLines: string[] = []
		let insLines: string[] = []
		const chunks: Chunk[] = []
		let mode = "keep"
		let index = this.index

		while (index < this.lines.length) {
			const s = this.lines[index]
			if (
				s.startsWith("@@") ||
				s.startsWith("*** End Patch") ||
				s.startsWith("*** Update File:") ||
				s.startsWith("*** Delete File:") ||
				s.startsWith("*** Add File:") ||
				s.startsWith("*** End of File")
			) {
				break
			}
			if (s === "***") {
				break
			}
			if (s.startsWith("***")) {
				throw new DiffError(`Invalid Line: ${s}`)
			}
			index++

			const lastMode = mode
			let line = s === "" ? " " : s
			if (line[0] === "+") {
				mode = "add"
			} else if (line[0] === "-") {
				mode = "delete"
			} else if (line[0] === " ") {
				mode = "keep"
			} else {
				throw new DiffError(`Invalid Line: ${s}`)
			}
			line = line.substring(1)

			if (mode === "keep" && lastMode !== mode) {
				if (insLines.length > 0 || delLines.length > 0) {
					chunks.push({
						origIndex: old.length - delLines.length,
						delLines: delLines,
						insLines: insLines,
					})
				}
				delLines = []
				insLines = []
			}

			if (mode === "delete") {
				delLines.push(line)
				old.push(line)
			} else if (mode === "add") {
				insLines.push(line)
			} else if (mode === "keep") {
				old.push(line)
			}
		}

		if (insLines.length > 0 || delLines.length > 0) {
			chunks.push({
				origIndex: old.length - delLines.length,
				delLines: delLines,
				insLines: insLines,
			})
		}

		if (index < this.lines.length && this.lines[index] === "*** End of File") {
			index++
			return [old, chunks, index, true]
		}

		return [old, chunks, index, false]
	}
}
