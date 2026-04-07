/**
 * @clinebot/agents
 *
 * Public API for building agentic loops.
 */

// =============================================================================
// Core Agent
// =============================================================================

export {
	ContributionRegistry,
	createContributionRegistry,
} from "@clinebot/shared";
export { Agent, createAgent } from "./agent";

// =============================================================================
// Public types
// =============================================================================

export {
	type AgentConfig,
	AgentConfigSchema,
	type AgentEvent,
	type AgentExtension,
	type AgentExtensionCommand,
	type AgentHooks,
	type AgentPrepareTurnContext,
	type AgentPrepareTurnResult,
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
