/**
 * Single tool-name → stage work category classifier (edit|command|test).
 * Used by hub work-from-tool and webview stageReducer demo path.
 */

export type StageWorkCategory = "edit" | "command" | "test";

export const STAGE_EDIT_TOOLS = new Set([
	"editor",
	"apply_patch",
	"write_to_file",
	"replace_in_file",
	"edit",
	"str_replace",
	"create_file",
]);

export const STAGE_COMMAND_TOOLS = new Set([
	"run_commands",
	"bash",
	"execute_command",
	"shell",
	"run_terminal_cmd",
]);

const TEST_NAME_RE =
	/\b(test|tests|vitest|jest|pytest|mocha|playwright|cypress|bun\s+test)\b/i;

export function looksLikeTestCommand(command: string | undefined): boolean {
	if (!command) {
		return false;
	}
	return TEST_NAME_RE.test(command);
}

/**
 * Classify a tool name (+ optional command text) into a stage work category.
 * Returns null for tools that should not create stage cards.
 */
export function classifyStageToolName(
	toolName: string,
	commandHint?: string,
): StageWorkCategory | null {
	const normalized = toolName.trim().toLowerCase();
	if (STAGE_EDIT_TOOLS.has(normalized)) {
		return "edit";
	}
	if (
		STAGE_COMMAND_TOOLS.has(normalized) ||
		normalized.includes("command") ||
		normalized === "bash"
	) {
		return looksLikeTestCommand(commandHint) ? "test" : "command";
	}
	if (normalized.includes("test")) {
		return "test";
	}
	return null;
}
