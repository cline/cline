/**
 * Apply Patch Executor
 *
 * Built-in implementation for the documented GPT-5 apply_patch grammar.
 * It accepts the freeform patch body directly and tolerates the legacy shell
 * wrapper form used by older prompts.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AgentToolContext } from "@cline/shared";
import type { ApplyPatchInput } from "../schemas";
import type { ApplyPatchExecutor } from "../types";
import {
	BASH_WRAPPERS,
	DiffError,
	PATCH_MARKERS,
	PatchActionType,
	type PatchChunk,
	PatchParser,
} from "./apply-patch-parser";

interface FileChange {
	type: PatchActionType;
	oldContent?: string;
	newContent?: string;
	movePath?: string;
}

interface NormalizedPatchInput {
	lines: string[];
}

/**
 * Options for the apply_patch executor
 */
export interface ApplyPatchExecutorOptions {
	/**
	 * File encoding used for read/write operations
	 * @default "utf-8"
	 */
	encoding?: BufferEncoding;

	/**
	 * Restrict relative-path file operations to paths inside cwd.
	 * Absolute paths are always accepted as-is.
	 * @default true
	 */
	restrictToCwd?: boolean;
}

function resolveFilePath(
	cwd: string,
	inputPath: string,
	restrictToCwd: boolean,
): string {
	const isAbsoluteInput = path.isAbsolute(inputPath);
	const resolved = isAbsoluteInput
		? path.normalize(inputPath)
		: path.resolve(cwd, inputPath);
	if (!restrictToCwd || isAbsoluteInput) {
		return resolved;
	}

	const rel = path.relative(cwd, resolved);
	if (rel.startsWith("..") || path.isAbsolute(rel)) {
		throw new DiffError(`Path must stay within cwd: ${inputPath}`);
	}
	return resolved;
}

function normalizeLineEndings(input: string): string[] {
	return input.split("\n").map((line) => line.replace(/\r$/, ""));
}

function isWrapperLine(line: string): boolean {
	if (line.trim() === "") {
		return false;
	}
	return BASH_WRAPPERS.some((wrapper) => line.startsWith(wrapper));
}

function trimWrapperLines(lines: string[]): string[] {
	let start = 0;
	let end = lines.length;

	while (start < end && isWrapperLine(lines[start] ?? "")) {
		start++;
	}

	while (end > start && isWrapperLine(lines[end - 1] ?? "")) {
		end--;
	}

	return lines.slice(start, end);
}

function normalizePatchInput(input: string): NormalizedPatchInput {
	const rawLines = normalizeLineEndings(input);
	const beginIndex = rawLines.findIndex((line) =>
		line.startsWith(PATCH_MARKERS.BEGIN),
	);
	let endIndex = -1;
	for (let i = rawLines.length - 1; i >= 0; i--) {
		if (rawLines[i]?.startsWith(PATCH_MARKERS.END)) {
			endIndex = i;
			break;
		}
	}

	if (beginIndex !== -1 || endIndex !== -1) {
		if (beginIndex === -1 || endIndex === -1 || endIndex < beginIndex) {
			throw new DiffError(
				"Invalid patch text - incomplete sentinels. Try breaking it into smaller patches.",
			);
		}
		const lines = rawLines.slice(beginIndex, endIndex + 1);
		return {
			lines,
		};
	}

	const stripped = trimWrapperLines(rawLines);
	while (stripped.length > 0 && stripped[0] === "") {
		stripped.shift();
	}
	while (stripped.length > 0 && stripped[stripped.length - 1] === "") {
		stripped.pop();
	}

	const lines = [PATCH_MARKERS.BEGIN, ...stripped, PATCH_MARKERS.END];
	return {
		lines,
	};
}

function extractFilesForOperations(
	lines: readonly string[],
	markers: readonly string[],
): string[] {
	const files = new Set<string>();

	for (const line of lines) {
		for (const marker of markers) {
			if (line.startsWith(marker)) {
				files.add(line.substring(marker.length).trim());
				break;
			}
		}
	}

	return [...files];
}

function applyChunks(
	content: string,
	chunks: PatchChunk[],
	filePath: string,
): string {
	if (chunks.length === 0) {
		return content;
	}

	const lines = content.split("\n");
	const result: string[] = [];
	let currentIndex = 0;

	for (const chunk of chunks) {
		if (chunk.origIndex > lines.length) {
			throw new DiffError(
				`${filePath}: chunk.origIndex ${chunk.origIndex} > lines.length ${lines.length}`,
			);
		}
		if (currentIndex > chunk.origIndex) {
			throw new DiffError(
				`${filePath}: currentIndex ${currentIndex} > chunk.origIndex ${chunk.origIndex}`,
			);
		}
		result.push(...lines.slice(currentIndex, chunk.origIndex));
		result.push(...chunk.insLines);
		currentIndex = chunk.origIndex + chunk.delLines.length;
	}

	result.push(...lines.slice(currentIndex));
	return result.join("\n");
}

