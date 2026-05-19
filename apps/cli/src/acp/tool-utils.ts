import type { ToolKind } from "@agentclientprotocol/sdk";
import { formatToolInput } from "../utils/helpers";

const TOOL_KIND_MAP: Record<string, ToolKind> = {
	Read: "read",
	read_files: "read",
	Glob: "search",
	Grep: "search",
	search_codebase: "search",
	Edit: "edit",
	Write: "edit",
	editor: "edit",
	Delete: "delete",
	Move: "move",
	Bash: "execute",
	run_commands: "execute",
	WebFetch: "fetch",
	fetch_web_content: "fetch",
	WebSearch: "search",
	Agent: "think",
	spawn_agent: "think",
	NotebookEdit: "edit",
	skills: "other",
};

export function mapToolKind(toolName: string): ToolKind {
	return TOOL_KIND_MAP[toolName] ?? "other";
}

/**
 * Build a human-readable title for a tool call so that IDE UIs show
 * something more useful than just the raw tool name.
 *
 * Delegates to {@link formatToolInput} for the input summary and
 * prefixes with the tool name when a summary is available.
 */
export function buildToolTitle(toolName: string, input: unknown): string {
	const summary = formatToolInput(toolName, input);
	if (!summary) return toolName;
	return `${toolName}: ${summary}`;
}
