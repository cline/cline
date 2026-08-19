/**
 * Apply Patch parser and patch model types.
 *
 * This parser supports the Cline apply_patch format used by the legacy runtime.
 */

export const PATCH_MARKERS = {
	BEGIN: "*** Begin Patch",
	END: "*** End Patch",
	ADD: "*** Add File: ",
	UPDATE: "*** Update File: ",
	DELETE: "*** Delete File: ",
	MOVE: "*** Move to: ",
	SECTION: "@@",
	END_FILE: "*** End of File",
} as const;

export const BASH_WRAPPERS = ["%%bash", "apply_patch", "EOF", "```"] as const;

export enum PatchActionType {
	ADD = "add",
	DELETE = "delete",
	UPDATE = "update",
}

export interface PatchChunk {
	origIndex: number;
	delLines: string[];
	insLines: string[];
}

export interface PatchAction {
	type: PatchActionType;
	newFile?: string;
	chunks: PatchChunk[];
	movePath?: string;
}

export interface PatchWarning {
	path: string;
	chunkIndex?: number;
	message: string;
	context?: string;
}

export interface Patch {
	actions: Record<string, PatchAction>;
	warnings?: PatchWarning[];
}

export class DiffError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "DiffError";
	}
}

function canonicalize(input: string): string {
	const punctuationMap: Record<string, string> = {
		"\u2010": "-",
		"\u2011": "-",
		"\u2012": "-",
		"\u2013": "-",
		"\u2014": "-",
		"\u2212": "-",
		"\u201C": '"',
		"\u201D": '"',
		"\u201E": '"',
		"\u00AB": '"',
		"\u00BB": '"',
		"\u2018": "'",
		"\u2019": "'",
		"\u201B": "'",
		"\u00A0": " ",
		"\u202F": " ",
	};
	return input
		.normalize("NFC")
		.replace(/./gu, (char) => punctuationMap[char] ?? char)
		.replace(/\\`/g, "`")
		.replace(/\\'/g, "'")
		.replace(/\\"/g, '"');
}

export class PatchParser {
	private patch: Patch = { actions: {}, warnings: [] };
	private index = 0;
	private fuzz = 0;
	private currentPath?: string;

	constructor(
		private readonly lines: string[],
		private readonly currentFiles: Record<string, string>,
	) {}

	parse(): { patch: Patch; fuzz: number } {
		this.skipBeginSentinel();

		while (this.hasMoreLines() && !this.isEndMarker()) {
			this.parseNextAction();
		}

		if (this.patch.warnings?.length === 0) {
			delete this.patch.warnings;
		}

		return { patch: this.patch, fuzz: this.fuzz };
	}

	private addWarning(warning: PatchWarning): void {
		if (!this.patch.warnings) {
			this.patch.warnings = [];
		}
		this.patch.warnings.push(warning);
	}

	private skipBeginSentinel(): void {
		if (this.lines[this.index]?.startsWith(PATCH_MARKERS.BEGIN)) {
			this.index++;
		}
	}

	private hasMoreLines(): boolean {
		return this.index < this.lines.length;
	}

	private isEndMarker(): boolean {
		return this.lines[this.index]?.startsWith(PATCH_MARKERS.END) ?? false;
	}

	private parseNextAction(): void {
		const line = this.lines[this.index];
		if (line?.startsWith(PATCH_MARKERS.UPDATE)) {
			this.parseUpdate(line.substring(PATCH_MARKERS.UPDATE.length).trim());
			return;
		}
		if (line?.startsWith(PATCH_MARKERS.DELETE)) {
			this.parseDelete(line.substring(PATCH_MARKERS.DELETE.length).trim());
			return;
		}
		if (line?.startsWith(PATCH_MARKERS.ADD)) {
			this.parseAdd(line.substring(PATCH_MARKERS.ADD.length).trim());
			return;
		}
		throw new DiffError(`Unknown line while parsing: ${line}`);
	}

	private checkDuplicate(path: string, operation: string): void {
		if (path in this.patch.actions) {
			throw new DiffError(`Duplicate ${operation} for file: ${path}`);
		}
	}

	private parseUpdate(path: string): void {
		this.checkDuplicate(path, "update");
		this.currentPath = path;

		this.index++;
		const movePath = this.lines[this.index]?.startsWith(PATCH_MARKERS.MOVE)
			? (this.lines[this.index++] ?? "")
					.substring(PATCH_MARKERS.MOVE.length)
					.trim()
			: undefined;

		if (!(path in this.currentFiles)) {
			throw new DiffError(`Update File Error: Missing File: ${path}`);
		}

		const text = this.currentFiles[path] ?? "";
		const action = this.parseUpdateFile(text, path);
		action.movePath = movePath;
		this.patch.actions[path] = action;
		this.currentPath = undefined;
	}

	private parseUpdateFile(text: string, path: string): PatchAction {
		const action: PatchAction = { type: PatchActionType.UPDATE, chunks: [] };
		const fileLines = text.split("\n");
		let index = 0;

		const stopMarkers = [
			PATCH_MARKERS.END,
			PATCH_MARKERS.UPDATE,
			PATCH_MARKERS.DELETE,
			PATCH_MARKERS.ADD,
			PATCH_MARKERS.END_FILE,
		];

		while (
			!stopMarkers.some((marker) =>
				this.lines[this.index]?.startsWith(marker.trim()),
			)
		) {
			const currentLine = this.lines[this.index];
			const defStr = currentLine?.startsWith("@@ ")
				? currentLine.substring(3)
				: undefined;
			const sectionStr = currentLine === "@@" ? currentLine : undefined;

			if (defStr !== undefined || sectionStr !== undefined) {
				this.index++;
			} else if (index !== 0) {
				throw new DiffError(`Invalid Line:\n${this.lines[this.index]}`);
			}

			if (defStr?.trim()) {
				const canonDefStr = canonicalize(defStr.trim());
				for (let i = index; i < fileLines.length; i++) {
					const fileLine = fileLines[i];
					if (
						fileLine &&
						(canonicalize(fileLine) === canonDefStr ||
							canonicalize(fileLine.trim()) === canonDefStr)
					) {
						index = i + 1;
						if (
							canonicalize(fileLine.trim()) === canonDefStr &&
							canonicalize(fileLine) !== canonDefStr
						) {
							this.fuzz++;
						}
						break;
					}
				}
			}

			const [nextChunkContext, chunks, endPatchIndex, eof] = peek(
				this.lines,
				this.index,
			);
			const [newIndex, fuzz, similarity] = findContext(
				fileLines,
				nextChunkContext,
				index,
				eof,
			);

			if (newIndex === -1) {
				const contextText = nextChunkContext.join("\n");
				this.addWarning({
					path: this.currentPath || path,
					chunkIndex: action.chunks.length,
					message: `Could not find matching context (similarity: ${similarity.toFixed(2)}). Chunk skipped.`,
					context:
						contextText.length > 200
							? `${contextText.substring(0, 200)}...`
							: contextText,
				});
				this.index = endPatchIndex;
			} else {
				this.fuzz += fuzz;
				for (const chunk of chunks) {
					chunk.origIndex += newIndex;
					action.chunks.push(chunk);
				}
				index = newIndex + nextChunkContext.length;
				this.index = endPatchIndex;
			}
		}

		return action;
	}

	private parseDelete(path: string): void {
		this.checkDuplicate(path, "delete");
		if (!(path in this.currentFiles)) {
			throw new DiffError(`Delete File Error: Missing File: ${path}`);
		}
		this.patch.actions[path] = { type: PatchActionType.DELETE, chunks: [] };
		this.index++;
	}

	private parseAdd(path: string): void {
		this.checkDuplicate(path, "add");
		if (path in this.currentFiles) {
			throw new DiffError(`Add File Error: File already exists: ${path}`);
		}

		this.index++;
		const lines: string[] = [];
		const stopMarkers = [
			PATCH_MARKERS.END,
			PATCH_MARKERS.UPDATE,
			PATCH_MARKERS.DELETE,
			PATCH_MARKERS.ADD,
		];

		while (
			this.hasMoreLines() &&
			!stopMarkers.some((marker) =>
				this.lines[this.index]?.startsWith(marker.trim()),
			)
		) {
			const line = this.lines[this.index++];
			if (line === undefined) {
				break;
			}
			if (!line.startsWith("+")) {
				throw new DiffError(`Invalid Add File line (missing '+'): ${line}`);
			}
			lines.push(line.substring(1));
		}

		this.patch.actions[path] = {
			type: PatchActionType.ADD,
			newFile: lines.join("\n"),
			chunks: [],
		};
	}
}

function calculateSimilarity(str1: string, str2: string): number {
	const longer = str1.length > str2.length ? str1 : str2;
	const shorter = str1.length > str2.length ? str2 : str1;
	if (longer.length === 0) {
		return 1;
	}
	const editDistance = levenshteinDistance(shorter, longer);
	return (longer.length - editDistance) / longer.length;
}

function levenshteinDistance(str1: string, str2: string): number {
	const rows = str2.length + 1;
	const cols = str1.length + 1;
	const matrix = new Array<number>(rows * cols).fill(0);
	const at = (r: number, c: number): number => matrix[r * cols + c] ?? 0;
	const set = (r: number, c: number, value: number): void => {
		matrix[r * cols + c] = value;
	};

	for (let i = 0; i <= str2.length; i++) set(i, 0, i);
	for (let j = 0; j <= str1.length; j++) set(0, j, j);

	for (let i = 1; i <= str2.length; i++) {
		for (let j = 1; j <= str1.length; j++) {
			if (str2[i - 1] === str1[j - 1]) {
				set(i, j, at(i - 1, j - 1));
			} else {
				set(i, j, 1 + Math.min(at(i - 1, j - 1), at(i, j - 1), at(i - 1, j)));
			}
		}
	}

	return at(str2.length, str1.length);
}

function findContext(
	lines: string[],
	context: string[],
	start: number,
	eof: boolean,
): [number, number, number] {
	if (context.length === 0) {
		return [start, 0, 1];
	}

	let bestSimilarity = 0;
	const findCore = (startIdx: number): [number, number, number] => {
		const canonicalContext = canonicalize(context.join("\n"));

		for (let i = startIdx; i < lines.length; i++) {
			const segment = canonicalize(
				lines.slice(i, i + context.length).join("\n"),
			);
			if (segment === canonicalContext) {
				return [i, 0, 1];
			}
			const similarity = calculateSimilarity(segment, canonicalContext);
			if (similarity > bestSimilarity) {
				bestSimilarity = similarity;
			}
		}

		for (let i = startIdx; i < lines.length; i++) {
			const segment = canonicalize(
				lines
					.slice(i, i + context.length)
					.map((line) => line.trimEnd())
					.join("\n"),
			);
			const canonicalTrimmed = canonicalize(
				context.map((line) => line.trimEnd()).join("\n"),
			);
			if (segment === canonicalTrimmed) {
				return [i, 1, 1];
			}
		}

		for (let i = startIdx; i < lines.length; i++) {
			const segment = canonicalize(
				lines
					.slice(i, i + context.length)
					.map((line) => line.trim())
					.join("\n"),
			);
			const canonicalTrimmed = canonicalize(
				context.map((line) => line.trim()).join("\n"),
			);
			if (segment === canonicalTrimmed) {
				return [i, 100, 1];
			}
		}

		const similarityThreshold = 0.66;
		for (let i = startIdx; i < lines.length; i++) {
			const segment = canonicalize(
				lines.slice(i, i + context.length).join("\n"),
			);
			const similarity = calculateSimilarity(segment, canonicalContext);
			if (similarity >= similarityThreshold) {
				return [i, 1000, similarity];
			}
			if (similarity > bestSimilarity) {
				bestSimilarity = similarity;
			}
		}

		return [-1, 0, bestSimilarity];
	};

	if (eof) {
		let [newIndex, fuzz, similarity] = findCore(lines.length - context.length);
		if (newIndex !== -1) {
			return [newIndex, fuzz, similarity];
		}
		[newIndex, fuzz, similarity] = findCore(start);
		return [newIndex, fuzz + 10000, similarity];
	}

	return findCore(start);
}

type PeekResult = [string[], PatchChunk[], number, boolean];

function peek(lines: string[], initialIndex: number): PeekResult {
	let index = initialIndex;
	const old: string[] = [];
	let delLines: string[] = [];
	let insLines: string[] = [];
	const chunks: PatchChunk[] = [];
	let mode: "keep" | "add" | "delete" = "keep";

	const stopMarkers = [
		"@@",
		PATCH_MARKERS.END,
		PATCH_MARKERS.UPDATE,
		PATCH_MARKERS.DELETE,
		PATCH_MARKERS.ADD,
		PATCH_MARKERS.END_FILE,
	];

	while (index < lines.length) {
		const sourceLine = lines[index];
		if (
			!sourceLine ||
			stopMarkers.some((marker) => sourceLine.startsWith(marker.trim()))
		) {
			break;
		}
		if (sourceLine === "***") {
			break;
		}
		if (sourceLine.startsWith("***")) {
			throw new DiffError(`Invalid line: ${sourceLine}`);
		}

		index++;
		const previousMode: "keep" | "add" | "delete" = mode;
		let line = sourceLine;

		if (line[0] === "+") {
			mode = "add";
		} else if (line[0] === "-") {
			mode = "delete";
		} else if (line[0] === " ") {
			mode = "keep";
		} else {
			mode = "keep";
			line = ` ${line}`;
		}

		line = line.slice(1);

		if (mode === "keep" && previousMode !== mode) {
			if (insLines.length || delLines.length) {
				chunks.push({
					origIndex: old.length - delLines.length,
					delLines,
					insLines,
				});
			}
			delLines = [];
			insLines = [];
		}

		if (mode === "delete") {
			delLines.push(line);
			old.push(line);
		} else if (mode === "add") {
			insLines.push(line);
		} else {
			old.push(line);
		}
	}

	if (insLines.length || delLines.length) {
		chunks.push({
			origIndex: old.length - delLines.length,
			delLines,
			insLines,
		});
	}

	if (index < lines.length && lines[index] === PATCH_MARKERS.END_FILE) {
		index++;
		return [old, chunks, index, true];
	}

	return [old, chunks, index, false];
}
