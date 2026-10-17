import { isRecord, text } from "../../values";

/** The tool names that write files: `editor` today, the legacy names on old transcripts, and patches. */
export const WRITE_FILE_TOOL_NAMES: ReadonlySet<string> = new Set([
	"editor",
	"write_to_file",
	"replace_in_file",
	"apply_patch",
]);

export const PUSH = /\bgit\s+push\b|\bgh\s+pr\s+(?:create|merge|ready)\b/;
const PATCH_FILE_LINE = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm;

/**
 * How core's apply_patch reports a failure that can stop it partway. Core
 * checks every Add, Update and Delete path before it writes anything, then
 * writes file by file without undoing earlier writes. A filesystem error, or
 * a `Move to` target outside the folder, which core checks only when it
 * writes that file, leaves the earlier files written. An outside path the
 * patch adds, updates or deletes is rejected before anything is written.
 */
const PATCH_WRITE_FAILURE =
	/^apply_patch failed: (?:E[A-Z]+: |Path must stay within cwd: (.+)$)/;

/** How core's editor and apply_patch report their time running out; core does not cancel the write, which can still land. */
const WRITE_TIMEOUT =
	/^(?:Editor operation failed: Editor operation|apply_patch failed: apply_patch) timed out\b/;

export function editedPaths(input: unknown): string[] {
	if (typeof input === "string")
		return [...input.matchAll(PATCH_FILE_LINE)].flatMap((match) =>
			match[1] ? [match[1].trim()] : [],
		);
	if (!isRecord(input)) return [];
	for (const key of ["path", "file_path", "filePath"]) {
		const value = input[key];
		if (typeof value === "string" && value.trim()) return [value.trim()];
	}
	for (const key of ["input", "patch"]) {
		if (typeof input[key] === "string") return editedPaths(input[key]);
	}
	return [];
}

/** True when a tool call pushed or opened a PR, from its input; nothing of the input is kept. */
export function isPushCommand(input: unknown): boolean {
	try {
		return PUSH.test(
			typeof input === "string" ? input : JSON.stringify(input ?? ""),
		);
	} catch {
		return false;
	}
}

/**
 * True when a call's result reports a failure the tool caught, although the
 * call itself did not error: Cline's editor, apply_patch and run_commands
 * answer `success: false`, run_commands once per command. Of several commands
 * only those `matching` count, or all of them when no query matches, since a
 * long command's query is cut short.
 */
export function failedInBand(output: unknown, matching?: RegExp): boolean {
	const operations = (Array.isArray(output) ? output : [output]).filter(
		isRecord,
	);
	const named = matching
		? operations.filter(
				(operation) =>
					typeof operation.query === "string" && matching.test(operation.query),
			)
		: [];
	const counted = named.length > 0 ? named : operations;
	return (
		counted.length > 0 &&
		counted.every((operation) => operation.success === false)
	);
}

/** True when a write's reported failure may still have left files written: neither result says which ones. */
export function mayHaveWritten(
	output: unknown,
	paths: readonly string[],
): boolean {
	const error = isRecord(output) ? text(output.error) : undefined;
	if (!error) return false;
	if (WRITE_TIMEOUT.test(error)) return true;
	const patchFailure = PATCH_WRITE_FAILURE.exec(error);
	if (!patchFailure) return false;
	const rejectedPath = patchFailure[1];
	return rejectedPath === undefined || !paths.includes(rejectedPath);
}

export function errorText(output: unknown): string {
	if (typeof output === "string") return output;
	if (isRecord(output) && typeof output.error === "string") return output.error;
	try {
		return JSON.stringify(output) ?? "";
	} catch {
		return "";
	}
}

type ToolCall = { callId: unknown; name: string; input: unknown };
type ToolResult = {
	callId: string;
	name?: string;
	output: unknown;
	isError: boolean;
};

/** A tool call as a run holds it (`tool-call`) or as the hub's transcript stores it (`tool_use`). */
export function toolCallOf(
	part: Record<string, unknown>,
): ToolCall | undefined {
	if (part.type === "tool-call" && typeof part.toolName === "string")
		return { callId: part.toolCallId, name: part.toolName, input: part.input };
	if (part.type === "tool_use" && typeof part.name === "string")
		return { callId: part.id, name: part.name, input: part.input };
	return undefined;
}

/** A tool result as a run holds it (`tool-result`) or as the hub's transcript stores it (`tool_result`). */
export function toolResultOf(
	part: Record<string, unknown>,
): ToolResult | undefined {
	if (part.type === "tool-result" && typeof part.toolCallId === "string")
		return {
			callId: part.toolCallId,
			name: text(part.toolName),
			output: storedOutput(part.output),
			isError: part.isError === true,
		};
	if (part.type === "tool_result" && typeof part.tool_use_id === "string")
		return {
			callId: part.tool_use_id,
			name: text(part.name),
			output: storedOutput(part.content),
			isError: part.is_error === true,
		};
	return undefined;
}

/** A tool's output, read back as the object when core stored it as JSON: a transcript does, and so does a run restored from one. */
function storedOutput(output: unknown): unknown {
	if (typeof output !== "string") return output;
	try {
		const parsed: unknown = JSON.parse(output);
		return isRecord(parsed) || Array.isArray(parsed) ? parsed : output;
	} catch {
		return output;
	}
}
