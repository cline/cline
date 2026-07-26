/**
 * Map completed agent tool events onto typed Drive work commits.
 * Classification mirrors apps/cline-hub stageReducer (edit|command|test).
 */

export type WorkToolInput = {
	toolCallId?: string;
	toolName?: string;
	status?: "running" | "completed" | "failed";
	input?: unknown;
	output?: unknown;
	error?: string;
	text?: string;
};

export type WorkRecordPayload =
	| {
			kind: "edit";
			path: string;
			summary?: string;
	  }
	| {
			kind: "command";
			command: string;
			failed?: boolean;
			exitCode?: number;
			summary?: string;
	  }
	| {
			kind: "test_result";
			label: string;
			passed: boolean;
			summary?: string;
	  };

const EDIT_TOOLS = new Set([
	"editor",
	"apply_patch",
	"write_to_file",
	"replace_in_file",
	"edit",
	"str_replace",
	"create_file",
]);

const COMMAND_TOOLS = new Set([
	"run_commands",
	"bash",
	"execute_command",
	"shell",
	"run_terminal_cmd",
]);

const TEST_NAME_RE =
	/\b(test|tests|vitest|jest|pytest|mocha|playwright|cypress|bun\s+test)\b/i;

function asRecord(value: unknown): Record<string, unknown> | null {
	if (value && typeof value === "object" && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return null;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0
		? value.trim()
		: undefined;
}

function stringifyCompact(value: unknown, max = 400): string | undefined {
	if (value == null) {
		return undefined;
	}
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
	}
	try {
		const json = JSON.stringify(value, null, 2);
		if (!json) {
			return undefined;
		}
		return json.length > max ? `${json.slice(0, max)}…` : json;
	} catch {
		return undefined;
	}
}

function firstCommandFromInput(input: unknown): string | undefined {
	const record = asRecord(input);
	if (!record) {
		return asString(input);
	}
	const commands = record.commands;
	if (typeof commands === "string") {
		return asString(commands);
	}
	if (Array.isArray(commands) && commands.length > 0) {
		const first = commands[0];
		if (typeof first === "string") {
			return asString(first);
		}
		const entry = asRecord(first);
		return (
			asString(entry?.command) ??
			asString(entry?.cmd) ??
			asString(entry?.script)
		);
	}
	return (
		asString(record.command) ??
		asString(record.cmd) ??
		asString(record.script)
	);
}

function pathFromInput(input: unknown): string | undefined {
	const record = asRecord(input);
	if (!record) {
		return undefined;
	}
	return (
		asString(record.path) ??
		asString(record.file_path) ??
		asString(record.filePath) ??
		asString(record.filename)
	);
}

function pathFromPatch(input: unknown): string | undefined {
	const text =
		asString(input) ??
		asString(asRecord(input)?.input) ??
		asString(asRecord(input)?.patch);
	if (!text) {
		return undefined;
	}
	const match = text.match(/\*\*\*\s+(?:Add|Update|Delete)\s+File:\s*(.+)/);
	return match?.[1]?.trim();
}

function looksLikeTestCommand(command: string | undefined): boolean {
	if (!command) {
		return false;
	}
	return TEST_NAME_RE.test(command);
}

function classifyToolName(
	name: string,
	input: unknown,
	text?: string,
): "edit" | "command" | "test" | null {
	const normalized = name.trim().toLowerCase();
	if (EDIT_TOOLS.has(normalized)) {
		return "edit";
	}
	if (
		COMMAND_TOOLS.has(normalized) ||
		normalized.includes("command") ||
		normalized === "bash"
	) {
		const command = firstCommandFromInput(input) ?? text;
		return looksLikeTestCommand(command) ? "test" : "command";
	}
	if (normalized.includes("test")) {
		return "test";
	}
	return null;
}

/** Convert a completed/failed tool event into a typed work record, or null. */
export function workRecordFromToolEvent(
	tool: WorkToolInput,
): WorkRecordPayload | null {
	const name = tool.toolName ?? "tool";
	const category = classifyToolName(name, tool.input, tool.text);
	if (!category) {
		return null;
	}
	const failed = tool.status === "failed" || Boolean(tool.error);
	const outputSummary =
		stringifyCompact(tool.output, 600) ??
		asString(tool.error) ??
		asString(tool.text);

	switch (category) {
		case "edit": {
			const path =
				pathFromInput(tool.input) ??
				pathFromPatch(tool.input) ??
				name;
			const detail =
				stringifyCompact(asRecord(tool.input)?.new_text, 240) ??
				outputSummary;
			return {
				kind: "edit",
				path,
				summary: detail,
			};
		}
		case "command": {
			const command =
				firstCommandFromInput(tool.input) ?? asString(tool.text) ?? name;
			return {
				kind: "command",
				command,
				failed,
				summary: outputSummary,
			};
		}
		case "test": {
			const label =
				firstCommandFromInput(tool.input) ?? asString(tool.text) ?? name;
			return {
				kind: "test_result",
				label,
				passed: !failed,
				summary: outputSummary ?? (failed ? "failed" : "passed"),
			};
		}
		default: {
			const _exhaustive: never = category;
			return _exhaustive;
		}
	}
}
