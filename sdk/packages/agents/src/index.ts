/**
 * @bedrock-coder/agents
 *
 * Browser-safe agent runtime for the next-generation BedrockCoder SDK.
 *
 * Exports:
 *   - `AgentRuntime` / `Agent` — the agentic loop class (two names for the
 *     same class). Use `Agent` when supplying provider/model IDs, or
 *     `AgentRuntime` when supplying a pre-built `AgentModel`.
 *   - `createAgentRuntime` / `createAgent` — factory-function equivalents.
 *   - `AgentRuntimeConfig` and its two variants (`AgentRuntimeConfigWithModel`,
 *     `AgentRuntimeConfigWithProvider`) — the discriminated config union.
 *   - `AgentRunInput` / `AgentEventListener` — convenience type aliases.
 *   - `createTool` — re-exported from `@bedrock-coder/shared` for authoring tools.
 *
 * Shared types (`AgentMessage`, `AgentRunResult`, etc.) should be imported
 * directly from `@bedrock-coder/shared`.
 */

export type {
	AgentAfterToolResult,
	AgentBeforeModelResult,
	AgentBeforeToolResult,
	AgentMessage,
	AgentMessagePart,
	AgentModel,
	AgentModelFinishReason,
	AgentModelRequest,
	AgentRunResult,
	AgentRuntimeConfig as BaseAgentRuntimeConfig,
	AgentRuntimeEvent,
	AgentRuntimeHooks,
	AgentRuntimeStateSnapshot,
	AgentStopControl,
	AgentTool,
	AgentToolCallPart,
	AgentToolDefinition,
	AgentToolResult,
	AgentUsage,
	ToolApprovalResult,
	ToolPolicy,
} from "@bedrock-coder/shared";
export { createTool } from "@bedrock-coder/shared";
export type {
	AgentEventListener,
	AgentRunInput,
	AgentRuntimeConfig,
	AgentRuntimeConfigWithBedrock,
	AgentRuntimeConfigWithModel,
} from "./agent-runtime";
export {
	Agent,
	AgentRuntime,
	AgentRuntimeAbortError,
	createAgent,
	createAgentRuntime,
} from "./agent-runtime";
