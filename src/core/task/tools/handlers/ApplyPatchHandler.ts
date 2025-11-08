import { readFile } from "node:fs/promises"
import type { ToolUse } from "@core/assistant-message"
import { resolveWorkspacePath } from "@core/workspace"
import { processFilesIntoText } from "@integrations/misc/extract-text"
import { ClineSayTool } from "@shared/ExtensionMessage"
import { fileExistsAtPath } from "@utils/fs"
import { DiffViewProvider } from "@/integrations/editor/DiffViewProvider"
import { telemetryService } from "@/services/telemetry"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { ToolResultUtils } from "../utils/ToolResultUtils"

// Patch format constants
export const PATCH_MARKERS = {
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

// Domain types
export enum PatchActionType {
	ADD = "add",
	DELETE = "delete",
	UPDATE = "update",
}

interface FileChange {
	type: PatchActionType
	oldContent?: string
	newContent?: string
	movePath?: string
}

interface Commit {
	changes: Record<string, FileChange>
}

export interface PatchChunk {
	origIndex: number // line index in original file where change starts
	delLines: string[] // Lines to delete (without the "-" prefix)
	insLines: string[] // Lines to insert (without the "+" prefix)
}

export interface PatchAction {
	type: PatchActionType
	newFile?: string
	chunks: PatchChunk[]
	movePath?: string
}

export interface Patch {
	actions: Record<string, PatchAction>
}

class DiffError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "DiffError"
	}
}

