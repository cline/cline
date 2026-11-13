/**
 * File Read Executor
 *
 * Built-in implementation for reading files using Node.js fs module.
 */

import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import type { AgentToolContext } from "@cline/shared";
import { resolveExistingFilePath } from "@cline/shared/storage";
import {
	TOOL_RESULT_CACHE_MISS,
	ToolResultCache,
} from "../../../session/services/tool-result-cache";
import { getReadFileRangeError } from "../helpers";
import type { ReadFileRequest } from "../schemas";
import type { FileReadExecutor } from "../types";
import {
	MAX_LINE_CHARS,
	MAX_READ_LINES,
	MAX_READ_OFFSET_CHARS,
	MAX_READ_OUTPUT_CHARS,
} from "./output-limits";

const IMAGE_MEDIA_TYPES = new Map<string, string>([
	[".gif", "image/gif"],
	[".png", "image/png"],
	[".jpg", "image/jpeg"],
	[".jpeg", "image/jpeg"],
	[".webp", "image/webp"],
]);

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

const MAX_TEXT_STREAM_BYTES = 100_000_000;
const MAX_UNRANGED_LINE_SCAN = 50_000;

interface CapturedLine {
	lineNumber: number;
	text: string;
}

function getAbortError(signal: AbortSignal): Error {
	const { reason } = signal;
	if (reason instanceof Error) {
		return reason;
	}
	if (reason !== undefined) {
		return new Error(String(reason));
	}
	return new Error("File read was aborted");
}

