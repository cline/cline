/**
 * File Read Executor
 *
 * Built-in implementation for reading files using Node.js fs module.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ToolContext } from "@clinebot/agents";
import type { ReadFileRequest } from "../schemas";
import type { FileReadExecutor } from "../types";

/**
 * Options for the file read executor
 */
export interface FileReadExecutorOptions {
	/**
	 * Maximum file size to read in bytes
	 * @default 10_000_000 (10MB)
	 */
	maxFileSizeBytes?: number;

	/**
	 * File encoding
	 * @default "utf-8"
	 */
	encoding?: BufferEncoding;

	/**
	 * Whether to include line numbers in output
	 * @default false
	 */
	includeLineNumbers?: boolean;
}

const DEFAULT_FILE_READ_OPTIONS: Required<FileReadExecutorOptions> = {
	maxFileSizeBytes: 10_000_000, // 10MB default limit
	encoding: "utf-8", // Default to UTF-8 encoding
	includeLineNumbers: true, // Include line numbers by default
};

/**
 * Create a file read executor using Node.js fs module
 *
 * @example
 * ```typescript
 * const readFile = createFileReadExecutor({
 *   maxFileSizeBytes: 5_000_000, // 5MB limit
 *   includeLineNumbers: true,
 * })
 *
 * const content = await readFile({ path: "/path/to/file.ts" }, context)
 * ```
 */
export function createFileReadExecutor(
	options: FileReadExecutorOptions = {},
): FileReadExecutor {
	const { maxFileSizeBytes, encoding, includeLineNumbers } = {
		...DEFAULT_FILE_READ_OPTIONS,
		...options,
	};

	return async (
		request: ReadFileRequest,
		_context: ToolContext,
	): Promise<string> => {
		const { path: filePath, start_line, end_line } = request;
		const resolvedPath = path.isAbsolute(filePath)
			? path.normalize(filePath)
			: path.resolve(process.cwd(), filePath);

		// Check if file exists
		const stat = await fs.stat(resolvedPath);

		if (!stat.isFile()) {
			throw new Error(`Path is not a file: ${resolvedPath}`);
		}

		// Check file size
		if (stat.size > maxFileSizeBytes) {
			throw new Error(
				`File too large: ${stat.size} bytes (max: ${maxFileSizeBytes} bytes). ` +
					`Consider reading specific sections or using a different approach.`,
			);
		}

		// Read file content
		const content = await fs.readFile(resolvedPath, encoding);
		const allLines = content.split("\n");
		const rangeStart = Math.max((start_line ?? 1) - 1, 0);
		const rangeEndExclusive = Math.min(
			end_line ?? allLines.length,
			allLines.length,
		);
		const lines = allLines.slice(rangeStart, rangeEndExclusive);

		// Optionally add line numbers - one-based indexing for better readability
		if (includeLineNumbers) {
			const maxLineNumWidth = String(allLines.length).length;
			return lines
				.map(
					(line, i) =>
						`${String(rangeStart + i + 1).padStart(maxLineNumWidth, " ")} | ${line}`,
				)
				.join("\n");
		}

		return lines.join("\n");
	};
}
