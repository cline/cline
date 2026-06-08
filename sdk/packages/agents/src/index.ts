/**
 * @cline/agents
 *
 * Browser-safe agent runtime for the next-generation Cline SDK.
 *
 * Exports:
 *   - `AgentRuntime` / `Agent` — the agentic loop class (two names for the
 *     same class). Use `Agent` when supplying provider/model IDs, or
 *     `AgentRuntime` when supplying a pre-built `AgentModel`.
 *   - `createAgentRuntime` / `createAgent` — factory-function equivalents.
 *   - `AgentRuntimeConfig` and its two variants (`AgentRuntimeConfigWithModel`,
 *     `AgentRuntimeConfigWithProvider`) — the discriminated config union.
 *   - `AgentRunInput` / `AgentEventListener` — convenience type aliases.
 *   - `createTool` — re-exported from `@cline/shared` for authoring tools.
 *
 * Shared types (`AgentMessage`, `AgentRunResult`, etc.) should be imported
 * directly from `@cline/shared`.
 */

export type {
	AgentAfterToolResult,
	AgentBeforeModelResult,
	AgentBeforeToolResult,
	AgentErrorInfo,
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
	AuthErrorInfo,
	ErrorWithInfo,
	ProviderErrorInfo,
	ToolApprovalResult,
	ToolPolicy,
} from "@cline/shared";
export {
	CLINE_ACCOUNT_AUTH_REQUIRED_CODE,
	CLINE_INSUFFICIENT_CREDITS_CODE,
	createClineAccountAuthRequiredError,
	createErrorWithInfo,
	createTool,
	getErrorInfo,
	isAgentErrorInfo,
	isAuthErrorInfo,
	isClineAccountAuthRequiredErrorInfo,
	isClineInsufficientCreditsErrorInfo,
	isProviderErrorInfo,
} from "@cline/shared";
export type {
	AgentEventListener,
	AgentRunInput,
	AgentRuntimeConfig,
	AgentRuntimeConfigWithModel,
	AgentRuntimeConfigWithProvider,
} from "./agent-runtime";
export {
	Agent,
	AgentRuntime,
	AgentRuntimeAbortError,
	createAgent,
	createAgentRuntime,
} from "./agent-runtime";
