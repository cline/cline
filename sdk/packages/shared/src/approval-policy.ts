import type { AgentMode } from "./session/runtime-config";

export type ToolApprovalDecision =
	| "allow"
	| "require_approval"
	| "prohibited";

export interface ToolApprovalPolicyInput {
	toolName: string;
	mode?: AgentMode;
	input?: unknown;
	source?: "plugin";
}

const READ_ONLY_TOOL_NAMES = new Set([
	"read_files",
	"read_file",
	"list_files",
	"list_code_definition_names",
	"search_codebase",
	"search_files",
	"fetch_web_content",
	"web_fetch",
	"ask_question",
	"skills",
	"submit_and_exit",
	"team_check_status",
	"team_get_result",
	"team_await_runs",
]);

function completionRunsCommand(input: unknown): boolean {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		return false;
	}
	const command = (input as Record<string, unknown>).command;
	return typeof command === "string" && command.trim().length > 0;
}

/**
 * The single approval policy for agent tool execution.
 *
 * Unknown tools are treated as state-changing. This covers MCP and plugin
 * tools without trusting names or persisted configuration. Plan mode converts
 * every state-changing decision into a hard prohibition.
 */
export function getToolApprovalDecision({
	toolName,
	mode = "act",
	input,
	source,
}: ToolApprovalPolicyInput): ToolApprovalDecision {
	if (source === "plugin") {
		return mode === "plan" ? "prohibited" : "require_approval";
	}
	const readOnly =
		READ_ONLY_TOOL_NAMES.has(toolName) ||
		(toolName === "attempt_completion" && !completionRunsCommand(input));
	if (readOnly) {
		return "allow";
	}
	return mode === "plan" ? "prohibited" : "require_approval";
}
