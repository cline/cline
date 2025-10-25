import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { resolveWorkspacePath } from "@core/workspace"
import { processFilesIntoText } from "@integrations/misc/extract-text"
import { ClineSayTool } from "@shared/ExtensionMessage"
import { fileExistsAtPath } from "@utils/fs"
import { DiffViewProvider } from "@/integrations/editor/DiffViewProvider"
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

// Domain types
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

class DiffError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "DiffError"
	}
}

// Patch format constants
const PATCH_MARKERS = {
	BEGIN: "*** Begin Patch",
	END: "*** End Patch",
	ADD: "*** Add File: ",
	UPDATE: "*** Update File: ",
	DELETE: "*** Delete File: ",
	MOVE: "*** Move to: ",
	SECTION: "@@",
	END_FILE: "*** End of File",
} as const

const BASH_WRAPPERS = ["%%bash", "apply_patch", "EOF", "```"] as const

export class ApplyPatchHandler implements IFullyManagedTool {
	readonly name = ClineDefaultTool.APPLY_PATCH
	private appliedCommit?: Commit
	private config?: TaskConfig

	constructor(private validator: ToolValidator) {}

	getDescription(block: ToolUse): string {
		return `[${block.name} for patch application]`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const rawInput = block.params.input
		if (!rawInput) {
			return
		}

		try {
			const allFiles = this.extractAllFiles(rawInput)
			if (allFiles.length === 0) {
				return
			}

			const autoApproveCheck = async (path: string, message: ClineSayTool) => {
				const shouldAutoApprove = await uiHelpers.shouldAutoApproveToolWithPath(block.name, path)
				if (shouldAutoApprove) {
					await uiHelpers.removeLastPartialMessageIfExistsWithType("ask", "tool")
					await uiHelpers.say("tool", JSON.stringify(message), undefined, undefined, block.partial)
				} else {
					await uiHelpers.removeLastPartialMessageIfExistsWithType("say", "tool")
					await uiHelpers.ask("tool", JSON.stringify(message), block.partial).catch(() => {})
				}
			}

			const lines = this.stripBashWrapper(rawInput.split("\n"))
			const operations = {
				add: this.extractFilesFromLines(lines, PATCH_MARKERS.ADD),
				update: this.extractFilesFromLines(lines, PATCH_MARKERS.UPDATE),
				delete: this.extractFilesFromLines(lines, PATCH_MARKERS.DELETE),
			}

			if (operations.add.length > 0) {
				for (const file of operations.add) {
					const operationIsLocatedInWorkspace = await isLocatedInWorkspace(file)
					await autoApproveCheck(file, {
						tool: "newFileCreated",
						path: file,
						operationIsLocatedInWorkspace,
					})
				}
			}
			if (operations.update.length > 0) {
				for (const file of operations.update) {
					const operationIsLocatedInWorkspace = await isLocatedInWorkspace(file)
					await autoApproveCheck(file, {
						tool: "editedExistingFile",
						path: file,
						operationIsLocatedInWorkspace,
					})
				}
			}
			if (operations.delete.length > 0) {
				for (const file of operations.delete) {
					const operationIsLocatedInWorkspace = await isLocatedInWorkspace(file)
					await autoApproveCheck(file, {
						tool: "editedExistingFile",
						path: file,
						operationIsLocatedInWorkspace,
					})
				}
			}
		} catch {
			// Wait for more data if parsing fails
		}
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const provider = config.services.diffViewProvider
		const rawInput = block.params.input

		if (!rawInput) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "input")
		}

		config.taskState.consecutiveMistakeCount = 0

		try {
			const patch = this.parsePatch(rawInput)
			const allFiles = this.extractAllFiles(rawInput)

			if (allFiles.length === 0) {
				throw new DiffError(
					"No files found in patch - patch must contain at least one *** Update File:, *** Delete File:, or *** Add File: directive",
				)
			}

			// Load existing files for update/delete operations
			const filesToLoad = this.extractFilesForOperations(rawInput, [PATCH_MARKERS.UPDATE, PATCH_MARKERS.DELETE])
			const currentFiles = await this.loadFiles(provider, config, filesToLoad)

			// Convert patch to commit
			const commit = this.patchToCommit(patch, currentFiles)

			// Store state for potential revert
			this.appliedCommit = commit
			this.config = config

			// Apply the commit and get results
			const applyResults = await this.applyCommit(commit, provider)

			// Generate summary
			const changedFiles = Object.keys(commit.changes)
			const messages = await this.generateChangeSummary(commit.changes)

			const finalResponses = []

			for (const message of messages) {
				// Handle approval flow
				const approved = await this.handleApproval(config, block, message, changedFiles[0] || "")
				if (!approved) {
					// Revert all changes on rejection
					await this.revertChanges(provider)
					return "The user denied this patch operation."
				}

				// Track file edits
				for (const filePath of changedFiles) {
					config.services.fileContextTracker.markFileAsEditedByCline(filePath)
					await config.services.fileContextTracker.trackFileContext(filePath, "cline_edited")
				}

				config.taskState.didEditFile = true
				finalResponses.push(message.path)
			}

			// Clear state after successful application
			this.appliedCommit = undefined
			this.config = undefined

			// Build detailed response with file contents
			const responseLines = ["Successfully applied patch to the following files:"]
			for (const [path, result] of Object.entries(applyResults)) {
				if (result.deleted) {
					responseLines.push(`\n${path}: [deleted]`)
				} else if (result.finalContent !== undefined) {
					responseLines.push(`\n${path}:\n${result.finalContent}`)
				}
			}

			return responseLines.join("\n")
		} catch (error) {
			// Revert any changes that may have been applied before the error
			await this.revertChanges(provider)

			const errorResponse = formatResponse.toolError(`${(error as Error)?.message}`)
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
				config.taskState.toolUseIdMap,
			)

			throw error
		}
	}

	// Core parsing logic
	private parsePatch(text: string): Patch {
		const lines = this.preprocessLines(text)
		const parser = new PatchParser(lines)
		return parser.parse()
	}

	private preprocessLines(text: string): string[] {
		let lines = text.split("\n").map((line) => line.replace(/\r$/, ""))
		lines = this.stripBashWrapper(lines)

		const hasBegin = lines.length > 0 && lines[0].startsWith(PATCH_MARKERS.BEGIN)
		const hasEnd = lines.length > 0 && lines[lines.length - 1] === PATCH_MARKERS.END

		if (!hasBegin && !hasEnd) {
			return [PATCH_MARKERS.BEGIN, ...lines, PATCH_MARKERS.END]
		}
		if (hasBegin && hasEnd) {
			return lines
		}

		throw new DiffError("Invalid patch text - incomplete sentinels (missing either Begin or End)")
	}

	private stripBashWrapper(lines: string[]): string[] {
		const result: string[] = []
		let insidePatch = false
		let foundBegin = false
		let foundContent = false

		for (const line of lines) {
			// Skip bash wrappers outside patch
			if (!insidePatch && BASH_WRAPPERS.some((wrapper) => line.startsWith(wrapper))) {
				continue
			}

			if (line.startsWith(PATCH_MARKERS.BEGIN)) {
				insidePatch = true
				foundBegin = true
				result.push(line)
				continue
			}

			if (line === PATCH_MARKERS.END) {
				insidePatch = false
				result.push(line)
				continue
			}

			const isPatchContent = this.isPatchLine(line)
			if (isPatchContent) {
				foundContent = true
			}

			if (insidePatch || (!foundBegin && isPatchContent) || (line === "" && foundContent)) {
				result.push(line)
			}
		}

		// Trim trailing empty lines that may remain after stripping bash wrappers
		while (result.length > 0 && result[result.length - 1] === "") {
			result.pop()
		}

		return !foundBegin && !foundContent ? lines : result
	}

	private isPatchLine(line: string): boolean {
		return (
			line.startsWith(PATCH_MARKERS.ADD) ||
			line.startsWith(PATCH_MARKERS.UPDATE) ||
			line.startsWith(PATCH_MARKERS.DELETE) ||
			line.startsWith(PATCH_MARKERS.MOVE) ||
			line.startsWith(PATCH_MARKERS.SECTION) ||
			line.startsWith("+") ||
			line.startsWith("-") ||
			line.startsWith(" ") ||
			line === "***"
		)
	}

	// File extraction utilities
	private extractFilesForOperations(text: string, markers: readonly string[]): string[] {
		const lines = this.stripBashWrapper(text.split("\n"))
		const files: string[] = []

		for (const line of lines) {
			for (const marker of markers) {
				if (line.startsWith(marker)) {
					files.push(line.substring(marker.length).trim())
					break
				}
			}
		}

		return files
	}

	private extractAllFiles(text: string): string[] {
		return this.extractFilesForOperations(text, [PATCH_MARKERS.ADD, PATCH_MARKERS.UPDATE, PATCH_MARKERS.DELETE])
	}

	private extractFilesFromLines(lines: string[], marker: string): string[] {
		return lines.filter((line) => line.startsWith(marker)).map((line) => line.substring(marker.length).trim())
	}

	// File operations
	private async loadFiles(
		provider: DiffViewProvider,
		config: TaskConfig,
		filePaths: string[],
	): Promise<Record<string, string>> {
		const files: Record<string, string> = {}

		for (const filePath of filePaths) {
			const pathResult = resolveWorkspacePath(config, filePath, "ApplyPatchHandler.loadFiles")
			const absolutePath = typeof pathResult === "string" ? pathResult : pathResult.absolutePath
			const resolvedPath = typeof pathResult === "string" ? filePath : pathResult.resolvedPath

			const accessValidation = this.validator.checkClineIgnorePath(resolvedPath)
			if (!accessValidation.ok) {
				await config.callbacks.say("clineignore_error", resolvedPath)
				const errorResponse = formatResponse.toolError(formatResponse.clineIgnoreError(resolvedPath))
				ToolResultUtils.pushToolResult(
					errorResponse,
					{ name: this.name } as ToolUse,
					config.taskState.userMessageContent,
					ToolDisplayUtils.getToolDescription,
					config.api,
					() => {
						config.taskState.didAlreadyUseTool = true
					},
					config.coordinator,
					config.taskState.toolUseIdMap,
				)
				throw new DiffError(`Access denied: ${resolvedPath}`)
			}

			if (!(await fileExistsAtPath(absolutePath))) {
				throw new DiffError(`File not found: ${filePath}`)
			}

			provider.editType = "modify"
			await provider.open(filePath)
			const content = provider.originalContent || ""
			await provider.reset()
			files[filePath] = content
		}

		return files
	}

	private patchToCommit(patch: Patch, originalFiles: Record<string, string>): Commit {
		const changes: Record<string, FileChange> = {}

		for (const [path, action] of Object.entries(patch.actions)) {
			switch (action.type) {
				case ActionType.DELETE:
					changes[path] = { type: ActionType.DELETE, oldContent: originalFiles[path] }
					break
				case ActionType.ADD:
					if (!action.newFile) {
						throw new DiffError("ADD action without file content")
					}
					changes[path] = { type: ActionType.ADD, newContent: action.newFile }
					break
				case ActionType.UPDATE:
					changes[path] = {
						type: ActionType.UPDATE,
						oldContent: originalFiles[path],
						newContent: this.applyChunks(originalFiles[path], action.chunks, path),
						movePath: action.movePath,
					}
					break
			}
		}

		return { changes }
	}

	private applyChunks(content: string, chunks: Chunk[], path: string): string {
		const lines = content.split("\n")
		const result: string[] = []
		let currentIndex = 0

		for (const chunk of chunks) {
			if (chunk.origIndex > lines.length) {
				throw new DiffError(`${path}: chunk.origIndex ${chunk.origIndex} exceeds file length`)
			}
			if (currentIndex > chunk.origIndex) {
				throw new DiffError(`${path}: overlapping chunks at ${currentIndex} > ${chunk.origIndex}`)
			}

			result.push(...lines.slice(currentIndex, chunk.origIndex))
			result.push(...chunk.insLines)
			currentIndex = chunk.origIndex + chunk.delLines.length
		}

		result.push(...lines.slice(currentIndex))
		return result.join("\n")
	}

	private async applyCommit(
		commit: Commit,
		provider: DiffViewProvider,
	): Promise<Record<string, { finalContent?: string; deleted?: boolean }>> {
		const results: Record<string, { finalContent?: string; deleted?: boolean }> = {}

		for (const [path, change] of Object.entries(commit.changes)) {
			switch (change.type) {
				case ActionType.DELETE:
					// For delete operations, open and then revert (which deletes the file)
					provider.editType = "modify"
					await provider.open(path)
					await provider.revertChanges()
					results[path] = { deleted: true }
					break
				case ActionType.ADD:
					if (!change.newContent) {
						throw new DiffError(`Cannot create ${path} with no content`)
					}
					// For add operations, use create edit type
					provider.editType = "create"
					await provider.open(path)
					await provider.update(change.newContent, true)
					const addResult = await provider.saveChanges()
					await provider.reset()
					results[path] = { finalContent: addResult.finalContent }
					break
				case ActionType.UPDATE:
					if (!change.newContent) {
						throw new DiffError(`UPDATE change for ${path} has no new content`)
					}
					if (change.movePath) {
						// For move operations, create new file then delete old
						provider.editType = "create"
						await provider.open(change.movePath)
						await provider.update(change.newContent, true)
						const moveResult = await provider.saveChanges()
						await provider.reset()
						results[change.movePath] = { finalContent: moveResult.finalContent }

						// Delete the old file
						provider.editType = "modify"
						await provider.open(path)
						await provider.revertChanges()
						results[path] = { deleted: true }
					} else {
						// For regular updates, use modify edit type
						provider.editType = "modify"
						await provider.open(path)
						await provider.update(change.newContent, true)
						const updateResult = await provider.saveChanges()
						await provider.reset()
						results[path] = { finalContent: updateResult.finalContent }
					}
					break
			}
		}

		return results
	}

	/**
	 * Reverts all changes made by the last applyCommit operation.
	 * This method restores files to their original state before the patch was applied.
	 * Uses FileEditProvider to handle file operations similar to diffViewProvider.revertChanges()
	 */
	private async revertChanges(provider: DiffViewProvider): Promise<void> {
		if (!this.appliedCommit || !this.config) {
			return
		}

		// Revert changes for each file
		for (const [path, change] of Object.entries(this.appliedCommit.changes)) {
			try {
				switch (change.type) {
					case ActionType.DELETE:
						// Restore deleted file using FileEditProvider
						if (change.oldContent !== undefined) {
							provider.editType = "create"
							await provider.open(path)
							await provider.update(change.oldContent, true)
							await provider.saveChanges()
							await provider.reset()
						}
						break
					case ActionType.ADD:
						// Remove newly created file using FileEditProvider
						provider.editType = "modify"
						await provider.open(path)
						await provider.revertChanges()
						break
					case ActionType.UPDATE:
						// Restore original content using FileEditProvider
						if (change.movePath) {
							// If file was moved, delete the new file and restore the original
							provider.editType = "modify"
							await provider.open(change.movePath)
							await provider.revertChanges()

							if (change.oldContent !== undefined) {
								provider.editType = "create"
								await provider.open(path)
								await provider.update(change.oldContent, true)
								await provider.saveChanges()
								await provider.reset()
							}
						} else if (change.oldContent !== undefined) {
							// Restore original content at same location
							provider.editType = "modify"
							await provider.open(path)
							await provider.update(change.oldContent, true)
							await provider.saveChanges()
							await provider.reset()
						}
						break
				}
			} catch (error) {
				// Continue reverting other files even if one fails
				console.error(`Failed to revert ${path}:`, error)
			}
		}

		// Clear state after reverting
		this.appliedCommit = undefined
		this.config = undefined
	}

	// Promise all for generateChangeSummary
	private async generateChangeSummary(changes: Record<string, FileChange>): Promise<ClineSayTool[]> {
		const summaries = await Promise.all(
			Object.entries(changes).map(async ([file, change]) => {
				switch (change.type) {
					case ActionType.ADD:
						return {
							tool: "newFileCreated",
							path: file,
							content: change.newContent,
							operationIsLocatedInWorkspace: await isLocatedInWorkspace(file),
						} as ClineSayTool
					case ActionType.UPDATE:
						return {
							tool: change.movePath ? "newFileCreated" : "editedExistingFile",
							path: change.movePath || file,
							content: change.movePath ? change.oldContent : change.newContent,
							operationIsLocatedInWorkspace: await isLocatedInWorkspace(file),
						} as ClineSayTool
					case ActionType.DELETE:
					default:
						return {
							tool: "editedExistingFile",
							path: file,
							content: change.newContent,
							operationIsLocatedInWorkspace: await isLocatedInWorkspace(file),
						} as ClineSayTool
				}
			}),
		)

		return summaries
	}

	// Approval handling
	private async handleApproval(
		config: TaskConfig,
		block: ToolUse,
		message: ClineSayTool,
		primaryFile: string,
	): Promise<boolean> {
		const messageStr = JSON.stringify(message)
		const shouldAutoApprove = await config.callbacks.shouldAutoApproveToolWithPath(block.name, primaryFile)

		if (shouldAutoApprove) {
			await config.callbacks.say("tool", messageStr, undefined, undefined, false)
			config.taskState.consecutiveAutoApprovedRequestsCount++
			telemetryService.captureToolUsage(config.ulid, block.name, config.api.getModel().id, true, true)
			return true
		}

		const fileCount = Object.keys(JSON.parse(messageStr).content.match(/\d+/)?.[0] || "0").length
		showNotificationForApprovalIfAutoApprovalEnabled(
			`Cline wants to apply a patch to ${fileCount} file(s)`,
			config.autoApprovalSettings.enabled,
			config.autoApprovalSettings.enableNotifications,
		)

		const { response, text, images, files } = await config.callbacks.ask("tool", messageStr, false)

		if (text || images?.length || files?.length) {
			const fileContent = files?.length ? await processFilesIntoText(files) : ""
			ToolResultUtils.pushAdditionalToolFeedback(config.taskState.userMessageContent, text, images, fileContent)
			await config.callbacks.say("user_feedback", text, images, files)
		}

		const approved = response === "yesButtonClicked"
		config.taskState.didRejectTool = !approved
		telemetryService.captureToolUsage(config.ulid, block.name, config.api.getModel().id, false, approved)

		return approved
	}
}

