import { canonicalize } from "@/shared/canonicalize"
import { DiffError, PATCH_MARKERS, type Patch, type PatchAction, PatchActionType, type PatchChunk } from "@/shared/Patch"

/**
 * Parser for Apply Patch content
 */
export class PatchParser {
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

			const [nextChunkContext, chunks, endPatchIndex, eof] = peek(this.lines, this.index)
			const [newIndex, fuzz] = findContext(fileLines, nextChunkContext, index, eof)

			if (newIndex === -1) {
				const ctxText = nextChunkContext.join("\n")
				throw new DiffError(`Invalid ${eof ? "EOF " : ""}Patch ${index}:\n${ctxText}`)
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
