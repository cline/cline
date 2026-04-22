/**
 * Types and Zod Schemas for the Agent Package
 *
 * Re-exports canonical agent types from @clinebot/shared.
 * ModelInfo now lives in shared; ProviderConfig remains opaque (`unknown`)
 * in the shared definition and is narrowed here for consumers that need it.
 */

import type * as LlmsProviders from "@clinebot/llms";

// =============================================================================
// Re-export all agent types from shared (canonical source)
// =============================================================================

export type {
	AgentConfig,
	AgentContentEndEvent,
	AgentContentStartEvent,
	AgentContentType,
	AgentContentUpdateEvent,
	AgentDoneEvent,
	AgentErrorEvent,
	AgentEvent,
	AgentEventMetadata,
	AgentExecutionConfig,
	AgentExtension,
	AgentExtensionBeforeAgentStartContext,
	AgentExtensionBeforeAgentStartControl,
	AgentExtensionInputContext,
	AgentExtensionRuntimeEventContext,
	AgentExtensionSessionShutdownContext,
	AgentExtensionSessionStartContext,
	AgentFinishReason,
	AgentHookBeforeAgentStartContext,
	AgentHookControl,
	AgentHookErrorContext,
	AgentHookIterationEndContext,
	AgentHookIterationStartContext,
	AgentHookRunEndContext,
	AgentHookRunStartContext,
	AgentHookScheduleContext,
	AgentHookSessionShutdownContext,
	AgentHookSessionStartContext,
	AgentHookStopErrorContext,
	AgentHooks,
	AgentHookToolCallEndContext,
	AgentHookToolCallStartContext,
	AgentHookTurnEndContext,
	AgentHookTurnStartContext,
	AgentIterationEndEvent,
	AgentIterationStartEvent,
	AgentLoopExtensionRegistry,
	AgentNoticeEvent,
	AgentPrepareTurnContext,
	AgentPrepareTurnResult,
	AgentResult,
	AgentUsage,
	AgentUsageEvent,
	ConsecutiveMistakeLimitContext,
	ConsecutiveMistakeLimitDecision,
	HookErrorMode,
	LoopDetectionConfig,
	ModelInfo,
	PendingToolCall,
	ProcessedTurn,
	ReasoningEffort,
	SessionWorkspaceEnv,
} from "@clinebot/shared";
export {
	AgentConfigSchema,
	AgentFinishReasonSchema,
	AgentResultSchema,
	AgentUsageSchema,
	ReasoningEffortSchema,
} from "@clinebot/shared";

// =============================================================================
// Re-exports from shared for backward compatibility
// =============================================================================

export type {
	AgentExtensionApi,
	AgentExtensionCapability,
	AgentExtensionCommand,
	AgentExtensionHookStage,
	AgentExtensionMessageBuilder,
	AgentExtensionProvider,
	BasicLogger,
	ContributionRegistryExtension,
	ExtensionContext,
	HookControl,
	HookDispatchResult,
	HookEventEnvelope,
	HookPolicies,
	HookStage,
	HookStagePolicy,
	HookStagePolicyInput,
	Tool,
	ToolApprovalRequest,
	ToolApprovalResult,
	ToolCallRecord,
	ToolContext,
	ToolPolicy,
} from "@clinebot/shared";
export { ToolCallRecordSchema, ToolContextSchema } from "@clinebot/shared";

// =============================================================================
// Re-exports from shared message types for convenience
// =============================================================================

export type {
	ContentBlock,
	MessageWithMetadata,
	ToolDefinition,
} from "@clinebot/shared";

// =============================================================================
// Provider-specific type alias (narrowed from @clinebot/llms)
// =============================================================================

export type AgentExtensionRegistry =
	import("@clinebot/shared").AgentExtensionRegistry<
		import("@clinebot/shared").Tool,
		LlmsProviders.Message
	>;