// Optimized parser
class PatchParser {
	private patch: Patch = { actions: {} }
	private index = 0

	constructor(private lines: string[]) {}

	parse(): Patch {
		// Skip begin sentinel
		if (this.lines[this.index]?.startsWith(PATCH_MARKERS.BEGIN)) {
			this.index++
		}

		while (this.index < this.lines.length && !this.lines[this.index].startsWith(PATCH_MARKERS.END)) {
			const line = this.lines[this.index]

			if (line.startsWith(PATCH_MARKERS.UPDATE)) {
				this.parseUpdate(line.substring(PATCH_MARKERS.UPDATE.length).trim())
			} else if (line.startsWith(PATCH_MARKERS.DELETE)) {
				this.parseDelete(line.substring(PATCH_MARKERS.DELETE.length).trim())
			} else if (line.startsWith(PATCH_MARKERS.ADD)) {
				this.parseAdd(line.substring(PATCH_MARKERS.ADD.length).trim())
			} else {
				throw new DiffError(`Unknown line while parsing: ${line}`)
			}
		}

		return this.patch
	}

	private parseUpdate(path: string): void {
		if (path in this.patch.actions) {
			throw new DiffError(`Duplicate update for file: ${path}`)
		}

		this.index++
		const movePath = this.lines[this.index]?.startsWith(PATCH_MARKERS.MOVE)
			? this.lines[this.index++].substring(PATCH_MARKERS.MOVE.length).trim()
			: undefined

		const chunks: Chunk[] = []
		while (
			this.index < this.lines.length &&
			!this.lines[this.index].startsWith(PATCH_MARKERS.END) &&
			!this.lines[this.index].startsWith(PATCH_MARKERS.UPDATE) &&
			!this.lines[this.index].startsWith(PATCH_MARKERS.DELETE) &&
			!this.lines[this.index].startsWith(PATCH_MARKERS.ADD)
		) {
			if (this.lines[this.index].startsWith(PATCH_MARKERS.SECTION) || this.lines[this.index] === PATCH_MARKERS.SECTION) {
				this.index++
			}
			chunks.push(...this.parseChunks())
		}

		this.patch.actions[path] = { type: ActionType.UPDATE, chunks, movePath }
	}

