import { validateWithZod } from "@cline/shared";
import {
	type EditFileInput,
	INPUT_ARG_CHAR_LIMIT,
	type ReadFileRequest,
	RunCommandsInputUnionSchema,
	type StructuredCommandInput,
} from "./schemas";

/**
 * Format an error into a string message
 */
export function formatError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

export function getEditorSizeError(input: EditFileInput): string | null {
	if (
		typeof input.old_text === "string" &&
		input.old_text.length > INPUT_ARG_CHAR_LIMIT
	) {
		return `Editor input too large: old_text was ${input.old_text.length} characters, exceeding the recommended limit of ${INPUT_ARG_CHAR_LIMIT}. Split the edit into smaller tool calls so later tool calls are less likely to be truncated or time out.`;
	}

	if (input.new_text.length > INPUT_ARG_CHAR_LIMIT) {
		return `Editor input too large: new_text was ${input.new_text.length} characters, exceeding the recommended limit of ${INPUT_ARG_CHAR_LIMIT}. Split the edit into smaller tool calls so later tool calls are less likely to be truncated or time out.`;
	}

	return null;
}

/**
 * Create a timeout-wrapped promise
 */
export class TimeoutError extends Error {
	readonly timeoutMs: number;

	constructor(message: string, timeoutMs: number) {
		super(message);
		this.name = "TimeoutError";
		this.timeoutMs = timeoutMs;
	}
}

export function withTimeout<T>(
	promise: Promise<T>,
	ms: number,
	message: string,
): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) => {
			setTimeout(() => reject(new TimeoutError(message, ms)), ms);
		}),
	]);
}

/**
 * Echo a read request into a result's `query` field as a JSON object string
 * (e.g. `{"path":"/a/b.ts","start_line":3,"end_line":5}`). Restating the
 * request under its canonical input keys keeps every successful result
 * reinforcing the exact shape the model must emit on its next call, unlike
 * the previous fused `path:start-end` format which taught an invalid one.
 */
export function formatReadFileQuery(request: ReadFileRequest): string {
	const echo: Record<string, string | number> = { path: request.path };
	if (request.start_line != null) {
		echo.start_line = request.start_line;
	}
	if (request.end_line != null) {
		echo.end_line = request.end_line;
	}
	return JSON.stringify(echo);
}

export function getReadFileRangeError(request: ReadFileRequest): string | null {
	const { start_line, end_line } = request;
	if (start_line == null || end_line == null || start_line <= end_line) {
		return null;
	}

	return `start_line must be less than or equal to end_line (received start_line: ${start_line}, end_line: ${end_line})`;
}

const READ_RANGE_KEYS = new Set(["start_line", "end_line"]);

/** Path keys accepted on read entries; aliases are normalized to `path` during validation. */
const READ_PATH_KEYS = ["path", "file_path", "filePath"] as const;

function hasReadPathKey(value: object): boolean {
	return READ_PATH_KEYS.some((key) => key in value);
}

function isOrphanReadRangeEntry(
	value: unknown,
): value is Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return false;
	}
	const keys = Object.keys(value);
	return keys.length > 0 && keys.every((key) => READ_RANGE_KEYS.has(key));
}

function coalesceOrphanReadRangeEntries(entries: unknown[]): unknown[] {
	const coalesced: unknown[] = [];
	for (const entry of entries) {
		if (isOrphanReadRangeEntry(entry)) {
			const previous = coalesced[coalesced.length - 1];
			if (typeof previous === "string") {
				coalesced[coalesced.length - 1] = { path: previous, ...entry };
				continue;
			}
			if (
				previous !== null &&
				typeof previous === "object" &&
				!Array.isArray(previous) &&
				hasReadPathKey(previous) &&
				Object.keys(entry).every((key) => !(key in previous))
			) {
				coalesced[coalesced.length - 1] = { ...previous, ...entry };
				continue;
			}
		}
		coalesced.push(entry);
	}
	return coalesced;
}

/**
 * Some models emit a file's line range as a separate array element instead of
 * placing start_line/end_line on the same object as its path. Fold such
 * orphan range entries into the preceding file entry before validation.
 */
export function coalesceOrphanReadRanges(input: unknown): unknown {
	if (Array.isArray(input)) {
		return coalesceOrphanReadRangeEntries(input);
	}
	if (input !== null && typeof input === "object") {
		for (const key of ["files", "paths"] as const) {
			const value = (input as Record<string, unknown>)[key];
			if (Array.isArray(value)) {
				return { ...input, [key]: coalesceOrphanReadRangeEntries(value) };
			}
		}
	}
	return input;
}

export function normalizeRunCommandsInput(
	input: unknown,
): Array<string | StructuredCommandInput> {
	const validate = validateWithZod(RunCommandsInputUnionSchema, input);

	if (typeof validate === "string") {
		return [validate];
	}

	if (Array.isArray(validate)) {
		return validate;
	}

	if ("commands" in validate) {
		return Array.isArray(validate.commands)
			? validate.commands
			: [validate.commands];
	}

	if ("command" in validate) {
		return "args" in validate ? [validate] : [validate.command];
	}

	if ("cmd" in validate) {
		return [validate.cmd];
	}

	return [validate];
}

export function formatRunCommandQuery(
	command: string | StructuredCommandInput,
): string {
	if (typeof command === "string") {
		return command;
	}

	const args = command.args ?? [];
	if (args.length === 0) {
		return command.command;
	}

	const renderedArgs = args.map((arg) =>
		/[\s"]/u.test(arg) ? JSON.stringify(arg) : arg,
	);
	return `${command.command} ${renderedArgs.join(" ")}`;
}

/**
 * Max characters of the executed command echoed back in the tool result's
 * `query` field. The full command already exists in the assistant tool-call
 * input, so repeating it in the result only duplicates tokens in the
 * provider request (expensive for large heredoc/file-generation commands).
 */
export const RUN_COMMAND_QUERY_PREVIEW_LIMIT = 200;

/**
 * Bound the command echo placed in a provider-facing tool result.
 * Short commands pass through unchanged; long commands keep a short
 * prefix plus a truncation note so the result is still identifiable.
 */
export function formatRunCommandQueryPreview(
	command: string | StructuredCommandInput,
): string {
	const rendered = formatRunCommandQuery(command);
	if (rendered.length <= RUN_COMMAND_QUERY_PREVIEW_LIMIT) {
		return rendered;
	}
	const truncatedChars = rendered.length - RUN_COMMAND_QUERY_PREVIEW_LIMIT;
	return `${rendered.slice(0, RUN_COMMAND_QUERY_PREVIEW_LIMIT)} ... [command truncated: ${truncatedChars} more chars; full command is in the tool call input]`;
}