async function loadFiles(
	lines: readonly string[],
	cwd: string,
	encoding: BufferEncoding,
	restrictToCwd: boolean,
): Promise<Record<string, string>> {
	const filesToLoad = extractFilesForOperations(lines, [
		PATCH_MARKERS.UPDATE,
		PATCH_MARKERS.DELETE,
	]);
	const files: Record<string, string> = {};

	for (const filePath of filesToLoad) {
		const absolutePath = resolveFilePath(cwd, filePath, restrictToCwd);
		let fileContent: string;
		try {
			fileContent = await fs.readFile(absolutePath, encoding);
		} catch {
			throw new DiffError(`File not found: ${filePath}`);
		}
		files[filePath] = fileContent.replace(/\r\n/g, "\n");
	}

	return files;
}

function patchToChanges(
	patch: ReturnType<PatchParser["parse"]>["patch"],
	originalFiles: Record<string, string>,
): Record<string, FileChange> {
	const changes: Record<string, FileChange> = {};

	for (const [filePath, action] of Object.entries(patch.actions)) {
		switch (action.type) {
			case PatchActionType.DELETE:
				changes[filePath] = {
					type: PatchActionType.DELETE,
					oldContent: originalFiles[filePath],
				};
				break;
			case PatchActionType.ADD:
				if (action.newFile === undefined) {
					throw new DiffError("ADD action without file content");
				}
				changes[filePath] = {
					type: PatchActionType.ADD,
					newContent: action.newFile,
				};
				break;
			case PatchActionType.UPDATE:
				changes[filePath] = {
					type: PatchActionType.UPDATE,
					oldContent: originalFiles[filePath],
					newContent: applyChunks(
						originalFiles[filePath] ?? "",
						action.chunks,
						filePath,
					),
					movePath: action.movePath,
				};
				break;
		}
	}

	return changes;
}

async function applyChanges(
	changes: Record<string, FileChange>,
	cwd: string,
	encoding: BufferEncoding,
	restrictToCwd: boolean,
): Promise<string[]> {
	const touched: string[] = [];

	for (const [filePath, change] of Object.entries(changes)) {
		const sourceAbsPath = resolveFilePath(cwd, filePath, restrictToCwd);
		switch (change.type) {
			case PatchActionType.DELETE:
				await fs.rm(sourceAbsPath, { force: true });
				touched.push(`${filePath}: [deleted]`);
				break;
			case PatchActionType.ADD:
				if (change.newContent === undefined) {
					throw new DiffError(`Cannot create ${filePath} with no content`);
				}
				await fs.mkdir(path.dirname(sourceAbsPath), { recursive: true });
				await fs.writeFile(sourceAbsPath, change.newContent, { encoding });
				touched.push(filePath);
				break;
			case PatchActionType.UPDATE: {
				if (change.newContent === undefined) {
					throw new DiffError(
						`UPDATE change for ${filePath} has no new content`,
					);
				}

				if (change.movePath) {
					const moveAbsPath = resolveFilePath(
						cwd,
						change.movePath,
						restrictToCwd,
					);
					await fs.mkdir(path.dirname(moveAbsPath), { recursive: true });
					await fs.writeFile(moveAbsPath, change.newContent, { encoding });
					await fs.rm(sourceAbsPath, { force: true });
					touched.push(`${filePath} -> ${change.movePath}`);
				} else {
					await fs.writeFile(sourceAbsPath, change.newContent, { encoding });
					touched.push(filePath);
				}
				break;
			}
		}
	}

	return touched;
}

/**
 * Create an apply_patch executor using Node.js fs module.
 */
export function createApplyPatchExecutor(
	options: ApplyPatchExecutorOptions = {},
): ApplyPatchExecutor {
	const { encoding = "utf-8", restrictToCwd = true } = options;

	return async (
		input: ApplyPatchInput,
		cwd: string,
		_context: AgentToolContext,
	): Promise<string> => {
		const normalizedInput = normalizePatchInput(input.input);
		const currentFiles = await loadFiles(
			normalizedInput.lines,
			cwd,
			encoding,
			restrictToCwd,
		);
		const parser = new PatchParser(normalizedInput.lines, currentFiles);
		const { patch, fuzz } = parser.parse();
		const changes = patchToChanges(patch, currentFiles);
		const touched = await applyChanges(changes, cwd, encoding, restrictToCwd);

		const responseLines = [
			"Successfully applied patch to the following files:",
		];
		for (const file of touched) {
			responseLines.push(file);
		}
		if (fuzz > 0) {
			responseLines.push(`Note: Patch applied with fuzz factor ${fuzz}`);
		}
		if (patch.warnings && patch.warnings.length > 0) {
			for (const warning of patch.warnings) {
				responseLines.push(`Warning (${warning.path}): ${warning.message}`);
			}
		}
		return responseLines.join("\n");
	};
}