	private parseDelete(path: string): void {
		if (path in this.patch.actions) {
			throw new DiffError(`Duplicate delete for file: ${path}`)
		}
		this.patch.actions[path] = { type: ActionType.DELETE, chunks: [] }
		this.index++
	}

	private parseAdd(path: string): void {
		if (path in this.patch.actions) {
			throw new DiffError(`Duplicate add for file: ${path}`)
		}

		this.index++
		const lines: string[] = []

		while (
			this.index < this.lines.length &&
			!this.lines[this.index].startsWith(PATCH_MARKERS.END) &&
			!this.lines[this.index].startsWith(PATCH_MARKERS.UPDATE) &&
			!this.lines[this.index].startsWith(PATCH_MARKERS.DELETE) &&
			!this.lines[this.index].startsWith(PATCH_MARKERS.ADD)
		) {
			const line = this.lines[this.index++]
			if (!line.startsWith("+")) {
				throw new DiffError(`Invalid Add File line (missing '+'): ${line}`)
			}
			lines.push(line.substring(1))
		}

		this.patch.actions[path] = { type: ActionType.ADD, newFile: lines.join("\n"), chunks: [] }
	}

	private parseChunks(): Chunk[] {
		const chunks: Chunk[] = []
		const originalLines: string[] = []
		let delLines: string[] = []
		let insLines: string[] = []
		let mode: "keep" | "add" | "delete" = "keep"

		while (this.index < this.lines.length) {
			const line = this.lines[this.index]

			if (
				line.startsWith(PATCH_MARKERS.SECTION) ||
				line.startsWith(PATCH_MARKERS.END) ||
				line.startsWith(PATCH_MARKERS.UPDATE) ||
				line.startsWith(PATCH_MARKERS.DELETE) ||
				line.startsWith(PATCH_MARKERS.ADD) ||
				line.startsWith(PATCH_MARKERS.END_FILE) ||
				line === "***"
			) {
				break
			}

			if (line.startsWith("***")) {
				throw new DiffError(`Invalid Line: ${line}`)
			}

			this.index++
			const content = line === "" ? " " : line
			const firstChar = content[0]

			const lastMode = mode
			if (firstChar === "+") {
				mode = "add"
			} else if (firstChar === "-") {
				mode = "delete"
			} else if (firstChar === " ") {
				mode = "keep"
			} else {
				throw new DiffError(`Invalid Line: ${line}`)
			}

			const lineContent = content.substring(1)

			if (mode === "keep" && lastMode !== "keep" && (insLines.length > 0 || delLines.length > 0)) {
				chunks.push({
					origIndex: originalLines.length - delLines.length,
					delLines,
					insLines,
				})
				delLines = []
				insLines = []
			}

			if (mode === "delete") {
				delLines.push(lineContent)
				originalLines.push(lineContent)
			} else if (mode === "add") {
				insLines.push(lineContent)
			} else {
				originalLines.push(lineContent)
			}
		}

		if (insLines.length > 0 || delLines.length > 0) {
			chunks.push({
				origIndex: originalLines.length - delLines.length,
				delLines,
				insLines,
			})
		}

		if (this.index < this.lines.length && this.lines[this.index] === PATCH_MARKERS.END_FILE) {
			this.index++
		}

		return chunks
	}
}
