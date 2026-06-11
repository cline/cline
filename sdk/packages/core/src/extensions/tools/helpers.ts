import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { validateWithZod } from "@cline/shared";
import {
	type EditFileInput,
	INPUT_ARG_CHAR_LIMIT,
	type ReadFileRequest,
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

export const DEFAULT_RUN_COMMAND_OUTPUT_MAX_CHARS = 20_000;
export const DEFAULT_READ_FILE_OUTPUT_MAX_CHARS = 40_000;

interface TextBudgetMetadata {
	truncated?: true;
	omittedChars?: number;
	omittedBytes?: number;
	fullOutputPath?: string;
	normalizedCarriageReturns?: true;
}

export interface BudgetedText {
	text: string;
	metadata: TextBudgetMetadata;
}

interface PreviewOptions {
	source: string;
	original: string;
	maxChars: number;
	preserve: "head-tail" | "tail";
	marker: (omittedChars: number, omittedBytes: number) => string;
}

function byteLength(value: string): number {
	return Buffer.byteLength(value, "utf8");
}

function formatOmittedCount(chars: number, bytes: number): string {
	if (chars === bytes) {
		return `${chars} chars`;
	}
	return `${chars} chars / ${bytes} bytes`;
}

function computeVisibleText(
	source: string,
	budget: number,
	preserve: PreviewOptions["preserve"],
): string {
	if (budget <= 0) {
		return "";
	}
	if (source.length <= budget) {
		return source;
	}
	if (preserve === "tail") {
		return source.slice(source.length - budget);
	}

	const headChars = Math.ceil(budget * 0.4);
	const tailChars = Math.max(0, budget - headChars);
	return `${source.slice(0, headChars)}${source.slice(
		source.length - tailChars,
	)}`;
}

function buildPreview(options: PreviewOptions): {
	text: string;
	omittedChars: number;
	omittedBytes: number;
} {
	let marker = options.marker(0, 0);
	let visible = "";
	let omittedChars = 0;
	let omittedBytes = 0;

	for (let i = 0; i < 4; i++) {
		const budget = Math.max(0, options.maxChars - marker.length);
		visible = computeVisibleText(options.source, budget, options.preserve);
		omittedChars = Math.max(0, options.original.length - visible.length);
		omittedBytes = Math.max(
			0,
			byteLength(options.original) - byteLength(visible),
		);
		marker = options.marker(omittedChars, omittedBytes);
	}

	const text =
		options.preserve === "tail"
			? `${marker}${visible}`
			: `${visible.slice(
					0,
					Math.ceil(visible.length * 0.4),
				)}${marker}${visible.slice(Math.ceil(visible.length * 0.4))}`;

	return {
		text,
		omittedChars,
		omittedBytes,
	};
}

interface NormalizedCarriageReturnOutput {
	text: string;
	changed: boolean;
	carriageReturnCount: number;
}

function normalizeCarriageReturnOutput(
	output: string,
): NormalizedCarriageReturnOutput {
	if (!output.includes("\r")) {
		return { text: output, changed: false, carriageReturnCount: 0 };
	}

	const lines: string[] = [];
	let current = "";
	let carriageReturnCount = 0;
	let endedWithLineBreak = false;

	for (let i = 0; i < output.length; i++) {
		const char = output[i];
		endedWithLineBreak = false;

		if (char === "\r") {
			carriageReturnCount += 1;
			if (output[i + 1] === "\n") {
				lines.push(current);
				current = "";
				i += 1;
				endedWithLineBreak = true;
			} else {
				current = "";
			}
			continue;
		}

		if (char === "\n") {
			lines.push(current);
			current = "";
			endedWithLineBreak = true;
			continue;
		}

		current += char;
	}

	if (current.length > 0 || !endedWithLineBreak) {
		lines.push(current);
	}

	const text = `${lines.join("\n")}${endedWithLineBreak ? "\n" : ""}`;
	return {
		text,
		changed: text !== output,
		carriageReturnCount,
	};
}

function isCarriageReturnProgressOutput(
	normalized: NormalizedCarriageReturnOutput,
	original: string,
): boolean {
	if (normalized.carriageReturnCount >= 20) {
		return true;
	}
	return (
		normalized.carriageReturnCount >= 5 &&
		original.length - normalized.text.length > 1_000
	);
}

function sanitizeArtifactSegment(
	value: string | undefined,
): string | undefined {
	const normalized = value?.trim();
	if (!normalized) {
		return undefined;
	}
	const safe = normalized.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 64);
	return safe || undefined;
}

