import { readFile } from "node:fs/promises"
import type { ToolUse } from "@core/assistant-message"
import { resolveWorkspacePath } from "@core/workspace"
import { processFilesIntoText } from "@integrations/misc/extract-text"
import type { ClineSayTool } from "@shared/ExtensionMessage"
import { fileExistsAtPath } from "@utils/fs"
import { isLocatedInWorkspace } from "@utils/path"
import { telemetryService } from "@/services/telemetry"
import { preserveEscaping } from "@/shared/canonicalize"
import { BASH_WRAPPERS, DiffError, PATCH_MARKERS, type Patch, PatchActionType, type PatchChunk } from "@/shared/Patch"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import { showNotificationForApproval } from "../../utils"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { type FileOpsResult, FileProviderOperations } from "../utils/FileProviderOperations"
import { PatchParser } from "../utils/PatchParser"
import { PathResolver } from "../utils/PathResolver"
import { ToolResultUtils } from "../utils/ToolResultUtils"

interface FileChange {
	type: PatchActionType
	oldContent?: string
	newContent?: string
	movePath?: string
}

interface Commit {
	changes: Record<string, FileChange>
}

export class ApplyPatchHandler implements IFullyManagedTool {
	readonly name = ClineDefaultTool.APPLY_PATCH
	private appliedCommit?: Commit
	private config?: TaskConfig
	private pathResolver?: PathResolver
	private providerOps?: FileProviderOperations
	private partialPreviewState?: {
		originalFiles: Record<string, string>
		currentPreviewPath?: string
	}

	constructor(private validator: ToolValidator) {}

	private initializeHelpers(config: TaskConfig): void {
		if (!this.pathResolver || this.config !== config) {
			this.pathResolver = new PathResolver(config, this.validator)
		}
		if (!this.providerOps) {
			this.providerOps = new FileProviderOperations(config.services.diffViewProvider)
		}
	}

