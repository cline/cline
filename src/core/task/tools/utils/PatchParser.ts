import {
	DiffError,
	PATCH_MARKERS,
	type Patch,
	type PatchAction,
	PatchActionType,
	type PatchChunk,
	type PatchWarning,
} from "@/shared/Patch"
import { canonicalize } from "@/shared/string"

/**
 * Parser for Apply Patch content
 */
export class PatchParser {
	private patch: Patch = { actions: {}, warnings: [] }
	private index = 0
	private fuzz = 0
	private currentPath?: string

	constructor(
		private lines: string[],
		private currentFiles: Record<string, string>,
	) {}

	parse(): { patch: Patch; fuzz: number } {
		this.skipBeginSentinel()

		while (this.hasMoreLines() && !this.isEndMarker()) {
			this.parseNextAction()
		}

		// Clean up empty warnings array
		if (this.patch.warnings?.length === 0) {
			delete this.patch.warnings
		}

		return { patch: this.patch, fuzz: this.fuzz }
	}

	private addWarning(warning: PatchWarning): void {
		if (!this.patch.warnings) {
			this.patch.warnings = []
		}
		this.patch.warnings.push(warning)
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
		this.currentPath = path

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
		this.currentPath = undefined
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

			const [nextChunkContext, chunks, endPatchIndex, eof] = peek(this.lines, this.index)
			const [newIndex, fuzz, similarity] = findContext(fileLines, nextChunkContext, index, eof)

			if (newIndex === -1) {
				const ctxText = nextChunkContext.join("\n")
				// Add warning but continue - skip this chunk
				this.addWarning({
					path: this.currentPath || _path,
					chunkIndex: action.chunks.length,
					message: `Could not find matching context (similarity: ${similarity.toFixed(2)}). Chunk skipped.`,
					context: ctxText.length > 200 ? `${ctxText.substring(0, 200)}...` : ctxText,
				})
				// Move patch index forward to skip this chunk, but keep file position
				// so subsequent chunks can still be found
				this.index = endPatchIndex
				// Don't advance file position - let next chunk search from current position
			} else {
				this.fuzz += fuzz

				for (const chunk of chunks) {
					chunk.origIndex += newIndex
					action.chunks.push(chunk)
				}

				index = newIndex + nextChunkContext.length
				this.index = endPatchIndex
			}
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

/**
 * Calculate similarity between two strings (0-1 range)
 */
function calculateSimilarity(str1: string, str2: string): number {
	const longer = str1.length > str2.length ? str1 : str2
	const shorter = str1.length > str2.length ? str2 : str1
	if (longer.length === 0) {
		return 1.0
	}

	const editDistance = levenshteinDistance(shorter, longer)
	return (longer.length - editDistance) / longer.length
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(str1: string, str2: string): number {
	const matrix: number[][] = []

	for (let i = 0; i <= str2.length; i++) {
		matrix[i] = [i]
	}

	for (let j = 0; j <= str1.length; j++) {
		matrix[0]![j] = j
	}

	for (let i = 1; i <= str2.length; i++) {
		for (let j = 1; j <= str1.length; j++) {
			if (str2[i - 1] === str1[j - 1]) {
				matrix[i]![j] = matrix[i - 1]![j - 1]!
			} else {
				matrix[i]![j] = Math.min(
					matrix[i - 1]![j - 1]! + 1, // substitution
					matrix[i]![j - 1]! + 1, // insertion
					matrix[i - 1]![j]! + 1, // deletion
				)
			}
		}
	}

	return matrix[str2.length]![str1.length]!
}

/**
 * Find context in file with fuzzy matching (whitespace tolerance)
 * Returns [index, fuzz, similarity] where fuzz indicates match quality and similarity is best match score
 */
function findContext(lines: string[], context: string[], start: number, eof: boolean): [number, number, number] {
	if (context.length === 0) {
		return [start, 0, 1.0]
	}

	let bestSimilarity = 0

	const findCore = (startIdx: number): [number, number, number] => {
		// Pass 1: exact equality after canonicalization
		const canonicalContext = canonicalize(context.join("\n"))
		for (let i = startIdx; i < lines.length; i++) {
			const segment = canonicalize(lines.slice(i, i + context.length).join("\n"))
			if (segment === canonicalContext) {
				return [i, 0, 1.0]
			}
			// Track best similarity for reporting
			const similarity = calculateSimilarity(segment, canonicalContext)
			if (similarity > bestSimilarity) {
				bestSimilarity = similarity
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
				return [i, 1, 1.0]
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
				return [i, 100, 1.0]
			}
		}

		// Pass 4: Partial matching with similarity threshold (66% match = 2/3 lines)
		const SIMILARITY_THRESHOLD = 0.66
		for (let i = startIdx; i < lines.length; i++) {
			const segment = canonicalize(lines.slice(i, i + context.length).join("\n"))
			const similarity = calculateSimilarity(segment, canonicalContext)
			if (similarity >= SIMILARITY_THRESHOLD) {
				return [i, 1000, similarity]
			}
			if (similarity > bestSimilarity) {
				bestSimilarity = similarity
			}
		}

		return [-1, 0, bestSimilarity]
	}

	if (eof) {
		// Try from end first for EOF context
		let [newIndex, fuzz, similarity] = findCore(lines.length - context.length)
		if (newIndex !== -1) {
			return [newIndex, fuzz, similarity]
		}
		;[newIndex, fuzz, similarity] = findCore(start)
		return [newIndex, fuzz + 10000, similarity]
	}

	return findCore(start)
}

type PeekResult = [string[], PatchChunk[], number, boolean]

/**
 * Peek ahead to extract the next section's context and chunks
 * Returns [context, chunks, endIndex, isEOF]
 */
function peek(lines: string[], initialIndex: number): PeekResult {
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
			line = ` ${line}`
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