async function writeCommandOutputArtifact(options: {
	output: string;
	cwd: string;
	artifactDirectory?: string;
	sessionId?: string;
	toolCallId?: string;
}): Promise<string | undefined> {
	const sessionSegment = sanitizeArtifactSegment(options.sessionId);
	const toolCallSegment = sanitizeArtifactSegment(options.toolCallId);
	const filename = [
		"run_commands",
		sessionSegment,
		toolCallSegment,
		Date.now().toString(36),
		randomUUID(),
	]
		.filter((segment): segment is string => Boolean(segment))
		.join("-");
	const candidateDirs = [
		options.artifactDirectory
			? resolve(options.artifactDirectory)
			: resolve(options.cwd, ".cline", "tmp", "tool-outputs"),
		join(tmpdir(), "cline-tool-outputs"),
	];

	for (const dir of candidateDirs) {
		try {
			await mkdir(dir, { recursive: true });
			const outputPath = join(dir, `${filename}.txt`);
			await writeFile(outputPath, options.output, "utf8");
			return outputPath;
		} catch {
			// Try the next artifact directory.
		}
	}

	return undefined;
}

function commandOmittedMarker(
	path: string | undefined,
	omittedChars: number,
	omittedBytes: number,
): string {
	const artifactText = path
		? `; full output saved to ${path}`
		: "; full output artifact unavailable";
	return `\n\n[... omitted ${formatOmittedCount(
		omittedChars,
		omittedBytes,
	)} from command output${artifactText} ...]\n\n`;
}

function readFileOmittedMarker(
	omittedChars: number,
	omittedBytes: number,
): string {
	return `\n\n[... omitted ${formatOmittedCount(
		omittedChars,
		omittedBytes,
	)} from file output; use start_line/end_line to inspect omitted content ...]\n\n`;
}

export async function budgetRunCommandOutput(options: {
	output: string;
	maxChars: number;
	cwd: string;
	artifactDirectory?: string;
	sessionId?: string;
	toolCallId?: string;
}): Promise<BudgetedText> {
	const normalized = normalizeCarriageReturnOutput(options.output);
	const needsCompaction =
		options.output.length > options.maxChars ||
		normalized.text.length > options.maxChars ||
		normalized.changed;

	if (!needsCompaction) {
		return { text: options.output, metadata: {} };
	}

	const fullOutputPath =
		options.output.length > options.maxChars
			? await writeCommandOutputArtifact({
					output: options.output,
					cwd: options.cwd,
					artifactDirectory: options.artifactDirectory,
					sessionId: options.sessionId,
					toolCallId: options.toolCallId,
				})
			: undefined;
	const preserve = isCarriageReturnProgressOutput(normalized, options.output)
		? "tail"
		: "head-tail";
	const preview = buildPreview({
		source: normalized.text,
		original: options.output,
		maxChars: options.maxChars,
		preserve,
		marker: (omittedChars, omittedBytes) =>
			commandOmittedMarker(fullOutputPath, omittedChars, omittedBytes),
	});

	return {
		text: preview.text,
		metadata: {
			truncated: true,
			omittedChars: preview.omittedChars,
			omittedBytes: preview.omittedBytes,
			...(fullOutputPath ? { fullOutputPath } : {}),
			...(normalized.changed ? { normalizedCarriageReturns: true } : {}),
		},
	};
}

export function budgetReadFileOutput(options: {
	output: string;
	maxChars: number;
	isExplicitRange: boolean;
}): BudgetedText {
	if (options.isExplicitRange || options.output.length <= options.maxChars) {
		return { text: options.output, metadata: {} };
	}

	const preview = buildPreview({
		source: options.output,
		original: options.output,
		maxChars: options.maxChars,
		preserve: "head-tail",
		marker: readFileOmittedMarker,
	});

	return {
		text: preview.text,
		metadata: {
			truncated: true,
			omittedChars: preview.omittedChars,
			omittedBytes: preview.omittedBytes,
		},
	};
}
