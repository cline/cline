/**
 * @clinebot/agents
 *
 * Public API for building agentic loops.
 */

// =============================================================================
// Core Agent
// =============================================================================

export { Agent, createAgent } from "./agent";
export {
	ContributionRegistry,
	createContributionRegistry,
} from "./extensions";

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
} from "./tools/index";

// =============================================================================
// Hooks
// =============================================================================

export {
	type HookDispatchInput,
	HookEngine,
	type HookHandler,
} from "./hooks/index";
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
} from "./hooks/node";
export {
	createPersistentSubprocessHooks,
	createSubprocessHooks,
	HookEventNameSchema,
	HookEventPayloadSchema,
	PersistentHookClient,
	parseHookEventPayload,
	runHook,
	runSubprocessEvent,
} from "./hooks/node";

// =============================================================================
// Prompts and formatting
// =============================================================================

export { formatFileContentBlock } from "@clinebot/shared";
export { getClineDefaultSystemPrompt } from "./prompts/index";

// =============================================================================
// Teams and spawn support
// =============================================================================

export {
	AgentTeamsRuntime,
	type AgentTeamsRuntimeOptions,
	type BootstrapAgentTeamsOptions,
	type BootstrapAgentTeamsResult,
	bootstrapAgentTeams,
	buildDelegatedAgentConfig,
	type CreateAgentTeamsToolsOptions,
	createAgentTeamsTools,
	createDelegatedAgent,
	createDelegatedAgentConfigProvider,
	createSpawnAgentTool,
	type DelegatedAgentConfigProvider,
	type DelegatedAgentConnectionConfig,
	type DelegatedAgentRuntimeConfig,
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
} from "./teams/index";

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
} from "./mcp/index";

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
	type MessageWithMetadata,
	type ModelInfo,
	type Tool,
	type ToolApprovalRequest,
	type ToolApprovalResult,
	type ToolCallRecord,
	ToolCallRecordSchema,
	type ToolContext,
	ToolContextSchema,
	type ToolPolicy,
} from "./types";
