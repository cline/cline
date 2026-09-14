/**
 * Constants for Default Tools
 *
 * Tool name constants and utility arrays.
 */

import type { DefaultToolName } from "./types";

/**
 * Constants for default tool names
 */
export const DefaultToolNames = {
	READ_FILES: "read_files",
	SEARCH_CODEBASE: "search_codebase",
	RUN_COMMANDS: "run_commands",
	FETCH_WEB_CONTENT: "fetch_web_content",
	APPLY_PATCH: "apply_patch",
	EDITOR: "editor",
	SKILLS: "skills",
	ASK: "ask_question",
	SUBMIT_AND_EXIT: "submit_and_exit",
} as const;

/**
 * Array of all default tool names
 */
export const ALL_DEFAULT_TOOL_NAMES: DefaultToolName[] = [
	DefaultToolNames.READ_FILES,
	DefaultToolNames.SEARCH_CODEBASE,
	DefaultToolNames.RUN_COMMANDS,
	DefaultToolNames.FETCH_WEB_CONTENT,
	DefaultToolNames.APPLY_PATCH,
	DefaultToolNames.EDITOR,
	DefaultToolNames.SKILLS,
	DefaultToolNames.ASK,
	DefaultToolNames.SUBMIT_AND_EXIT,
];

/**
 * Default per-command timeout for `run_commands`, shared by the tool layer and
 * the shell executor's own kill timer so the two never disagree. Raised from
 * 30 s: on build/install/test-heavy work a 30 s cap produced 126 command
 * timeouts across 23 Terminal-Bench trials and pushed the model into
 * sleep-and-poll loops. 60 s covers most compiles and test runs while still
 * bounding a hung command in interactive use.
 */
export const DEFAULT_BASH_TIMEOUT_MS = 60_000;

/**
 * Per-command timeout for yolo (autonomous, non-interactive) mode, where no one
 * is waiting at a prompt and long builds are routine. Matches OpenCode's
 * default. Applied by the runtime builder to both the tool timer and the
 * executor timer; an explicit `bashTimeoutMs` still wins.
 */
export const YOLO_BASH_TIMEOUT_MS = 120_000;
