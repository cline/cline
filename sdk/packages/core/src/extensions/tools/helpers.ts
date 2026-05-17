import { validateWithZod } from "@cline/shared";
import {
	type EditFileInput,
	INPUT_ARG_CHAR_LIMIT,
	type ReadFileRequest,
	ReadFilesInputUnionSchema,
	type StructuredCommandInput,
	StructuredCommandsInputUnionSchema,
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
export function withTimeout<T>(
	promise: Promise<T>,
	ms: number,
	message: string,
): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) => {
			setTimeout(() => reject(new Error(message)), ms);
		}),
	]);
}

export function normalizeReadFileRequests(input: unknown): ReadFileRequest[] {
	const validate = validateWithZod(ReadFilesInputUnionSchema, input);

	if (typeof validate === "string") {
		return [{ path: validate }];
	}

	if (Array.isArray(validate)) {
		return validate.map((value) =>
			typeof value === "string" ? { path: value } : value,
		);
	}

	if ("files" in validate) {
		const files = Array.isArray(validate.files)
			? validate.files
			: [validate.files];
		return files;
	}

	if ("file_paths" in validate) {
		const filePaths = Array.isArray(validate.file_paths)
			? validate.file_paths
			: [validate.file_paths];
		return filePaths.map((filePath) => ({ path: filePath }));
	}

	if ("paths" in validate) {
		const paths = Array.isArray(validate.paths)
			? validate.paths
			: [validate.paths];
		return paths.map((path) => (typeof path === "string" ? { path } : path));
	}

	return [validate];
}

export function formatReadFileQuery(request: ReadFileRequest): string {
	const { path, start_line, end_line } = request;
	if (start_line == null && end_line == null) {
		return path;
	}
	const start = start_line ?? 1;
	const end = end_line ?? "EOF";
	return `${path}:${start}-${end}`;
}

export function getReadFileRangeError(request: ReadFileRequest): string | null {
	const { start_line, end_line } = request;
	if (start_line == null || end_line == null || start_line <= end_line) {
		return null;
	}

	return `start_line must be less than or equal to end_line (received start_line: ${start_line}, end_line: ${end_line})`;
}

export function normalizeRunCommandsInput(
	input: unknown,
): Array<string | StructuredCommandInput> {
	const validate = validateWithZod(StructuredCommandsInputUnionSchema, input);

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
