/**
 * Editor Executor
 *
 * Built-in implementation for filesystem editing operations.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ToolContext } from "@clinebot/shared";
import type { EditFileInput } from "../schemas";
import type { EditorExecutor } from "../types";

/**
 * Options for the editor executor
 */
export interface EditorExecutorOptions {
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

	/**
	 * Maximum number of diff lines in str_replace output
	 * @default 200
	 */
	maxDiffLines?: number;
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
	if (!restrictToCwd) {
		return resolved;
	}

	// Absolute paths are accepted directly; cwd restriction applies to relative inputs.
	if (isAbsoluteInput) {
		return resolved;
	}

	const rel = path.relative(cwd, resolved);
	if (rel.startsWith("..") || path.isAbsolute(rel)) {
		throw new Error(`Path must stay within cwd: ${inputPath}`);
	}
	return resolved;
}

function countOccurrences(content: string, needle: string): number {
	if (needle.length === 0) return 0;
	return content.split(needle).length - 1;
}

function createLineDiff(
	oldContent: string,
	newContent: string,
	maxLines: number,
): string {
	const oldLines = oldContent.split("\n");
	const newLines = newContent.split("\n");
	const max = Math.max(oldLines.length, newLines.length);
	const out: string[] = ["```diff"];
	let emitted = 0;

	for (let i = 0; i < max; i++) {
		if (emitted >= maxLines) {
			out.push("... diff truncated ...");
			break;
		}

		const oldLine = oldLines[i];
		const newLine = newLines[i];

		if (oldLine === newLine) {
			continue;
		}

		const lineNo = i + 1;
		if (oldLine !== undefined) {
			out.push(`-${lineNo}: ${oldLine}`);
			emitted++;
		}
		if (newLine !== undefined && emitted < maxLines) {
			out.push(`+${lineNo}: ${newLine}`);
			emitted++;
		}
	}

	out.push("```");
	return out.join("\n");
}

async function createFile(
	filePath: string,
	fileText: string,
	encoding: BufferEncoding,
): Promise<string> {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, fileText, { encoding });
	return `File created successfully at: ${filePath}`;
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function replaceInFile(
	filePath: string,
	oldStr: string,
	newStr: string | null | undefined,
	encoding: BufferEncoding,
	maxDiffLines: number,
): Promise<string> {
	const content = await fs.readFile(filePath, encoding);
	const occurrences = countOccurrences(content, oldStr);

	if (occurrences === 0) {
		throw new Error(`No replacement performed: text not found in ${filePath}.`);
	}

	if (occurrences > 1) {
		throw new Error(
			`No replacement performed: multiple occurrences of text found in ${filePath}.`,
		);
	}

	const updated = content.replace(oldStr, newStr ?? "");
	await fs.writeFile(filePath, updated, { encoding });

	const diff = createLineDiff(content, updated, maxDiffLines);
	return `Edited ${filePath}\n${diff}`;
}

async function insertInFile(
	filePath: string,
	insertLineOneBased: number,
	newStr: string,
	encoding: BufferEncoding,
): Promise<string> {
	const content = await fs.readFile(filePath, encoding);
	const lines = content.split("\n");
	const insertLine = insertLineOneBased - 1; // Convert to zero-based index

	if (insertLine < 0 || insertLine > lines.length) {
		throw new Error(
			`Invalid line number: ${insertLineOneBased}. Valid range: 1-${lines.length}`,
		);
	}

	lines.splice(insertLine, 0, ...newStr.split("\n"));
	await fs.writeFile(filePath, lines.join("\n"), { encoding });

	return `Inserted content at line ${insertLineOneBased} in ${filePath}.`;
}

/**
 * Create an editor executor using Node.js fs module
 */
export function createEditorExecutor(
	options: EditorExecutorOptions = {},
): EditorExecutor {
	const {
		encoding = "utf-8",
		restrictToCwd = true,
		maxDiffLines = 200,
	} = options;

	return async (
		input: EditFileInput,
		cwd: string,
		_context: ToolContext,
	): Promise<string> => {
		const filePath = resolveFilePath(cwd, input.path, restrictToCwd);

		if (input.insert_line != null) {
			return insertInFile(
				filePath,
				input.insert_line, // One-based index
				input.new_text,
				encoding,
			);
		}

		if (!(await fileExists(filePath))) {
			return createFile(filePath, input.new_text, encoding);
		}
		if (input.old_text == null) {
			throw new Error(
				"Parameter `old_text` is required when editing an existing file without `insert_line`",
			);
		}

		return replaceInFile(
			filePath,
			input.old_text,
			input.new_text,
			encoding,
			maxDiffLines,
		);
	};
}
