/**
 * Apply Patch Executor
 *
 * Built-in implementation for the legacy apply_patch format.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ToolContext } from "@clinebot/agents";
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

function stripBashWrapper(lines: string[]): string[] {
	const result: string[] = [];
	let insidePatch = false;
	let foundBegin = false;
	let foundContent = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (
			!insidePatch &&
			BASH_WRAPPERS.some((wrapper) => line.startsWith(wrapper))
		) {
			continue;
		}

		if (line.startsWith(PATCH_MARKERS.BEGIN)) {
			insidePatch = true;
			foundBegin = true;
			result.push(line);
			continue;
		}

		if (line === PATCH_MARKERS.END) {
			insidePatch = false;
			result.push(line);
			continue;
		}

		const isPatchContent =
			line.startsWith(PATCH_MARKERS.ADD) ||
			line.startsWith(PATCH_MARKERS.UPDATE) ||
			line.startsWith(PATCH_MARKERS.DELETE) ||
			line.startsWith(PATCH_MARKERS.MOVE) ||
			line.startsWith(PATCH_MARKERS.SECTION) ||
			line.startsWith("+") ||
			line.startsWith("-") ||
			line.startsWith(" ") ||
			line === "***";

		if (isPatchContent && i !== lines.length - 1) {
			foundContent = true;
		}

		if (
			insidePatch ||
			(!foundBegin && isPatchContent) ||
			(line === "" && foundContent)
		) {
			result.push(line);
		}
	}

	while (result.length > 0 && result[result.length - 1] === "") {
		result.pop();
	}

	return !foundBegin && !foundContent ? lines : result;
}

function preprocessLines(input: string): string[] {
	let lines = input.split("\n").map((line) => line.replace(/\r$/, ""));
	lines = stripBashWrapper(lines);

	const hasBegin = lines.length > 0 && lines[0].startsWith(PATCH_MARKERS.BEGIN);
	const hasEnd =
		lines.length > 0 && lines[lines.length - 1] === PATCH_MARKERS.END;
	if (!hasBegin && !hasEnd) {
		return [PATCH_MARKERS.BEGIN, ...lines, PATCH_MARKERS.END];
	}
	if (hasBegin && hasEnd) {
		return lines;
	}
	throw new DiffError(
		"Invalid patch text - incomplete sentinels. Try breaking it into smaller patches.",
	);
}

function extractFilesForOperations(
	text: string,
	markers: readonly string[],
): string[] {
	const lines = stripBashWrapper(text.split("\n"));
	const files: string[] = [];

	for (const line of lines) {
		for (const marker of markers) {
			if (!line.startsWith(marker)) {
				continue;
			}
			const file = line.substring(marker.length).trim();
			if (!text.trim().endsWith(file)) {
				files.push(file);
			}
			break;
		}
	}

	return files;
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
	rawInput: string,
	cwd: string,
	encoding: BufferEncoding,
	restrictToCwd: boolean,
): Promise<Record<string, string>> {
	const filesToLoad = extractFilesForOperations(rawInput, [
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
		_context: ToolContext,
	): Promise<string> => {
		const lines = preprocessLines(input.input);
		const currentFiles = await loadFiles(
			input.input,
			cwd,
			encoding,
			restrictToCwd,
		);
		const parser = new PatchParser(lines, currentFiles);
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
