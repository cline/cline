/**
 * Default Tools
 *
 * This module provides a set of configurable default tools for agents.
 */

// Zod Utilities
export { validateWithZod, zodToJsonSchema } from "@clinebot/shared";
// Constants
export { ALL_DEFAULT_TOOL_NAMES, DefaultToolNames } from "./constants";
// Tool Definitions
export {
	createApplyPatchTool,
	createAskQuestionTool,
	createBashTool,
	createDefaultTools,
	createEditorTool,
	createReadFilesTool,
	createSearchTool,
	createSkillsTool,
	createSubmitAndExitTool,
	createWebFetchTool,
	createWindowsShellTool,
} from "./definitions";
// Built-in Executors
export {
	type ApplyPatchExecutorOptions,
	type BashExecutorOptions,
	createApplyPatchExecutor,
	createBashExecutor,
	createDefaultExecutors,
	createEditorExecutor,
	createFileReadExecutor,
	createSearchExecutor,
	createWebFetchExecutor,
	type DefaultExecutorsOptions,
	type EditorExecutorOptions,
	type FileReadExecutorOptions,
	type SearchExecutorOptions,
	type WebFetchExecutorOptions,
} from "./executors/index";
export {
	DEFAULT_MODEL_TOOL_ROUTING_RULES,
	resolveToolRoutingConfig,
	type ToolRoutingRule,
} from "./model-tool-routing";
// Presets
export {
	createDefaultToolsWithPreset,
	createToolPoliciesWithPreset,
	resolveToolPresetName,
	type ToolPolicyPresetName,
	type ToolPresetName,
	ToolPresets,
} from "./presets";
// Schemas
export {
	type ApplyPatchInput,
	ApplyPatchInputSchema,
	type AskQuestionInput,
	AskQuestionInputSchema,
	type EditFileInput,
	EditFileInputSchema,
	type FetchWebContentInput,
	FetchWebContentInputSchema,
	type ReadFileRequest,
	ReadFileRequestSchema,
	type ReadFilesInput,
	ReadFilesInputSchema,
	type RunCommandsInput,
	RunCommandsInputSchema,
	type SearchCodebaseInput,
	SearchCodebaseInputSchema,
	type SkillsInput,
	SkillsInputSchema,
	type SubmitInput,
	SubmitInputSchema,
	type WebFetchRequest,
	WebFetchRequestSchema,
} from "./schemas";
// Types
export type {
	ApplyPatchExecutor,
	AskQuestionExecutor,
	BashExecutor,
	CreateDefaultToolsOptions,
	DefaultToolName,
	DefaultToolsConfig,
	EditorExecutor,
	FileReadExecutor,
	SearchExecutor,
	SkillsExecutor,
	SkillsExecutorSkillMetadata,
	SkillsExecutorWithMetadata,
	ToolExecutors,
	ToolOperationResult,
	VerifySubmitExecutor,
	WebFetchExecutor,
} from "./types";

// =============================================================================
// Convenience: Create Tools with Built-in Executors
// =============================================================================

import type { Tool } from "@clinebot/shared";
import { createDefaultTools } from "./definitions";
import {
	createDefaultExecutors,
	type DefaultExecutorsOptions,
} from "./executors/index";
import type { CreateDefaultToolsOptions, ToolExecutors } from "./types";

/**
 * Options for creating default tools with built-in executors
 */
export interface CreateBuiltinToolsOptions
	extends Omit<CreateDefaultToolsOptions, "executors"> {
	/**
	 * Configuration for the built-in executors
	 */
	executorOptions?: DefaultExecutorsOptions;
	/**
	 * Optional executor overrides/additions for tools without built-ins
	 */
	executors?: Partial<ToolExecutors>;
}

/**
 * Create default tools with built-in Node.js executors
 *
 * This is a convenience function that creates the default tools with
 * working implementations using Node.js built-in modules.
 *
 * @example
 * ```typescript
 * import { Agent } from "@clinebot/agents"
 * import { createBuiltinTools } from "@clinebot/core"
 *
 * const tools = createBuiltinTools({
 *   cwd: "/path/to/project",
 *   enableBash: true,
 *   enableWebFetch: false, // Disable web fetching
 *   executorOptions: {
 *     bash: { timeoutMs: 60000 },
 *   },
 * })
 *
 * const agent = new Agent({
 *   providerId: "anthropic",
 *   modelId: "claude-sonnet-4-20250514",
 *   systemPrompt: "You are a coding assistant.",
 *   tools,
 * })
 * ```
 */
export function createBuiltinTools(
	options: CreateBuiltinToolsOptions = {},
): Tool[] {
	const {
		executorOptions = {},
		executors: executorOverrides,
		...toolsConfig
	} = options;

	const executors = {
		...createDefaultExecutors(executorOptions),
		...(executorOverrides ?? {}),
	};

	return createDefaultTools({
		...toolsConfig,
		executors,
	});
}
