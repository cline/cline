import { validateWithZod } from "@cline/shared";
import {
	type EditFileInput,
	INPUT_ARG_CHAR_LIMIT,
	type ReadFileRequest,
	ReadFilesInputUnionSchema,
	type StructuredCommandInput,
	StructuredCommandsInputUnionSchema,
} from "./schemas";

export interface NormalizedRunCommand {
	command: string | StructuredCommandInput;
	timeoutMs: number;
	timeoutSource: "default_setting" | "command_parameter";
}

const TOP_LEVEL_TIMEOUT_ERROR =
	'Top-level timeout is not supported for run_commands; set timeout on each structured command entry, for example { "commands": [{ "command": "npm test", "timeout": 120000 }] }.';

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
	/**
	 * Shared brand for tool wrapper/executor timeouts. Use this when callers
	 * need to distinguish real timeout failures from ordinary error text.
	 */
	readonly type = "timeout";
}

export function withTimeout<T>(
	promise: Promise<T>,
	ms: number,
	message: string,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		const timeout = setTimeout(() => {
			settle(() => reject(new TimeoutError(message)));
		}, ms);
		const settle = (callback: () => void) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timeout);
			callback();
		};

		promise.then(
			(value) => settle(() => resolve(value)),
			(error: unknown) => settle(() => reject(error)),
		);
	});
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
	assertNoTopLevelRunCommandsTimeout(input);
	const validate = validateWithZod(StructuredCommandsInputUnionSchema, input);

	return normalizeValidatedRunCommandsInput(validate);
}

export function assertNoTopLevelRunCommandsTimeout(input: unknown): void {
	if (
		typeof input === "object" &&
		input !== null &&
		!Array.isArray(input) &&
		"timeout" in input &&
		("commands" in input || "cmd" in input)
	) {
		throw new Error(TOP_LEVEL_TIMEOUT_ERROR);
	}
}

function normalizeStructuredCommandInput(
	command: StructuredCommandInput,
): StructuredCommandInput {
	return command.args === undefined
		? { command: command.command }
		: { command: command.command, args: command.args };
}

export function normalizeValidatedRunCommandsInput(
	validate: ReturnType<typeof StructuredCommandsInputUnionSchema.parse>,
): Array<string | StructuredCommandInput> {
	if (typeof validate === "string") {
		return [validate];
	}

	if (Array.isArray(validate)) {
		return validate.map((command) =>
			typeof command === "string"
				? command
				: normalizeStructuredCommandInput(command),
		);
	}

	if ("commands" in validate) {
		const commands = Array.isArray(validate.commands)
			? validate.commands
			: [validate.commands];
		return commands.map((command) =>
			typeof command === "string"
				? command
				: normalizeStructuredCommandInput(command),
		);
	}

	if ("command" in validate) {
		return "args" in validate
			? [normalizeStructuredCommandInput(validate)]
			: [validate.command];
	}

	if ("cmd" in validate) {
		return [validate.cmd];
	}

	return [validate];
}

function resolveCommandTimeoutMs(
	command: string | StructuredCommandInput,
	defaultTimeoutMs: number,
): number {
	return typeof command === "string"
		? defaultTimeoutMs
		: (command.timeout ?? defaultTimeoutMs);
}

function normalizeRunCommandWithTimeout(
	command: string | StructuredCommandInput,
	defaultTimeoutMs: number,
): NormalizedRunCommand {
	const timeoutSource =
		typeof command !== "string" && command.timeout != null
			? "command_parameter"
			: "default_setting";
	return {
		command:
			typeof command === "string"
				? command
				: normalizeStructuredCommandInput(command),
		timeoutMs: resolveCommandTimeoutMs(command, defaultTimeoutMs),
		timeoutSource,
	};
}

export function normalizeValidatedRunCommandsInputWithTimeouts(
	validate: ReturnType<typeof StructuredCommandsInputUnionSchema.parse>,
	defaultTimeoutMs: number,
): NormalizedRunCommand[] {
	if (typeof validate === "string") {
		return [normalizeRunCommandWithTimeout(validate, defaultTimeoutMs)];
	}

	if (Array.isArray(validate)) {
		return validate.map((command) =>
			normalizeRunCommandWithTimeout(command, defaultTimeoutMs),
		);
	}

	if ("commands" in validate) {
		const commands = Array.isArray(validate.commands)
			? validate.commands
			: [validate.commands];
		return commands.map((command) =>
			normalizeRunCommandWithTimeout(command, defaultTimeoutMs),
		);
	}

	if ("command" in validate) {
		return [normalizeRunCommandWithTimeout(validate, defaultTimeoutMs)];
	}

	if ("cmd" in validate) {
		return [normalizeRunCommandWithTimeout(validate.cmd, defaultTimeoutMs)];
	}

	return [normalizeRunCommandWithTimeout(validate, defaultTimeoutMs)];
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