	getDescription(_block: ToolUse): string {
		return `[${this.name} for patch application]`
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

			const config = uiHelpers.getConfig()
			this.initializeHelpers(config)

			// Preview the first file being edited
			await this.previewPatchStream(rawInput, uiHelpers).catch(() => {})
		} catch {
			// Wait for more data if parsing fails
		}
	}

	private ensurePartialPreviewState(): { originalFiles: Record<string, string>; currentPreviewPath?: string } {
		if (!this.partialPreviewState) {
			this.partialPreviewState = { originalFiles: {} }
		}
		return this.partialPreviewState
	}

	private async previewPatchStream(rawInput: string, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const config = uiHelpers.getConfig()
		const provider = config.services.diffViewProvider
		this.initializeHelpers(config)

		const state = this.ensurePartialPreviewState()
		const lines = this.stripBashWrapper(rawInput.split("\n"))

		// Extract the first operation path and type
		let targetPath: string | undefined
		let actionType: PatchActionType | undefined
		let contentStartIndex = -1

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]
			if (line.startsWith(PATCH_MARKERS.ADD)) {
				targetPath = line.substring(PATCH_MARKERS.ADD.length).trim()
				actionType = PatchActionType.ADD
				contentStartIndex = i + 1
				break
			}
			if (line.startsWith(PATCH_MARKERS.UPDATE)) {
				targetPath = line.substring(PATCH_MARKERS.UPDATE.length).trim()
				actionType = PatchActionType.UPDATE
				contentStartIndex = i + 1
				break
			}
			if (line.startsWith(PATCH_MARKERS.DELETE)) {
				targetPath = line.substring(PATCH_MARKERS.DELETE.length).trim()
				actionType = PatchActionType.DELETE
				contentStartIndex = i + 1
				break
			}
		}

		if (!targetPath || targetPath.length === 0 || targetPath.includes("***")) {
			return
		}

		// Check for move marker
		let movePath: string | undefined
		if (actionType === PatchActionType.UPDATE && contentStartIndex >= 0) {
			const nextLine = lines[contentStartIndex]
			if (nextLine?.startsWith(PATCH_MARKERS.MOVE)) {
				movePath = nextLine.substring(PATCH_MARKERS.MOVE.length).trim()
				contentStartIndex++
			}
		}

		// For ADD operations, ensure we have content
		if (actionType === PatchActionType.ADD) {
			if (contentStartIndex < 0 || contentStartIndex >= lines.length) {
				return
			}
			const contentLines = lines.slice(contentStartIndex)
			if (contentLines.length === 0 || (contentLines.length === 1 && contentLines[0] === "")) {
				return
			}
		}

		const finalPath = movePath || targetPath
		const targetResolution = await this.pathResolver!.resolveAndValidate(finalPath, "ApplyPatchHandler.previewPatch")
		if (!targetResolution) {
			return
		}

		const requiresOpen =
			!provider.isEditing || state.currentPreviewPath !== targetResolution.resolvedPath || provider.editType === undefined

		const needsCreateEditor = actionType === PatchActionType.ADD || (actionType === PatchActionType.UPDATE && !!movePath)

		if (requiresOpen) {
			provider.editType = needsCreateEditor ? "create" : "modify"
			await provider.open(targetResolution.absolutePath, { displayPath: targetResolution.resolvedPath })
			state.currentPreviewPath = targetResolution.resolvedPath
		}

		let newContent: string | undefined

		switch (actionType) {
			case PatchActionType.ADD: {
				const contentLines = lines.slice(contentStartIndex)
				newContent = contentLines
					.filter((l) => l.startsWith("+"))
					.map((l) => l.substring(1))
					.join("\n")
				break
			}
			case PatchActionType.UPDATE: {
				const sourceResolution = await this.pathResolver!.resolveAndValidate(
					targetPath,
					"ApplyPatchHandler.previewPatch.source",
				)
				if (!sourceResolution) {
					return
				}

				const originalContent = provider.originalContent
				if (originalContent === undefined) {
					return
				}

				// For streaming preview, just show original content - full application happens in execute
				newContent = originalContent
				break
			}
			case PatchActionType.DELETE:
				newContent = ""
				provider.editType = "modify"
				break
			default:
				return
		}

		if (newContent === undefined) {
			return
		}

		try {
			await provider.update(newContent, false)
		} catch {
			// Ignore streaming errors
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
		this.initializeHelpers(config)

		if (provider.isEditing) {
			try {
				await provider.reset()
			} catch {
				// Ignore reset errors
			}
		}
		this.partialPreviewState = undefined

		try {
			const lines = this.preprocessLines(rawInput)

			// Identify files needed
			const filesToLoad = this.extractFilesForOperations(rawInput, [PATCH_MARKERS.UPDATE, PATCH_MARKERS.DELETE])
			const currentFiles = await this.loadFiles(config, filesToLoad)

			// Parse patch
			const parser = new PatchParser(lines, currentFiles)
			const { patch, fuzz } = parser.parse()

			// Convert to commit
			const commit = this.patchToCommit(patch, currentFiles)

			// Store for potential revert
			this.appliedCommit = commit
			this.config = config

			// Apply the commit
			const applyResults = await this.applyCommit(commit)

			// Generate summary
			const changedFiles = Object.keys(commit.changes)
			const messages = await this.generateChangeSummary(commit.changes)

			const finalResponses = []

			for (const message of messages) {
				const approved = await this.handleApproval(config, block, message, rawInput)
				if (!approved) {
					await this.revertChanges()
					return "The user denied this patch operation."
				}

				for (const filePath of changedFiles) {
					config.services.fileContextTracker.markFileAsEditedByCline(filePath)
					await config.services.fileContextTracker.trackFileContext(filePath, "cline_edited")
				}

				config.taskState.didEditFile = true
				finalResponses.push(message.path)
			}

			this.appliedCommit = undefined
			this.config = undefined

			// Build response with file contents and diagnostics
			const responseLines = ["Successfully applied patch to the following files:"]

			for (const [path, result] of Object.entries(applyResults)) {
				if (result.deleted) {
					responseLines.push(`\n${path}: [deleted]`)
				} else {
					// Format response similar to WriteToFileToolHandler
					if (result.userEdits) {
						// User made edits during approval
						responseLines.push(`\nThe user made edits to the file:\n${result.userEdits}\n`)
						await config.callbacks.say(
							"user_feedback_diff",
							JSON.stringify({
								tool: "editedExistingFile",
								path,
								diff: result.userEdits,
							}),
						)
					}
					if (result.autoFormattingEdits) {
						responseLines.push(`\nAuto-formatting was applied to ${path}:\n${result.autoFormattingEdits}\n`)
					}
					if (result.finalContent) {
						responseLines.push(`\n<final_file_content path="${path}">`)
						responseLines.push(result.finalContent)
						responseLines.push(`\n</final_file_content>`)
					}
					if (result.newProblemsMessage) {
						responseLines.push(`\n\n${result.newProblemsMessage}`)
					}
				}
			}

			if (fuzz > 0) {
				responseLines.push(`\nNote: Patch applied with fuzz factor ${fuzz}`)
			}

			return responseLines.join("\n")
		} catch (error) {
			await provider.revertChanges()
			await provider.reset()
			console.error("Reverted changes due to error in ApplyPatchHandler.", error)
			throw error
		}
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
		// Missing one of the sentinels: BEGIN or END PATCH
		throw new DiffError("Invalid patch text - incomplete sentinels. Try breaking it into smaller patches.")
	}

	private stripBashWrapper(lines: string[]): string[] {
		const result: string[] = []
		let insidePatch = false
		let foundBegin = false
		let foundContent = false

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]
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
			if (isPatchContent && i !== lines.length - 1) {
				foundContent = true
			}

			if (insidePatch || (!foundBegin && isPatchContent) || (line === "" && foundContent)) {
				result.push(line)
			}
		}

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

	private async loadFiles(config: TaskConfig, filePaths: string[]): Promise<Record<string, string>> {
		const files: Record<string, string> = {}

		for (const filePath of filePaths) {
			const pathResult = resolveWorkspacePath(config, filePath, "ApplyPatchHandler.loadFiles")
			const absolutePath = typeof pathResult === "string" ? pathResult : pathResult.absolutePath
			const resolvedPath = typeof pathResult === "string" ? filePath : pathResult.resolvedPath

			const accessValidation = this.validator.checkClineIgnorePath(resolvedPath)
			if (!accessValidation.ok) {
				await config.callbacks.say("clineignore_error", resolvedPath)
				throw new DiffError(`Access denied: ${resolvedPath}`)
			}

			if (!(await fileExistsAtPath(absolutePath))) {
				throw new DiffError(`File not found: ${filePath}`)
			}

			const fileContent = await readFile(absolutePath, "utf8")
			const normalizedContent = fileContent.replace(/\r\n/g, "\n")
			files[filePath] = normalizedContent
		}

		return files
	}

	private patchToCommit(patch: Patch, originalFiles: Record<string, string>): Commit {
		const changes: Record<string, FileChange> = {}

		for (const [path, action] of Object.entries(patch.actions)) {
			switch (action.type) {
				case PatchActionType.DELETE:
					changes[path] = { type: PatchActionType.DELETE, oldContent: originalFiles[path] }
					break
				case PatchActionType.ADD:
					if (!action.newFile) {
						throw new DiffError("ADD action without file content")
					}
					changes[path] = { type: PatchActionType.ADD, newContent: action.newFile }
					break
				case PatchActionType.UPDATE:
					changes[path] = {
						type: PatchActionType.UPDATE,
						oldContent: originalFiles[path],
						newContent: this.applyChunks(originalFiles[path]!, action.chunks, path),
						movePath: action.movePath,
					}
					break
			}
		}

		return { changes }
	}

	private applyChunks(content: string, chunks: PatchChunk[], path: string): string {
		if (chunks.length === 0) {
			return content
		}

		const endsWithNewline = content.endsWith("\n")
		const lines = content.split("\n")
		const result: string[] = []
		let currentIndex = 0

		for (const chunk of chunks) {
			if (chunk.origIndex > lines.length) {
				throw new DiffError(`${path}: chunk.origIndex ${chunk.origIndex} > lines.length ${lines.length}`)
			}
			if (currentIndex > chunk.origIndex) {
				throw new DiffError(`${path}: currentIndex ${currentIndex} > chunk.origIndex ${chunk.origIndex}`)
			}

			// Copy lines before the chunk
			result.push(...lines.slice(currentIndex, chunk.origIndex))

			// Get the original lines being replaced to detect escaping style
			const originalLines = lines.slice(chunk.origIndex, chunk.origIndex + chunk.delLines.length)
			const originalText = originalLines.join("\n")

			// Add inserted lines, preserving escaping style from original
			const insertedLines = chunk.insLines.map((line) => {
				// Only preserve escaping if we have original text to compare against
				if (originalText) {
					return preserveEscaping(originalText, line)
				}
				return line
			})
			result.push(...insertedLines)

			// Skip deleted lines
			currentIndex = chunk.origIndex + chunk.delLines.length
		}

		// Copy remaining lines
		result.push(...lines.slice(currentIndex))
		const joined = result.join("\n")

		return endsWithNewline && !joined.endsWith("\n") ? `${joined}\n` : joined
	}

	private async applyCommit(commit: Commit): Promise<Record<string, FileOpsResult>> {
		const ops = this.providerOps!
		const results: Record<string, FileOpsResult> = {}

		for (const [path, change] of Object.entries(commit.changes)) {
			switch (change.type) {
				case PatchActionType.DELETE:
					await ops.deleteFile(path)
					results[path] = { deleted: true }
					break
				case PatchActionType.ADD:
					if (!change.newContent) {
						throw new DiffError(`Cannot create ${path} with no content`)
					}
					const addResult = await ops.createFile(path, change.newContent)
					results[path] = {
						finalContent: addResult.finalContent,
						newProblemsMessage: addResult.newProblemsMessage,
						userEdits: addResult.userEdits,
						autoFormattingEdits: addResult.autoFormattingEdits,
					}
					break
				case PatchActionType.UPDATE:
					if (!change.newContent) {
						throw new DiffError(`UPDATE change for ${path} has no new content`)
					}
					if (change.movePath) {
						const moveResult = await ops.moveFile(path, change.movePath, change.newContent)
						results[change.movePath] = {
							finalContent: moveResult.finalContent,
							newProblemsMessage: moveResult.newProblemsMessage,
							userEdits: moveResult.userEdits,
							autoFormattingEdits: moveResult.autoFormattingEdits,
						}
						results[path] = { deleted: true }
					} else {
						const updateResult = await ops.modifyFile(path, change.newContent)
						results[path] = {
							finalContent: updateResult.finalContent,
							newProblemsMessage: updateResult.newProblemsMessage,
							userEdits: updateResult.userEdits,
							autoFormattingEdits: updateResult.autoFormattingEdits,
						}
					}
					break
			}
		}

		return results
	}

	private async revertChanges(): Promise<void> {
		if (!this.appliedCommit || !this.providerOps) {
			return
		}

		const ops = this.providerOps

		for (const [path, change] of Object.entries(this.appliedCommit.changes)) {
			try {
				switch (change.type) {
					case PatchActionType.DELETE:
						if (change.oldContent !== undefined) {
							await ops.createFile(path, change.oldContent)
						}
						break
					case PatchActionType.ADD:
						await ops.deleteFile(path)
						break
					case PatchActionType.UPDATE:
						if (change.movePath) {
							await ops.deleteFile(change.movePath)
							if (change.oldContent !== undefined) {
								await ops.createFile(path, change.oldContent)
							}
						} else if (change.oldContent !== undefined) {
							await ops.modifyFile(path, change.oldContent)
						}
						break
				}
			} catch (error) {
				console.error(`Failed to revert ${path}:`, error)
			}
		}

		this.appliedCommit = undefined
		this.config = undefined
	}

	private async generateChangeSummary(changes: Record<string, FileChange>): Promise<ClineSayTool[]> {
		const summaries = await Promise.all(
			Object.entries(changes).map(async ([file, change]) => {
				const operationIsLocatedInWorkspace = await isLocatedInWorkspace(file)
				switch (change.type) {
					case PatchActionType.ADD:
						return {
							tool: "newFileCreated",
							path: file,
							content: change.newContent,
							operationIsLocatedInWorkspace,
						} as ClineSayTool
					case PatchActionType.UPDATE:
						return {
							tool: change.movePath ? "newFileCreated" : "editedExistingFile",
							path: change.movePath || file,
							content: change.movePath ? change.oldContent : change.newContent,
							operationIsLocatedInWorkspace,
						} as ClineSayTool
					// case PatchActionType.DELETE:
					default:
						return {
							tool: "editedExistingFile",
							path: file,
							content: change.newContent,
							operationIsLocatedInWorkspace,
						} as ClineSayTool
				}
			}),
		)

		return summaries
	}

	private async handleApproval(config: TaskConfig, block: ToolUse, message: ClineSayTool, rawInput: string): Promise<boolean> {
		const patch = { ...message, content: rawInput }
		const messageStr = JSON.stringify(patch)
		const shouldAutoApprove = await config.callbacks.shouldAutoApproveToolWithPath(block.name, message.path)
		const modelId = config.api.getModel().id

		if (shouldAutoApprove) {
			await config.callbacks.say("tool", messageStr, undefined, undefined, false)
			telemetryService.captureToolUsage(config.ulid, this.name, modelId, true, true)
			return true
		}

		showNotificationForApproval(
			`Cline wants to edit this file: ${message.path}`,
			config.autoApprovalSettings.enableNotifications,
		)

		const { response, text, images, files } = await config.callbacks.ask("tool", messageStr, true)

		if (text || images?.length || files?.length) {
			const fileContent = files?.length ? await processFilesIntoText(files) : ""
			ToolResultUtils.pushAdditionalToolFeedback(config.taskState.userMessageContent, text, images, fileContent)
			await config.callbacks.say("user_feedback", text, images, files)
		}

		const approved = response === "yesButtonClicked"
		config.taskState.didRejectTool = !approved
		telemetryService.captureToolUsage(config.ulid, this.name, modelId, false, approved)

		return approved
	}
}
