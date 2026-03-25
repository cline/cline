/**
 * @clinebot/agents
 *
 * Public API for building agentic loops.
 */

// =============================================================================
// Core Agent
// =============================================================================

export { Agent, createAgent } from "./agent.js";
export {
	ContributionRegistry,
	createContributionRegistry,
} from "./extensions.js";

// =============================================================================
// Tooling (consumer-facing)
// =============================================================================

export {
	type AskQuestionExecutor,
	type AskQuestionInput,
	AskQuestionInputSchema,
	type AskQuestionToolConfig,
	createAskQuestionTool,
	createTool,
	toToolDefinition,
	toToolDefinitions,
} from "./tools/index.js";

// =============================================================================
// Hooks
// =============================================================================

export {
	type HookDispatchInput,
	HookEngine,
	type HookHandler,
} from "./hooks/index.js";
export type {
	HookEventName,
	HookEventPayload,
	PersistentHookClientOptions,
	PersistentSubprocessHookControl,
	PersistentSubprocessHooksOptions,
	RunHookOptions,
	RunHookResult,
	RunSubprocessEventOptions,
	RunSubprocessEventResult,
	SubprocessHookControl,
	SubprocessHooksOptions,
} from "./hooks/node.js";
export {
	createPersistentSubprocessHooks,
	createSubprocessHooks,
	HookEventNameSchema,
	HookEventPayloadSchema,
	PersistentHookClient,
	parseHookEventPayload,
	runHook,
	runSubprocessEvent,
} from "./hooks/node.js";

// =============================================================================
// Prompts and formatting
// =============================================================================

export { formatFileContentBlock } from "@clinebot/shared";
export { getClineDefaultSystemPrompt } from "./prompts/index.js";

// =============================================================================
// Teams and spawn support
// =============================================================================

export {
	AgentTeamsRuntime,
	type AgentTeamsRuntimeOptions,
	type BootstrapAgentTeamsOptions,
	type BootstrapAgentTeamsResult,
	bootstrapAgentTeams,
	type CreateAgentTeamsToolsOptions,
	createAgentTeamsTools,
	createSpawnAgentTool,
	type SubAgentEndContext,
	type SubAgentStartContext,
	type TeamEvent,
	type TeammateLifecycleSpec,
	type TeamOutcome,
	type TeamOutcomeFragment,
	type TeamRunRecord,
	type TeamRunStatus,
	type TeamRuntimeState,
	type TeamTeammateRuntimeConfig,
	type TeamTeammateSpec,
} from "./teams/index.js";

// =============================================================================
// MCP bridge
// =============================================================================

export {
	type CreateDisabledMcpToolPoliciesOptions,
	type CreateDisabledMcpToolPolicyOptions,
	type CreateMcpToolsOptions,
	createDisabledMcpToolPolicies,
	createDisabledMcpToolPolicy,
	createMcpTools,
	type McpToolCallRequest,
	type McpToolCallResult,
	type McpToolDescriptor,
	type McpToolNameTransform,
	type McpToolProvider,
} from "./mcp/index.js";

// =============================================================================
// Public types
// =============================================================================

export {
	type AgentConfig,
	AgentConfigSchema,
	type AgentEvent,
	type AgentExtensionCommand,
	type AgentHooks,
	type AgentResult,
	AgentResultSchema,
	type AgentUsage,
	AgentUsageSchema,
	type BasicLogger,
	type ConsecutiveMistakeLimitContext,
	type ConsecutiveMistakeLimitDecision,
	type ContentBlock,
	type HookErrorMode,
	type Message,
	type ModelInfo,
	type Tool,
	type ToolApprovalRequest,
	type ToolApprovalResult,
	type ToolCallRecord,
	ToolCallRecordSchema,
	type ToolContext,
	ToolContextSchema,
	type ToolPolicy,
} from "./types.js";