export class ApplyPatchHandler implements IFullyManagedTool {
	readonly name = ClineDefaultTool.APPLY_PATCH
	private appliedCommit?: Commit
	private config?: TaskConfig
	private pathResolver?: PathResolver
	private providerOps?: ProviderOperations
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
			this.providerOps = new ProviderOperations(config.services.diffViewProvider)
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
			config.callbacks.say("diff_editing", rawInput, undefined, undefined, true)
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
			} else if (line.startsWith(PATCH_MARKERS.UPDATE)) {
				targetPath = line.substring(PATCH_MARKERS.UPDATE.length).trim()
				actionType = PatchActionType.UPDATE
				contentStartIndex = i + 1
				break
			} else if (line.startsWith(PATCH_MARKERS.DELETE)) {
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

		const originalContent = provider.originalContent
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

		config.callbacks.say("diff_editing", rawInput, undefined, undefined, true)
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
				const approved = await this.handleApproval(config, block, message, changedFiles[0] || "")
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

			// Build response with file contents
			const responseLines = ["Successfully applied patch to the following files:"]
			for (const [path, result] of Object.entries(applyResults)) {
				if (result.deleted) {
					responseLines.push(`\n${path}: [deleted]`)
				} else if (result.finalContent !== undefined) {
					responseLines.push(`\n${path}:\n${result.finalContent}`)
				}
			}

			if (fuzz > 0) {
				responseLines.push(`\nNote: Patch applied with fuzz factor ${fuzz}`)
			}

			return responseLines.join("\n")
		} catch (error) {
			console.error("Error applying patch:", error)
			await provider.revertChanges()
			await provider.reset()
			throw error
		} finally {
			config.callbacks.say("diff_editing", rawInput, undefined, undefined, false)
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

		throw new DiffError("Invalid patch text - incomplete sentinels")
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

			// Add inserted lines
			result.push(...chunk.insLines)

			// Skip deleted lines
			currentIndex = chunk.origIndex + chunk.delLines.length
		}

		// Copy remaining lines
		result.push(...lines.slice(currentIndex))
		const joined = result.join("\n")

		return endsWithNewline && !joined.endsWith("\n") ? joined + "\n" : joined
	}

	private async applyCommit(commit: Commit): Promise<Record<string, { finalContent?: string; deleted?: boolean }>> {
		const ops = this.providerOps!
		const results: Record<string, { finalContent?: string; deleted?: boolean }> = {}

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
					results[path] = { finalContent: addResult.finalContent }
					break
				case PatchActionType.UPDATE:
					if (!change.newContent) {
						throw new DiffError(`UPDATE change for ${path} has no new content`)
					}
					if (change.movePath) {
						const moveResult = await ops.moveFile(path, change.movePath, change.newContent)
						results[change.movePath] = { finalContent: moveResult.finalContent }
						results[path] = { deleted: true }
					} else {
						const updateResult = await ops.modifyFile(path, change.newContent)
						results[path] = { finalContent: updateResult.finalContent }
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
				const operationIsLocatedInWorkspace = await import("@utils/path").then((m) => m.isLocatedInWorkspace(file))
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
					case PatchActionType.DELETE:
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
			telemetryService.captureToolUsage(config.ulid, block.name, config.api.getModel().id, true, true)
			return true
		}

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

// Helper class for path operations
class PathResolver {
	constructor(
		private config: TaskConfig,
		private validator: ToolValidator,
	) {}

	resolve(filePath: string, caller: string): { absolutePath: string; resolvedPath: string } | undefined {
		try {
			const pathResult = resolveWorkspacePath(this.config, filePath, caller)
			return typeof pathResult === "string"
				? { absolutePath: pathResult, resolvedPath: filePath }
				: { absolutePath: pathResult.absolutePath, resolvedPath: pathResult.resolvedPath }
		} catch {
			return undefined
		}
	}

	validate(resolvedPath: string): { ok: boolean; error?: string } {
		return this.validator.checkClineIgnorePath(resolvedPath)
	}

	async resolveAndValidate(
		filePath: string,
		caller: string,
	): Promise<{ absolutePath: string; resolvedPath: string } | undefined> {
		const resolution = this.resolve(filePath, caller)
		if (!resolution) {
			return undefined
		}

		const validation = this.validate(resolution.resolvedPath)
		if (!validation.ok) {
			return undefined
		}

		return resolution
	}
}

// Helper class for provider operations
class ProviderOperations {
	constructor(private provider: DiffViewProvider) {}

	async createFile(path: string, content: string): Promise<{ finalContent?: string }> {
		this.provider.editType = "create"
		await this.provider.open(path)
		await this.provider.update(content, true)
		const result = await this.provider.saveChanges()
		await this.provider.reset()
		return result
	}

	async modifyFile(path: string, content: string): Promise<{ finalContent?: string }> {
		this.provider.editType = "modify"
		await this.provider.open(path)
		await this.provider.update(content, true)
		const result = await this.provider.saveChanges()
		await this.provider.reset()
		return result
	}

	async deleteFile(path: string): Promise<void> {
		this.provider.editType = "modify"
		await this.provider.open(path)
		await this.provider.revertChanges()
	}

	async moveFile(oldPath: string, newPath: string, content: string): Promise<{ finalContent?: string }> {
		const result = await this.createFile(newPath, content)
		await this.deleteFile(oldPath)
		return result
	}
}

/**
 * Unicode punctuation normalisation helpers
 * Makes patch matching resilient to visually identical but different Unicode code-points
 */
const PUNCT_EQUIV: Record<string, string> = {
	// Hyphen / dash variants
	"-": "-",
	"\u2010": "-", // HYPHEN
	"\u2011": "-", // NO-BREAK HYPHEN
	"\u2012": "-", // FIGURE DASH
	"\u2013": "-", // EN DASH
	"\u2014": "-", // EM DASH
	"\u2212": "-", // MINUS SIGN
	// Double quotes
	"\u0022": '"', // QUOTATION MARK
	"\u201C": '"', // LEFT DOUBLE QUOTATION MARK
	"\u201D": '"', // RIGHT DOUBLE QUOTATION MARK
	"\u201E": '"', // DOUBLE LOW-9 QUOTATION MARK
	"\u00AB": '"', // LEFT-POINTING DOUBLE ANGLE QUOTATION MARK
	"\u00BB": '"', // RIGHT-POINTING DOUBLE ANGLE QUOTATION MARK
	// Single quotes
	"\u0027": "'", // APOSTROPHE
	"\u2018": "'", // LEFT SINGLE QUOTATION MARK
	"\u2019": "'", // RIGHT SINGLE QUOTATION MARK
	"\u201B": "'", // SINGLE HIGH-REVERSED-9 QUOTATION MARK
	// Spaces
	"\u00A0": " ", // NO-BREAK SPACE
	"\u202F": " ", // NARROW NO-BREAK SPACE
}

function canonicalize(s: string): string {
	return s.normalize("NFC").replace(/./gu, (c) => PUNCT_EQUIV[c] ?? c)
}

/**
 * Find context in file with fuzzy matching (whitespace tolerance)
 * Returns [index, fuzz] where fuzz indicates match quality
 */
function findContext(lines: string[], context: string[], start: number, eof: boolean): [number, number] {
	if (context.length === 0) {
		return [start, 0]
	}

	const findCore = (startIdx: number): [number, number] => {
		// Pass 1: exact equality after canonicalization
		const canonicalContext = canonicalize(context.join("\n"))
		for (let i = startIdx; i < lines.length; i++) {
			const segment = canonicalize(lines.slice(i, i + context.length).join("\n"))
			if (segment === canonicalContext) {
				return [i, 0]
			}
		}

		// Pass 2: ignore trailing whitespace
		for (let i = startIdx; i < lines.length; i++) {
			const segment = canonicalize(
				lines
					.slice(i, i + context.length)
					.map((s) => s.trimEnd())
					.join("\n"),
			)
			const ctx = canonicalize(context.map((s) => s.trimEnd()).join("\n"))
			if (segment === ctx) {
				return [i, 1]
			}
		}

		// Pass 3: ignore all surrounding whitespace
		for (let i = startIdx; i < lines.length; i++) {
			const segment = canonicalize(
				lines
					.slice(i, i + context.length)
					.map((s) => s.trim())
					.join("\n"),
			)
			const ctx = canonicalize(context.map((s) => s.trim()).join("\n"))
			if (segment === ctx) {
				return [i, 100]
			}
		}

		return [-1, 0]
	}

	if (eof) {
		// Try from end first for EOF context
		let [newIndex, fuzz] = findCore(lines.length - context.length)
		if (newIndex !== -1) {
			return [newIndex, fuzz]
		}
		;[newIndex, fuzz] = findCore(start)
		return [newIndex, fuzz + 10000]
	}

	return findCore(start)
}

/**
 * Peek ahead to extract the next section's context and chunks
 * Returns [context, chunks, endIndex, isEOF]
 */
function peekNextSection(lines: string[], initialIndex: number): [string[], PatchChunk[], number, boolean] {
	let index = initialIndex
	const old: string[] = []
	let delLines: string[] = []
	let insLines: string[] = []
	const chunks: PatchChunk[] = []
	let mode: "keep" | "add" | "delete" = "keep"

	const stopMarkers = [
		"@@",
		PATCH_MARKERS.END,
		PATCH_MARKERS.UPDATE,
		PATCH_MARKERS.DELETE,
		PATCH_MARKERS.ADD,
		PATCH_MARKERS.END_FILE,
	]

	while (index < lines.length) {
		const s = lines[index]!
		if (stopMarkers.some((m) => s.startsWith(m.trim()))) {
			break
		}
		if (s === "***") {
			break
		}
		if (s.startsWith("***")) {
			throw new DiffError(`Invalid line: ${s}`)
		}

		index++
		const lastMode: "keep" | "add" | "delete" = mode
		let line = s

		if (line[0] === "+") {
			mode = "add"
		} else if (line[0] === "-") {
			mode = "delete"
		} else if (line[0] === " ") {
			mode = "keep"
		} else {
			// Tolerate missing leading whitespace for context lines
			mode = "keep"
			line = " " + line
		}

		line = line.slice(1)

		if (mode === "keep" && lastMode !== mode) {
			if (insLines.length || delLines.length) {
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
		} else {
			old.push(line)
		}
	}

	if (insLines.length || delLines.length) {
		chunks.push({
			origIndex: old.length - delLines.length,
			delLines: delLines,
			insLines: insLines,
		})
	}

	if (index < lines.length && lines[index] === PATCH_MARKERS.END_FILE) {
		index++
		return [old, chunks, index, true]
	}

	return [old, chunks, index, false]
}

/**
 * Main patch parser
 */
class PatchParser {
	private patch: Patch = { actions: {} }
	private index = 0
	private fuzz = 0

	constructor(
		private lines: string[],
		private currentFiles: Record<string, string>,
	) {}

	parse(): { patch: Patch; fuzz: number } {
		this.skipBeginSentinel()

		while (this.hasMoreLines() && !this.isEndMarker()) {
			this.parseNextAction()
		}

		return { patch: this.patch, fuzz: this.fuzz }
	}

	private skipBeginSentinel(): void {
		if (this.lines[this.index]?.startsWith(PATCH_MARKERS.BEGIN)) {
			this.index++
		}
	}

	private hasMoreLines(): boolean {
		return this.index < this.lines.length
	}

	private isEndMarker(): boolean {
		return this.lines[this.index]?.startsWith(PATCH_MARKERS.END) ?? false
	}

	private parseNextAction(): void {
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

	private checkDuplicate(path: string, operation: string): void {
		if (path in this.patch.actions) {
			throw new DiffError(`Duplicate ${operation} for file: ${path}`)
		}
	}

	private parseUpdate(path: string): void {
		this.checkDuplicate(path, "update")

		this.index++
		const movePath = this.lines[this.index]?.startsWith(PATCH_MARKERS.MOVE)
			? this.lines[this.index++].substring(PATCH_MARKERS.MOVE.length).trim()
			: undefined

		if (!(path in this.currentFiles)) {
			throw new DiffError(`Update File Error: Missing File: ${path}`)
		}

		const text = this.currentFiles[path]!
		const action = this.parseUpdateFile(text, path)
		action.movePath = movePath

		this.patch.actions[path] = action
	}

	private parseUpdateFile(text: string, _path: string): PatchAction {
		const action: PatchAction = { type: PatchActionType.UPDATE, chunks: [] }
		const fileLines = text.split("\n")
		let index = 0

		const stopMarkers = [
			PATCH_MARKERS.END,
			PATCH_MARKERS.UPDATE,
			PATCH_MARKERS.DELETE,
			PATCH_MARKERS.ADD,
			PATCH_MARKERS.END_FILE,
		]

		while (!stopMarkers.some((m) => this.lines[this.index]?.startsWith(m.trim()))) {
			const defStr = this.lines[this.index]?.startsWith("@@ ") ? this.lines[this.index]!.substring(3) : undefined
			const sectionStr = this.lines[this.index] === "@@" ? this.lines[this.index] : undefined

			if (defStr !== undefined || sectionStr !== undefined) {
				this.index++
			} else if (index !== 0) {
				throw new DiffError(`Invalid Line:\n${this.lines[this.index]}`)
			}

			// Try to find the @@ context marker in the file
			if (defStr?.trim()) {
				const canonDefStr = canonicalize(defStr.trim())
				for (let i = index; i < fileLines.length; i++) {
					if (canonicalize(fileLines[i]!) === canonDefStr || canonicalize(fileLines[i]!.trim()) === canonDefStr) {
						index = i + 1
						if (canonicalize(fileLines[i]!.trim()) === canonDefStr && canonicalize(fileLines[i]!) !== canonDefStr) {
							this.fuzz++
						}
						break
					}
				}
			}

			const [nextChunkContext, chunks, endPatchIndex, eof] = peekNextSection(this.lines, this.index)
			const [newIndex, fuzz] = findContext(fileLines, nextChunkContext, index, eof)

			if (newIndex === -1) {
				const ctxText = nextChunkContext.join("\n")
				throw new DiffError(`Invalid ${eof ? "EOF " : ""}Context ${index}:\n${ctxText}`)
			}

			this.fuzz += fuzz

			for (const chunk of chunks) {
				chunk.origIndex += newIndex
				action.chunks.push(chunk)
			}

			index = newIndex + nextChunkContext.length
			this.index = endPatchIndex
		}

		return action
	}

	private parseDelete(path: string): void {
		this.checkDuplicate(path, "delete")

		if (!(path in this.currentFiles)) {
			throw new DiffError(`Delete File Error: Missing File: ${path}`)
		}

		this.patch.actions[path] = { type: PatchActionType.DELETE, chunks: [] }
		this.index++
	}

	private parseAdd(path: string): void {
		this.checkDuplicate(path, "add")

		if (path in this.currentFiles) {
			throw new DiffError(`Add File Error: File already exists: ${path}`)
		}

		this.index++
		const lines: string[] = []

		const stopMarkers = [PATCH_MARKERS.END, PATCH_MARKERS.UPDATE, PATCH_MARKERS.DELETE, PATCH_MARKERS.ADD]

		while (this.hasMoreLines() && !stopMarkers.some((m) => this.lines[this.index].startsWith(m.trim()))) {
			const line = this.lines[this.index++]
			if (!line.startsWith("+")) {
				throw new DiffError(`Invalid Add File line (missing '+'): ${line}`)
			}
			lines.push(line.substring(1))
		}

		this.patch.actions[path] = { type: PatchActionType.ADD, newFile: lines.join("\n"), chunks: [] }
	}
}
