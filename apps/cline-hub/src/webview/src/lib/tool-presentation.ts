import {
	buildToolSummary,
	type ToolSummary,
} from "@cline/ui/components/agent-chat/tool-summary";
import type { WebviewChatMessage } from "../../../webview-protocol";

/** A tool call row as delivered on the chat transcript. */
export type ToolEvent = NonNullable<WebviewChatMessage["toolEvents"]>[number];

/**
 * One tool card to render: the structured summary drives the header and the
 * expanded details, `output`/`error` drive the output panel.
 */
export type ToolPresentation = {
	id: string;
	name: string;
	state: ToolEvent["state"];
	summary: ToolSummary;
	output: string;
	error?: string;
};

type ToolResultEntry = {
	query?: string;
	result?: string;
	success?: boolean;
};

/** `run_commands` reports one `{ query, result, success }` entry per command. */
export function isToolResultArray(value: unknown): value is ToolResultEntry[] {
	return (
		Array.isArray(value) &&
		value.length > 0 &&
		typeof value[0] === "object" &&
		value[0] !== null &&
		"result" in value[0]
	);
}

export function formatRawOutput(output: unknown, fallback: string): string {
	if (output == null) {
		return fallback;
	}
	if (typeof output === "string") {
		return output;
	}
	try {
		return JSON.stringify(output, null, 2);
	} catch {
		return String(output);
	}
}

/**
 * Turn one transcript tool event into the cards to render.
 *
 * Presentation comes from the shared `@cline/ui` tool-summary module — the
 * same path the desktop app uses — so the hub renders from the structured
 * `{ toolName, input, result }` payload instead of building a
 * `"toolName: summary"` string and parsing it back apart. That round trip is
 * what truncated `cd 'c:\repo'` to `cd 'c'`: the header split the title on
 * every colon and kept the second segment, cutting at the drive letter.
 *
 * A multi-command `run_commands` result yields one card per command, matching
 * the transcript's per-command entries.
 */
export function buildToolPresentations(
	toolEvent: ToolEvent,
): ToolPresentation[] {
	const inProgress = toolEvent.state === "input-available";

	if (isToolResultArray(toolEvent.output)) {
		return toolEvent.output.map((entry, index) => {
			const failed = entry.success === false;
			const summary = buildToolSummary({
				toolName: toolEvent.name,
				input: entry.query ? { commands: [entry.query] } : toolEvent.input,
				result: entry.result,
				isError: failed,
				inProgress,
			});
			return {
				id: `${toolEvent.id}-${index}`,
				name: toolEvent.name,
				state: failed ? "output-error" : toolEvent.state,
				summary,
				output: entry.result ?? (failed ? "(failed)" : "(no output)"),
				error: failed ? (entry.result ?? "failed") : toolEvent.error,
			};
		});
	}

	const summary = buildToolSummary({
		toolName: toolEvent.name,
		input: toolEvent.input,
		result: toolEvent.output,
		isError: toolEvent.state === "output-error",
		inProgress,
	});

	return [
		{
			id: toolEvent.id,
			name: toolEvent.name,
			state: toolEvent.state,
			summary,
			output:
				toolEvent.error ?? formatRawOutput(toolEvent.output, toolEvent.text),
			error: toolEvent.error,
		},
	];
}
