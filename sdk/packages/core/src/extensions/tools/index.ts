/**
 * Default Tools
 *
 * This module provides a set of configurable default tools for agents.
 */

// Zod Utilities
export { validateWithZod, zodToJsonSchema } from "@cline/shared";
// Constants
export { ALL_DEFAULT_TOOL_NAMES, DefaultToolNames } from "./constants";
// AgentTool Definitions
export {
	createApplyPatchTool,
	createAskQuestionTool,
	createDefaultTools,
	createEditorTool,
	createReadFilesTool,
	createSearchTool,
	createShellTool,
	createSkillsTool,
	createSubmitAndExitTool,
	createWebFetchTool,
} from "./definitions";
// Built-in Executors
export {
	type ApplyPatchExecutorOptions,
	CommandExitError,
	computePatchChanges,
	createApplyPatchExecutor,
	createDefaultExecutors,
	createDefaultShellExecutor,
	createEditorExecutor,
	createFileReadExecutor,
	createSearchExecutor,
	createShellExecutor,
	createWebFetchExecutor,
	type DefaultExecutorsOptions,
	type EditorExecutorOptions,
	type FileReadExecutorOptions,
	PatchActionType,
	type PatchFileChange,
	type SearchExecutorOptions,
	type ShellExecutorOptions,
	type WebFetchExecutorOptions,
} from "./executors/index";
export {
	MAX_COMMAND_OUTPUT_CHARS,
	truncateCommandOutput,
} from "./executors/output-limits";
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
export {
	type BuiltinToolAvailabilityContext,
	getCoreAcpToolNames,
	getCoreBuiltinToolCatalog,
	getCoreDefaultEnabledToolIds,
	getCoreHeadlessToolNames,
	resolveCoreSelectedToolIds,
	type ToolCatalogEntry,
} from "./runtime";
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
	type StructuredCommandInput,
	StructuredCommandInputSchema,
	type SubmitInput,
	SubmitInputSchema,
	type WebFetchRequest,
	WebFetchRequestSchema,
} from "./schemas";
export { TEAM_TOOL_NAMES } from "./team/team-tools";
// Types
export type {
	ApplyPatchExecutor,
	AskQuestionExecutor,
	CreateDefaultToolsOptions,
	DefaultToolName,
	DefaultToolsConfig,
	EditorExecutor,
	FileReadExecutor,
	SearchExecutor,
	ShellExecutor,
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

import { type AgentTool, getDefaultShell } from "@cline/shared";
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
	 * Configuration for the built-in executors. `bash.shell` is used when the
	 * top-level `shell` option is not set; the top-level option takes precedence.
	 */
	executorOptions?: DefaultExecutorsOptions;
	/**
	 * Optional executor overrides/additions for tools without built-ins.
	 * An overriding `bash` executor replaces the built-in one wholesale: it
	 * decides its own shell, and the resolved `shell` option only shapes the
	 * run_commands description. Overriders must honor that shell themselves
	 * to keep the description truthful.
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
 * import { Agent, createBuiltinTools } from "@cline/core"
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
): AgentTool[] {
	const {
		executorOptions = {},
		executors: executorOverrides,
		...toolsConfig
	} = options;
	// The top-level shell is the public tool configuration and takes precedence
	// over the legacy executor-specific location. Resolve it once so prompting
	// and execution cannot disagree.
	const shell =
		toolsConfig.shell ??
		executorOptions.bash?.shell ??
		getDefaultShell(process.platform);
	const resolvedExecutorOptions: DefaultExecutorsOptions = {
		...executorOptions,
		bash: {
			...executorOptions.bash,
			shell,
		},
	};

	const executors = {
		...createDefaultExecutors(resolvedExecutorOptions),
		...(executorOverrides ?? {}),
	};

	return createDefaultTools({
		...toolsConfig,
		shell,
		executors,
	});
}
