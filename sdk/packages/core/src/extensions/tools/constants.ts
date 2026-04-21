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
];
