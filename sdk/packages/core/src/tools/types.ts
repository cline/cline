/**
 * Types for Default Tools
 *
 * Type definitions for executors, configuration, and results.
 */

import type { ToolContext } from "@clinebot/agents";
import type {
	ApplyPatchInput,
	EditFileInput,
	ReadFileRequest,
} from "./schemas";

// =============================================================================
// Tool Result Types
// =============================================================================

/**
 * Result from a single tool operation
 */
export interface ToolOperationResult {
	/** The query/input that was executed */
	query: string;
	/** The result content (if successful) */
	result: string;
	/** Error message (if failed) */
	error?: string;
	/** Whether the operation succeeded */
	success: boolean;
	/** Duration in MS */
	duration?: number;
}

// =============================================================================
// Executor Interfaces
// =============================================================================

/**
 * Executor for reading files
 *
 * @param request - File path and optional inclusive line range to read
 * @param context - Tool execution context
 * @returns The file content as a string
 */
export type FileReadExecutor = (
	request: ReadFileRequest,
	context: ToolContext,
) => Promise<string>;

/**
 * Executor for searching the codebase
 *
 * @param query - Regex pattern to search for
 * @param cwd - Current working directory for the search
 * @param context - Tool execution context
 * @returns Search results as a formatted string
 */
export type SearchExecutor = (
	query: string,
	cwd: string,
	context: ToolContext,
) => Promise<string>;

/**
 * Executor for running shell commands
 *
 * @param command - Shell command to execute
 * @param cwd - Current working directory for execution
 * @param context - Tool execution context
 * @returns Command output (stdout)
 */
export type BashExecutor = (
	command: string,
	cwd: string,
	context: ToolContext,
) => Promise<string>;

/**
 * Executor for fetching web content
 *
 * @param url - URL to fetch
 * @param prompt - Analysis prompt for the content
 * @param context - Tool execution context
 * @returns Analyzed/extracted content
 */
export type WebFetchExecutor = (
	url: string,
	prompt: string,
	context: ToolContext,
) => Promise<string>;

/**
 * Executor for editing files
 *
 * @param input - Editor command input
 * @param cwd - Current working directory for filesystem operations
 * @param context - Tool execution context
 * @returns A formatted operation result string
 */
export type EditorExecutor = (
	input: EditFileInput,
	cwd: string,
	context: ToolContext,
) => Promise<string>;

/**
 * Executor for apply_patch operations
 *
 * @param input - apply_patch command payload
 * @param cwd - Current working directory for filesystem operations
 * @param context - Tool execution context
 * @returns A formatted operation result string
 */
export type ApplyPatchExecutor = (
	input: ApplyPatchInput,
	cwd: string,
	context: ToolContext,
) => Promise<string>;

/**
 * Executor for invoking configured skills
 *
 * @param skill - Skill name to invoke
 * @param args - Optional arguments for the skill
 * @param context - Tool execution context
 * @returns Skill loading/invocation result
 */
export type SkillsExecutor = (
	skill: string,
	args: string | undefined,
	context: ToolContext,
) => Promise<string>;

/**
 * Executor for asking a single follow-up question with selectable options
 *
 * @param question - Single clarifying question for the user
 * @param options - 2-5 selectable answer options
 * @param context - Tool execution context
 * @returns Executor-specific result payload
 */
export type AskQuestionExecutor = (
	question: string,
	options: string[],
	context: ToolContext,
) => Promise<string>;

/**
 * Skill metadata exposed by SkillsExecutor for clients/UI
 */
export interface SkillsExecutorSkillMetadata {
	/** Normalized skill id (usually lowercased name) */
	id: string;
	/** Display name for the skill */
	name: string;
	/** Optional short description */
	description?: string;
	/** True when configured but intentionally disabled */
	disabled: boolean;
}

/**
 * A callable executor that can also expose configured skill metadata.
 */
export interface SkillsExecutorWithMetadata {
	(
		skill: string,
		args: string | undefined,
		context: ToolContext,
	): Promise<string>;
	configuredSkills?: SkillsExecutorSkillMetadata[];
}

/**
 * Collection of all tool executors
 */
export interface ToolExecutors {
	/** File reading implementation */
	readFile?: FileReadExecutor;
	/** Codebase search implementation */
	search?: SearchExecutor;
	/** Shell command execution implementation */
	bash?: BashExecutor;
	/** Web content fetching implementation */
	webFetch?: WebFetchExecutor;
	/** Filesystem editor implementation */
	editor?: EditorExecutor;
	/** Apply patch implementation */
	applyPatch?: ApplyPatchExecutor;
	/** Skill invocation implementation */
	skills?: SkillsExecutorWithMetadata;
	/** Follow-up question implementation */
	askQuestion?: AskQuestionExecutor;
}

// =============================================================================
// Tool Configuration
// =============================================================================

/**
 * Names of available default tools
 */
export type DefaultToolName =
	| "read_files"
	| "search_codebase"
	| "run_commands"
	| "fetch_web_content"
	| "apply_patch"
	| "editor"
	| "skills"
	| "ask_question";

/**
 * Configuration for enabling/disabling default tools
 */
export interface DefaultToolsConfig {
	/**
	 * Enable the read_files tool
	 * @default true
	 */
	enableReadFiles?: boolean;

	/**
	 * Enable the search_codebase tool
	 * @default true
	 */
	enableSearch?: boolean;

	/**
	 * Enable the run_commands tool
	 * @default true
	 */
	enableBash?: boolean;

	/**
	 * Enable the fetch_web_content tool
	 * @default true
	 */
	enableWebFetch?: boolean;

	/**
	 * Enable the apply_patch tool
	 * @default true
	 */
	enableApplyPatch?: boolean;

	/**
	 * Enable the editor tool
	 * @default true
	 */
	enableEditor?: boolean;

	/**
	 * Enable the skills tool
	 * @default true
	 */
	enableSkills?: boolean;

	/**
	 * Enable the ask_followup_question tool
	 * @default true
	 */
	enableAskQuestion?: boolean;

	/**
	 * Current working directory for tools that need it
	 */
	cwd?: string;

	/**
	 * Timeout for file read operations in milliseconds
	 * @default 10000
	 */
	fileReadTimeoutMs?: number;

	/**
	 * Timeout for bash command execution in milliseconds
	 * @default 30000
	 */
	bashTimeoutMs?: number;

	/**
	 * Timeout for web fetch operations in milliseconds
	 * @default 30000
	 */
	webFetchTimeoutMs?: number;

	/**
	 * Timeout for search operations in milliseconds
	 * @default 30000
	 */
	searchTimeoutMs?: number;

	/**
	 * Timeout for apply_patch operations in milliseconds
	 * @default 30000
	 */
	applyPatchTimeoutMs?: number;

	/**
	 * Timeout for editor operations in milliseconds
	 * @default 30000
	 */
	editorTimeoutMs?: number;

	/**
	 * Timeout for skills operations in milliseconds
	 * @default 15000
	 */
	skillsTimeoutMs?: number;

	/**
	 * Timeout for ask_followup_question operations in milliseconds
	 * @default 15000
	 */
	askQuestionTimeoutMs?: number;
}

/**
 * Options for creating default tools
 */
export interface CreateDefaultToolsOptions extends DefaultToolsConfig {
	/**
	 * Executor implementations for the tools
	 * Only tools with provided executors will be available
	 */
	executors: ToolExecutors;
}