/** Read a bounded, unmodified text page without buffering the entire file. */
async function readOffsetWindow(
	stream: Readable,
	startOffset: number,
	signal?: AbortSignal,
): Promise<string> {
	if (!Number.isSafeInteger(startOffset) || startOffset < 0) {
		stream.destroy();
		throw new Error("start_offset must be a nonnegative safe integer");
	}
	const limit = MAX_READ_OFFSET_CHARS;
	const abortHandler = () =>
		stream.destroy(signal ? getAbortError(signal) : undefined);
	let scanned = 0;
	let page = "";
	try {
		signal?.throwIfAborted();
		signal?.addEventListener("abort", abortHandler, { once: true });
		for await (const chunk of stream) {
			signal?.throwIfAborted();
			const text = String(chunk);
			const skip = Math.max(0, startOffset - scanned);
			scanned += text.length;
			if (skip >= text.length) continue;
			if (
				page.length === 0 &&
				text.charCodeAt(skip) >= 0xdc00 &&
				text.charCodeAt(skip) <= 0xdfff
			) {
				throw new Error("start_offset must not split a Unicode surrogate pair");
			}
			page += text.slice(skip, skip + limit + 1 - page.length);
			if (page.length > limit) break;
		}
	} finally {
		signal?.removeEventListener("abort", abortHandler);
		stream.destroy();
	}
	let end = 0;
	let encodedChars = 0;
	// read_files results are JSON-serialized into the model preview. Budget the
	// escaped representation too, so a page of quotes/control characters survives.
	for (const character of page) {
		const cost = JSON.stringify(character).length - 2;
		if (
			end + character.length > limit ||
			encodedChars + cost > MAX_READ_OFFSET_CHARS
		)
			break;
		end += character.length;
		encodedChars += cost;
	}
	const last = page.charCodeAt(end - 1);
	if (end < page.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
	const hasMore = end < page.length;
	const nextOffset = startOffset + end;
	return `[Characters ${startOffset}-${nextOffset} (UTF-16, end exclusive); next_offset=${nextOffset}; has_more=${hasMore}]\n${page.slice(0, end)}`;
}

async function readTextWindow(
	stream: Readable,
	includeLineNumbers: boolean,
	startLine: number | null | undefined,
	endLine: number | null | undefined,
	signal?: AbortSignal,
): Promise<string> {
	if (signal?.aborted) {
		stream.destroy();
		throw getAbortError(signal);
	}

	const requestedStartLine = Math.max(startLine ?? 1, 1);
	const requestedEndLine = endLine ?? Number.POSITIVE_INFINITY;
	const hasFiniteEndLine = Number.isFinite(requestedEndLine);
	const maxScannedLine = hasFiniteEndLine
		? requestedEndLine
		: requestedStartLine + MAX_UNRANGED_LINE_SCAN - 1;
	const captured: CapturedLine[] = [];
	let chars = 0;
	let totalLines = 0;
	let capped = false;
	let approximateTotalLines = false;
	const maxCapturedLineNumber = Number.isFinite(requestedEndLine)
		? Math.min(requestedEndLine, requestedStartLine + MAX_READ_LINES - 1)
		: requestedStartLine + MAX_READ_LINES - 1;
	const lineNumberPrefixChars = includeLineNumbers
		? String(maxCapturedLineNumber).length + 3
		: 0;

	const reader = createInterface({
		input: stream,
		crlfDelay: Number.POSITIVE_INFINITY,
	});
	const abortHandler = signal
		? () => stream.destroy(getAbortError(signal))
		: undefined;

	if (signal && abortHandler) {
		signal.addEventListener("abort", abortHandler, { once: true });
	}

	try {
		for await (const rawLine of reader) {
			totalLines += 1;
			if (totalLines > requestedEndLine) {
				totalLines = requestedEndLine;
				break;
			}
			if (!hasFiniteEndLine && capped && totalLines >= maxScannedLine) {
				approximateTotalLines = true;
				break;
			}
			if (totalLines < requestedStartLine || capped) {
				continue;
			}
			if (captured.length >= MAX_READ_LINES) {
				capped = true;
				continue;
			}

			let line = rawLine;
			if (line.length > MAX_LINE_CHARS) {
				line = `${line.slice(0, MAX_LINE_CHARS)} [line truncated] (use start_offset to page through the remaining text)`;
			}

			const nextChars = chars + line.length + lineNumberPrefixChars + 1;
			if (nextChars > MAX_READ_OUTPUT_CHARS && captured.length > 0) {
				capped = true;
				continue;
			}

			captured.push({ lineNumber: totalLines, text: line });
			chars = nextChars;
		}
	} finally {
		if (signal && abortHandler) {
			signal.removeEventListener("abort", abortHandler);
		}
		reader.close();
		stream.destroy();
	}

	const maxLineNumWidth = String(
		captured[captured.length - 1]?.lineNumber ?? totalLines,
	).length;
	const body = captured
		.map(({ lineNumber, text }) =>
			includeLineNumbers
				? `${String(lineNumber).padStart(maxLineNumWidth, " ")} | ${text}`
				: text,
		)
		.join("\n");
	const lastCapturedLine = captured[captured.length - 1]?.lineNumber;
	if (lastCapturedLine === undefined) {
		return body;
	}

	const effectiveEndLine = Math.min(requestedEndLine, totalLines);
	if (lastCapturedLine >= effectiveEndLine) {
		return body;
	}
	const totalLineText = approximateTotalLines
		? `${totalLines}+ lines`
		: effectiveEndLine;

	return (
		`${body}\n\n` +
		`[Showing lines ${requestedStartLine}-${lastCapturedLine} of ${totalLineText}. ` +
		"Use start_line/end_line to read other sections.]"
	);
}

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

	return async (request: ReadFileRequest, context: AgentToolContext) => {
		const { path: filePath, start_line, end_line, start_offset } = request;
		const rangeError = getReadFileRangeError(request);
		if (rangeError) throw new Error(rangeError);
		const readWindow = (stream: Readable) =>
			start_offset != null
				? readOffsetWindow(stream, start_offset, context.signal)
				: readTextWindow(
						stream,
						includeLineNumbers,
						start_line,
						end_line,
						context.signal,
					);
		if (filePath.startsWith("cline://")) {
			context.signal?.throwIfAborted();
			const cache = context.metadata?.toolResultCache;
			if (!(cache instanceof ToolResultCache))
				throw new Error(TOOL_RESULT_CACHE_MISS);
			return readWindow(Readable.from([cache.read(filePath)]));
		}
		const initialPath = path.isAbsolute(filePath)
			? path.normalize(filePath)
			: path.resolve(process.cwd(), filePath);
		// Tolerate Unicode-whitespace mismatches (e.g. macOS Sonoma+
		// screenshot paths where the on-disk filename contains U+202F but
		// the caller's string has a regular space).
		const resolvedPath = resolveExistingFilePath(initialPath) ?? initialPath;
		const extension = path.extname(resolvedPath).toLowerCase();
		const imageMediaType = IMAGE_MEDIA_TYPES.get(extension);

		// Check if file exists
		const stat = await fs.stat(resolvedPath);

		if (!stat.isFile()) {
			throw new Error(`Path is not a file: ${resolvedPath}`);
		}

		if (imageMediaType) {
			if (start_offset != null)
				throw new Error("Offset reads are only supported for text");
			if (stat.size > maxFileSizeBytes) {
				throw new Error(
					`Image file too large: ${stat.size} bytes (max: ${maxFileSizeBytes} bytes).`,
				);
			}
			if (context.metadata?.modelSupportsImages !== true) {
				throw new Error("Current model does not support image input");
			}
			const data = await fs.readFile(resolvedPath);
			return [
				{
					type: "text",
					text: "Successfully read image",
				},
				{
					type: "image",
					data: data.toString("base64"),
					mediaType: imageMediaType,
				},
			];
		}

		if (stat.size > MAX_TEXT_STREAM_BYTES) {
			throw new Error(
				`Text file too large to stream safely: ${stat.size} bytes (max: ${MAX_TEXT_STREAM_BYTES} bytes). Use a targeted command such as sed, grep, head, or tail to inspect specific sections.`,
			);
		}

		return readWindow(createReadStream(resolvedPath, { encoding }));
	};
}
