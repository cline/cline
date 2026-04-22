/**
 * Agent Types and Zod Schemas
 *
 * Canonical type definitions for agent configuration, events, hooks,
 * extensions, and results.
 *
 * ProviderConfig is left as `unknown` here so that shared stays
 * dependency-free of @clinebot/llms. Consuming packages narrow it
 * via re-exports. ModelInfo lives in shared (../llms/model-info)
 * and is used directly.
 */

import { z } from "zod";
import type { ExtensionContext } from "../extensions/context";
import type {
	AgentExtensionApi,
	AgentExtensionRegistry as AgentExtensionRegistryGeneric,
	ContributionRegistryExtension,
	PluginManifest,
} from "../extensions/contribution-registry";
import type { HookControl, HookPolicies } from "../hooks/contracts";
import type { Message, MessageWithMetadata } from "../llms/messages";
import type { ModelInfo } from "../llms/model-info";
import { ModelInfoSchema } from "../llms/model-info";
import type {
	Tool,
	ToolApprovalRequest,
	ToolApprovalResult,
	ToolCallRecord,
	ToolPolicy,
} from "../llms/tools";
import { ToolCallRecordSchema } from "../llms/tools";
import type { BasicLogger } from "../logging/logger";
import type { ITelemetryService } from "../services/telemetry";
import type { WorkspaceInfo } from "../session/workspace";

// =============================================================================
// Agent Events
// =============================================================================

/**
 * Events emitted during agent execution
 */
export type AgentEvent =
	| AgentContentStartEvent
	| AgentContentUpdateEvent
	| AgentContentEndEvent
	| AgentIterationStartEvent
	| AgentIterationEndEvent
	| AgentNoticeEvent
	| AgentUsageEvent
	| AgentDoneEvent
	| AgentErrorEvent;

export type AgentContentType = "text" | "reasoning" | "tool";

export interface AgentEventMetadata {
	/** Current ID */
	agentId?: string;
	/** Task ID */
	conversationId?: string;
	/** ID of the agent that created this agent */
	parentAgentId?: string | null;
}

export interface AgentContentStartEvent extends AgentEventMetadata {
	type: "content_start";
	contentType: AgentContentType;
	/** The text chunk received from the model */
	text?: string;
	/** Accumulated text so far in this turn */
	accumulated?: string;
	/** The reasoning/thinking text from the model */
	reasoning?: string;
	/** Whether this is redacted reasoning */
	redacted?: boolean;
	/** Name of the tool being called */
	toolName?: string;
	/** Unique identifier for this tool call */
	toolCallId?: string;
	/** Input being passed to the tool */
	input?: unknown;
}

export interface AgentContentUpdateEvent extends AgentEventMetadata {
	type: "content_update";
	contentType: "tool";
	/** Name of the tool emitting progress */
	toolName?: string;
	/** Unique identifier for this tool call */
	toolCallId?: string;
	/** Partial result emitted by the tool */
	update: unknown;
}

export interface AgentContentEndEvent extends AgentEventMetadata {
	type: "content_end";
	contentType: AgentContentType;
	/** Final text generated for this turn */
	text?: string;
	/** Final reasoning/thinking text generated for this turn */
	reasoning?: string;
	/** Name of the tool that completed */
	toolName?: string;
	/** Unique identifier for this tool call */
	toolCallId?: string;
	/** Output from the tool */
	output?: unknown;
	/** Error message if the tool failed */
	error?: string;
	/** Time taken in milliseconds for tool content */
	durationMs?: number;
}

export interface AgentIterationStartEvent extends AgentEventMetadata {
	type: "iteration_start";
	/** The iteration number (1-based) */
	iteration: number;
}

export interface AgentIterationEndEvent extends AgentEventMetadata {
	type: "iteration_end";
	/** The iteration number that just completed */
	iteration: number;
	/** Whether this iteration had any tool calls */
	hadToolCalls: boolean;
	/** Number of tool calls in this iteration */
	toolCallCount: number;
}

export interface AgentUsageEvent extends AgentEventMetadata {
	type: "usage";
	/** Number of input tokens for this turn */
	inputTokens: number;
	/** Number of output tokens for this turn */
	outputTokens: number;
	/** Tokens read from cache */
	cacheReadTokens?: number;
	/** Tokens written to cache */
	cacheWriteTokens?: number;
	/** Cost for this turn */
	cost?: number;

	/** Accumulated totals */
	totalInputTokens: number;
	totalCacheReadTokens?: number;
	totalCacheWriteTokens?: number;
	totalOutputTokens: number;
	totalCost?: number;
}

export interface AgentNoticeEvent extends AgentEventMetadata {
	type: "notice";
	noticeType: "recovery" | "stop" | "status";
	message: string;
	displayRole?: "system" | "status";
	reason?:
		| "api_error"
		| "invalid_tool_call"
		| "completion_without_submit"
		| "tool_execution_failed"
		| "mistake_limit"
		| "auto_compaction";
	metadata?: Record<string, unknown>;
}

export interface AgentDoneEvent extends AgentEventMetadata {
	type: "done";
	/** The reason the agent stopped */
	reason: AgentFinishReason;
	/** Final text output */
	text: string;
	/** Total number of iterations */
	iterations: number;
	/** Aggregated usage information */
	usage?: AgentUsage;
}

export interface AgentErrorEvent extends AgentEventMetadata {
	type: "error";
	/** The error that occurred */
	error: Error;
	/** Whether the error is recoverable */
	recoverable: boolean;
	/** Current iteration when error occurred */
	iteration: number;
}

export interface ConsecutiveMistakeLimitContext {
	iteration: number;
	consecutiveMistakes: number;
	maxConsecutiveMistakes: number;
	reason: "api_error" | "invalid_tool_call" | "tool_execution_failed";
	details?: string;
}

export type ConsecutiveMistakeLimitDecision =
	| {
			action: "continue";
			/**
			 * Optional guidance appended as a user message before continuing.
			 */
			guidance?: string;
	  }
	| {
			action: "stop";
			/**
			 * Optional reason surfaced when stopping due to the limit.
			 */
			reason?: string;
	  };

export interface LoopDetectionConfig {
	softThreshold: number;
	hardThreshold: number;
}

export interface AgentExecutionConfig {
	/**
	 * Maximum consecutive internal mistakes before escalation.
	 * Mistakes include API turn failures, invalid/missing tool-call arguments,
	 * and iterations where every executed tool call fails.
	 * @default 6
	 */
	maxConsecutiveMistakes?: number;
	/**
	 * After this many consecutive iterations with tool calls,
	 * inject a reminder text block asking the agent to answer if it has enough info.
	 * Set to `0` or omit to disable.
	 * @default 0
	 */
	reminderAfterIterations?: number;
	/**
	 * Custom reminder text to inject after `reminderAfterIterations`.
	 * @default "REMINDER: If you have gathered enough information to answer the user's question, please provide your final answer now without using any more tools."
	 */
	reminderText?: string;
	/**
	 * Repeated tool call loop detection. When enabled, the agent detects
	 * consecutive identical tool calls and intervenes:
	 * - At `softThreshold`: injects a recovery notice urging a different approach.
	 * - At `hardThreshold`: triggers the consecutive-mistake-limit decision path.
	 *
	 * Set to `false` to explicitly disable. Omit or leave `undefined` for no detection.
	 * The CLI enables this by default with `{ softThreshold: 3, hardThreshold: 5 }`.
	 */
	loopDetection?: false | Partial<LoopDetectionConfig>;
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * Hook error handling behavior.
 * - "ignore": swallow hook errors and continue agent execution
 * - "throw": fail agent execution when a hook throws
 */
export type HookErrorMode = "ignore" | "throw";

/**
 * Common controls supported by lifecycle hooks.
 */
export type AgentHookControl = Omit<HookControl, "appendMessages"> & {
	/**
	 * Optional messages appended to history.
	 * Primarily used by before-agent-start hook stages.
	 */
	appendMessages?: Message[];
	/**
	 * Optional replacement message history.
	 * Primarily used by before-agent-start hooks and host-owned context pipelines.
	 */
	replaceMessages?: Message[];
};

export interface AgentHookRunStartContext {
	/**
	 * ID of the agent
	 */
	agentId: string;
	/**
	 * Session ID
	 */
	conversationId: string;
	/**
	 * ID of the agent that spawned the agent that is executing this run
	 */
	parentAgentId: string | null;
	/**
	 * The prompt submitted by user
	 */
	userMessage: string;
}

export interface AgentHookScheduleContext {
	scheduleId: string;
	executionId?: string;
	trigger: "scheduled" | "manual";
	triggeredAt?: string;
}

/**
 * Workspace location fields shared by session-scoped and run-scoped contexts.
 *
 * These fields are always sourced from the host session config — never from
 * `process.cwd()`. Plugins and hooks must use these values when they need to
 * resolve paths relative to the session's working directory or project root,
 * because the `--cwd` CLI flag sets the session cwd without calling
 * `process.chdir()`, so `process.cwd()` may return the wrong path.
 */
export interface SessionWorkspaceEnv {
	/**
	 * The session's active working directory as configured by the host (e.g.
	 * via `--cwd`). Always accurate — never use `process.cwd()` in plugins or
	 * hooks; use this field instead.
	 */
	cwd?: string;
	/**
	 * The workspace / project root when it differs from `cwd`. Global plugins
	 * installed outside the project should use this rather than
	 * `import.meta.url` tricks or `process.cwd()`.
	 */
	workspaceRoot?: string;
	/**
	 * Structured workspace and git metadata for the session.
	 *
	 * Contains the same information as the `{{CLINE_METADATA}}` block in the
	 * system prompt but in structured form: `rootPath`, `hint`,
	 * `associatedRemoteUrls`, `latestGitCommitHash`, `latestGitBranchName`.
	 *
	 * Plugins and hooks can use this for branch-aware logic, commit
	 * attribution, or tooling integrations without running their own `git`
	 * calls. Populated once per session at session-start time.
	 */
	workspaceInfo?: WorkspaceInfo;
}

/**
 * Fired exactly once for the lifetime of an agent conversation, before the
 * first run starts. This is the right place for session-scoped setup.
 */
export interface AgentHookSessionStartContext extends SessionWorkspaceEnv {
	agentId: string;
	conversationId: string;
	parentAgentId: string | null;
	schedule?: AgentHookScheduleContext;
}

/**
 * Fired once per `run()` / `continue()` invocation after user input has been
 * accepted and before the loop enters its first iteration.
 */
export interface AgentHookRunEndContext {
	agentId: string;
	conversationId: string;
	parentAgentId: string | null;
	result: AgentResult;
}

/**
 * Fired at the top of every loop iteration, before any turn-level prompt or
 * model preparation occurs.
 */
export interface AgentHookIterationStartContext {
	agentId: string;
	conversationId: string;
	parentAgentId: string | null;
	iteration: number;
}

export interface AgentHookIterationEndContext {
	agentId: string;
	conversationId: string;
	parentAgentId: string | null;
	iteration: number;
	hadToolCalls: boolean;
	toolCallCount: number;
}

export interface AgentHookTurnStartContext {
	agentId: string;
	conversationId: string;
	parentAgentId: string | null;
	iteration: number;
	messages: Message[];
}

/**
 * Fired immediately before the model call for an iteration.
 *
 * Compared with `onIterationStart`, this hook runs later: after turn-start
 * processing and with the exact message list that will be sent to the model.
 * It can still influence the upcoming turn by replacing the system prompt,
 * appending messages, or cancelling the run.
 */
export interface AgentHookBeforeAgentStartContext {
	agentId: string;
	conversationId: string;
	parentAgentId: string | null;
	iteration: number;
	systemPrompt: string;
	messages: Message[];
}

export interface AgentHookTurnEndContext {
	agentId: string;
	conversationId: string;
	parentAgentId: string | null;
	iteration: number;
	turn: ProcessedTurn;
}

export interface AgentHookToolCallStartContext {
	agentId: string;
	conversationId: string;
	parentAgentId: string | null;
	iteration: number;
	call: PendingToolCall;
}

export interface AgentHookToolCallEndContext {
	agentId: string;
	conversationId: string;
	parentAgentId: string | null;
	iteration: number;
	record: ToolCallRecord;
}

export interface AgentHookErrorContext {
	agentId: string;
	conversationId: string;
	parentAgentId: string | null;
	iteration: number;
	error: Error;
}

export interface AgentHookStopErrorContext {
	agentId: string;
	conversationId: string;
	parentAgentId: string | null;
	iteration: number;
	error: Error;
}

export interface AgentHookSessionShutdownContext {
	agentId: string;
	conversationId: string;
	parentAgentId: string | null;
	/**
	 * Optional reason for shutdown (e.g. "ctrl_d", "process_exit")
	 */
	reason?: string;
}

// =============================================================================
// Extensions
// =============================================================================

export interface AgentExtensionRuntimeEventContext {
	agentId: string;
	conversationId: string;
	parentAgentId: string | null;
	event: AgentEvent;
}

export interface AgentExtensionSessionStartContext extends SessionWorkspaceEnv {
	agentId: string;
	conversationId: string;
	parentAgentId: string | null;
	schedule?: AgentHookScheduleContext;
}

export interface AgentExtensionSessionShutdownContext {
	agentId: string;
	conversationId: string;
	parentAgentId: string | null;
	reason?: string;
}

export interface AgentExtensionInputContext {
	agentId: string;
	conversationId: string;
	parentAgentId: string | null;
	mode: "run" | "continue";
	input: string;
}

export interface AgentExtensionBeforeAgentStartContext {
	agentId: string;
	conversationId: string;
	parentAgentId: string | null;
	iteration: number;
	systemPrompt: string;
	messages: Message[];
}

export type AgentExtensionBeforeAgentStartControl = Omit<
	AgentHookControl,
	"appendMessages"
> & {
	systemPrompt?: string;
	appendMessages?: Message[];
};

export interface AgentExtensionContext {
	workspaceInfo?: WorkspaceInfo;
}

export interface AgentExtension extends ContributionRegistryExtension<Tool> {
	name: string;
	manifest: PluginManifest;
	setup?: (
		api: AgentExtensionApi<Tool, Message>,
		ctx?: AgentExtensionContext,
	) => void | Promise<void>;
	onSessionStart?: (
		ctx: AgentExtensionSessionStartContext,
	) => undefined | AgentHookControl | Promise<undefined | AgentHookControl>;
	onRunStart?: (
		ctx: AgentHookRunStartContext,
	) => undefined | AgentHookControl | Promise<undefined | AgentHookControl>;
	onIterationStart?: (
		ctx: AgentHookIterationStartContext,
	) => undefined | AgentHookControl | Promise<undefined | AgentHookControl>;
	onTurnStart?: (
		ctx: AgentHookTurnStartContext,
	) => undefined | AgentHookControl | Promise<undefined | AgentHookControl>;
	onInput?: (
		ctx: AgentExtensionInputContext,
	) => undefined | AgentHookControl | Promise<undefined | AgentHookControl>;
	onBeforeAgentStart?: (
		ctx: AgentExtensionBeforeAgentStartContext,
	) =>
		| undefined
		| AgentExtensionBeforeAgentStartControl
		| Promise<undefined | AgentExtensionBeforeAgentStartControl>;
	onToolCall?: (
		ctx: AgentHookToolCallStartContext,
	) => undefined | AgentHookControl | Promise<undefined | AgentHookControl>;
	onToolResult?: (
		ctx: AgentHookToolCallEndContext,
	) => undefined | AgentHookControl | Promise<undefined | AgentHookControl>;
	onTurnEnd?: (
		ctx: AgentHookTurnEndContext,
	) => undefined | AgentHookControl | Promise<undefined | AgentHookControl>;
	onAgentError?: (
		ctx: AgentHookStopErrorContext,
	) => undefined | AgentHookControl | Promise<undefined | AgentHookControl>;
	onIterationEnd?: (ctx: AgentHookIterationEndContext) => void | Promise<void>;
	onRunEnd?: (ctx: AgentHookRunEndContext) => void | Promise<void>;
	onSessionShutdown?: (
		ctx: AgentExtensionSessionShutdownContext,
	) => undefined | AgentHookControl | Promise<undefined | AgentHookControl>;
	onRuntimeEvent?: (
		ctx: AgentExtensionRuntimeEventContext,
	) => void | Promise<void>;
	onError?: (ctx: AgentHookErrorContext) => void | Promise<void>;
}

export type AgentLoopExtensionRegistry = AgentExtensionRegistryGeneric<
	Tool,
	Message
>;

/**
 * Lifecycle hooks for observing or influencing agent execution.
 */
export interface AgentHooks {
	/**
	 * Runs once when the conversation/session is first initialized.
	 */
	onSessionStart?: (
		ctx: AgentHookSessionStartContext,
	) => undefined | AgentHookControl | Promise<undefined | AgentHookControl>;
	/**
	 * Runs once per user-submitted run or continuation, before the first
	 * iteration starts.
	 */
	onRunStart?: (
		ctx: AgentHookRunStartContext,
	) => undefined | AgentHookControl | Promise<undefined | AgentHookControl>;
	onRunEnd?: (ctx: AgentHookRunEndContext) => void | Promise<void>;
	/**
	 * Runs at the start of every loop iteration.
	 *
	 * Use this for iteration-scoped bookkeeping or guards that should happen
	 * before turn construction begins.
	 */
	onIterationStart?: (
		ctx: AgentHookIterationStartContext,
	) => undefined | AgentHookControl | Promise<undefined | AgentHookControl>;
	onIterationEnd?: (ctx: AgentHookIterationEndContext) => void | Promise<void>;
	onTurnStart?: (
		ctx: AgentHookTurnStartContext,
	) => undefined | AgentHookControl | Promise<undefined | AgentHookControl>;
	/**
	 * Runs immediately before the model call for an iteration.
	 *
	 * This is the last hook that can shape the upcoming turn. It can replace the
	 * system prompt, append messages, or cancel before the provider request is made.
	 */
	onBeforeAgentStart?: (
		ctx: AgentHookBeforeAgentStartContext,
	) => undefined | AgentHookControl | Promise<undefined | AgentHookControl>;
	onTurnEnd?: (
		ctx: AgentHookTurnEndContext,
	) => undefined | AgentHookControl | Promise<undefined | AgentHookControl>;
	/**
	 * Runs when a turn encounters an error that will stop forward progress for the
	 * current run.
	 *
	 * This hook is dispatched on non-recoverable turn failures and also when a
	 * recoverable turn failure exhausts the mistake-limit path and the run is about
	 * to stop. It is intended for "this run is stopping because of this error"
	 * semantics.
	 */
	onStopError?: (
		ctx: AgentHookStopErrorContext,
	) => undefined | AgentHookControl | Promise<undefined | AgentHookControl>;
	onToolCallStart?: (
		ctx: AgentHookToolCallStartContext,
	) => undefined | AgentHookControl | Promise<undefined | AgentHookControl>;
	onToolCallEnd?: (
		ctx: AgentHookToolCallEndContext,
	) => undefined | AgentHookControl | Promise<undefined | AgentHookControl>;
	onSessionShutdown?: (
		ctx: AgentHookSessionShutdownContext,
	) => undefined | AgentHookControl | Promise<undefined | AgentHookControl>;
	/**
	 * Runs when an error escapes the main agent loop and the run fails with the
	 * final `finishReason = "error"`.
	 *
	 * Unlike `onStopError`, this is not part of the recoverable turn-error path;
	 * it represents a top-level loop failure after the agent has already concluded
	 * that execution errored out.
	 */
	onError?: (ctx: AgentHookErrorContext) => void | Promise<void>;
}

// =============================================================================
// Agent Finish Reasons
// =============================================================================

/**
 * Reasons why the agent stopped executing
 */
export type AgentFinishReason =
	| "completed" // Normal completion (no more tool calls)
	| "max_iterations" // Hit the maximum iteration limit
	| "aborted" // User or system aborted
	| "mistake_limit" // Stopped after repeated recoverable mistakes
	| "error"; // Unrecoverable error occurred

export const AgentFinishReasonSchema = z.enum([
	"completed",
	"max_iterations",
	"aborted",
	"mistake_limit",
	"error",
]);

// =============================================================================
// Agent Usage
// =============================================================================

/**
 * Aggregated token usage and cost information
 */
export interface AgentUsage {
	/** Total input tokens across all iterations */
	inputTokens: number;
	/** Total output tokens across all iterations */
	outputTokens: number;
	/** Total tokens read from cache */
	cacheReadTokens?: number;
	/** Total tokens written to cache */
	cacheWriteTokens?: number;
	/** Total cost in dollars */
	totalCost?: number;
}

export const AgentUsageSchema = z.object({
	inputTokens: z.number(),
	outputTokens: z.number(),
	cacheReadTokens: z.number().optional(),
	cacheWriteTokens: z.number().optional(),
	totalCost: z.number().optional(),
});

export interface AgentPrepareTurnContext {
	agentId: string;
	conversationId: string;
	parentAgentId: string | null;
	iteration: number;
	messages: MessageWithMetadata[];
	apiMessages: MessageWithMetadata[];
	abortSignal: AbortSignal;
	systemPrompt: string;
	tools: Tool[];
	model: {
		id: string;
		provider: string;
		info?: ModelInfo;
	};
	emitStatusNotice?: (
		message: string,
		metadata?: Record<string, unknown>,
	) => void;
}

export interface AgentPrepareTurnResult {
	messages: MessageWithMetadata[];
	systemPrompt?: string;
}

// =============================================================================
// Agent Result
// =============================================================================

/**
 * Result returned from Agent.run()
 */
export interface AgentResult {
	/** Final text output from the agent */
	text: string;
	/** Aggregated token usage and cost */
	usage: AgentUsage;
	/** Full conversation history */
	messages: Message[];
	/** All tool calls made during execution */
	toolCalls: ToolCallRecord[];
	/** Number of loop iterations */
	iterations: number;
	/** Why the agent stopped */
	finishReason: AgentFinishReason;
	/** Model information used */
	model: {
		id: string;
		provider: string;
		info?: ModelInfo;
	};
	/** Start time of the run */
	startedAt: Date;
	/** End time of the run */
	endedAt: Date;
	/** Total duration in milliseconds */
	durationMs: number;
}

export const AgentResultSchema = z.object({
	text: z.string(),
	usage: AgentUsageSchema,
	messages: z.array(z.custom<Message>()),
	toolCalls: z.array(ToolCallRecordSchema),
	iterations: z.number(),
	finishReason: AgentFinishReasonSchema,
	model: z.object({
		id: z.string(),
		provider: z.string(),
		info: ModelInfoSchema.optional(),
	}),
	startedAt: z.date(),
	endedAt: z.date(),
	durationMs: z.number(),
});

// =============================================================================
// Agent Configuration
// =============================================================================

/**
 * Reasoning effort level for capable models
 */
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";

export const ReasoningEffortSchema = z.enum(["low", "medium", "high", "xhigh"]);

/**
 * Configuration for creating an Agent
 */
export interface AgentConfig {
	// -------------------------------------------------------------------------
	// Provider Settings
	// -------------------------------------------------------------------------

	/** Provider ID (e.g., "anthropic", "openai", "gemini") */
	providerId: string;
	/** Model ID to use */
	modelId: string;
	/** API key for the provider */
	apiKey?: string;
	/** Custom base URL for the API */
	baseUrl?: string;
	/** Additional headers for API requests */
	headers?: Record<string, string>;
	/** Optional provider model catalog overrides */
	knownModels?: Record<string, ModelInfo>;
	/** Optional pre-resolved provider configuration (includes provider-specific fields like aws/gcp). */
	providerConfig?: unknown;
	/**
	 * Optional preloaded conversation history for resume flows.
	 * When provided, start by calling continue() to preserve history.
	 */
	initialMessages?: Message[];

	// -------------------------------------------------------------------------
	// Agent Behavior
	// -------------------------------------------------------------------------

	/** System prompt for the agent */
	systemPrompt: string;
	/** Tools available to the agent */
	tools: Tool[];
	/**
	 * Maximum number of loop iterations
	 * If undefined, no iteration cap is enforced.
	 */
	maxIterations?: number;
	/**
	 * Maximum number of tool calls to execute concurrently in a single iteration.
	 * @default 8
	 */
	maxParallelToolCalls?: number;
	/**
	 * Maximum output tokens per API call
	 */
	maxTokensPerTurn?: number;
	/**
	 * Timeout for each API call in milliseconds
	 * @default 180000 (3 minutes)
	 */
	apiTimeoutMs?: number;
	/**
	 * Optional runtime file-content loader used when user files are attached.
	 * When omitted, attached files will be represented as loader errors.
	 */
	userFileContentLoader?: (path: string) => Promise<string>;
	/**
	 * Optional metadata merged into every tool execution context.
	 * Hosts can use this to thread runtime-specific identifiers such as session IDs.
	 */
	toolContextMetadata?: Record<string, unknown>;
	/** Execution guardrails and recovery settings. */
	execution?: AgentExecutionConfig;

	// -------------------------------------------------------------------------
	// Reasoning Settings (for capable models)
	// -------------------------------------------------------------------------

	/**
	 * Reasoning effort level
	 */
	reasoningEffort?: ReasoningEffort;
	/**
	 * Maximum tokens for thinking/reasoning
	 */
	thinkingBudgetTokens?: number;
	/**
	 * Enable default thinking/reasoning behavior for supported models.
	 */
	thinking?: boolean;

	// -------------------------------------------------------------------------
	// Callbacks
	// -------------------------------------------------------------------------

	/**
	 * Callback for agent events (streaming, progress, etc.)
	 */
	onEvent?: (event: AgentEvent) => void;
	/**
	 * Lifecycle hooks for observing or influencing agent execution.
	 */
	hooks?: AgentHooks;
	/**
	 * Optional parent agent ID for spawned/delegated runs.
	 * Root agents should leave this undefined.
	 */
	parentAgentId?: string;
	/**
	 * Extension modules that can intercept lifecycle events and register tools/commands.
	 */
	extensions?: AgentExtension[];
	/**
	 * How hook errors should be handled.
	 * @default "ignore"
	 */
	hookErrorMode?: HookErrorMode;
	/**
	 * Optional deterministic hook execution policies.
	 */
	hookPolicies?: HookPolicies;
	/**
	 * Optional schedule metadata for runs initiated by scheduler services.
	 * Used by session_start lifecycle hooks.
	 */
	schedule?: AgentHookScheduleContext;
	/**
	 * Per-tool execution policy. Tool names not listed here default to enabled + autoApprove.
	 */
	toolPolicies?: Record<string, ToolPolicy>;
	/**
	 * Optional callback to request client approval when a tool policy disables auto-approval.
	 */
	requestToolApproval?: (
		request: ToolApprovalRequest,
	) => Promise<ToolApprovalResult> | ToolApprovalResult;
	/**
	 * Optional callback invoked when consecutive mistakes reach maxConsecutiveMistakes.
	 */
	onConsecutiveMistakeLimitReached?: (
		context: ConsecutiveMistakeLimitContext,
	) =>
		| Promise<ConsecutiveMistakeLimitDecision>
		| ConsecutiveMistakeLimitDecision;
	/**
	 * Optional logger for tracing agent loop lifecycle and recoverable failures.
	 */
	logger?: BasicLogger;
	/**
	 * Optional callback that can rewrite the turn input before each model call.
	 * This is the primary seam for host-owned context pipelines.
	 */
	prepareTurn?: (
		context: AgentPrepareTurnContext,
	) =>
		| Promise<AgentPrepareTurnResult | undefined>
		| AgentPrepareTurnResult
		| undefined;
	/**
	 * Optional Telemetry service for emitting structured events about agent execution to configured telemetry backends.
	 */
	telemetry?: ITelemetryService;
	/**
	 * Ambient runtime context: user identity, client surface, workspace, logger,
	 * and telemetry. Threaded through to ProviderConfig so handlers can access it.
	 */
	extensionContext?: ExtensionContext;

	// -------------------------------------------------------------------------
	// Completion Guard
	// -------------------------------------------------------------------------

	/**
	 * Optional guard that runs when the model returns no tool calls.
	 * If it returns a non-empty string, that string is injected as a
	 * system-level nudge and the loop continues instead of completing.
	 * Use this to prevent premature exit when the agent has unfinished
	 * obligations (e.g. in-progress team tasks).
	 */
	completionGuard?: () => string | undefined;

	// -------------------------------------------------------------------------
	// Pending User Messages
	// -------------------------------------------------------------------------

	/**
	 * Optional callback invoked at the top of each agent loop iteration
	 * (after the first). If it returns a non-empty string, that string is
	 * injected as a user message into the conversation before the next API
	 * call. This allows the host to feed user input into a running loop
	 * without waiting for the current run to finish.
	 */
	consumePendingUserMessage?: () => string | undefined;

	// -------------------------------------------------------------------------
	// Cancellation
	// -------------------------------------------------------------------------

	/**
	 * Abort signal for cancellation
	 */
	abortSignal?: AbortSignal;
}

export const AgentConfigSchema = z.object({
	// Provider Settings
	providerId: z.string(),
	modelId: z.string(),
	apiKey: z.string().optional(),
	baseUrl: z.string().url().optional(),
	headers: z.record(z.string(), z.string()).optional(),
	knownModels: z.record(z.string(), ModelInfoSchema).optional(),
	providerConfig: z.unknown().optional(),
	initialMessages: z.array(z.custom<Message>()).optional(),

	// Agent Behavior
	systemPrompt: z.string(),
	tools: z.array(z.custom<Tool>()),
	maxIterations: z.number().positive().optional(),
	maxParallelToolCalls: z.number().int().positive().default(8),
	maxTokensPerTurn: z.number().positive().optional(),
	apiTimeoutMs: z.number().positive().default(180000),
	userFileContentLoader: z
		.function()
		.input([z.string()])
		.output(z.promise(z.string()))
		.optional(),
	toolContextMetadata: z.record(z.string(), z.unknown()).optional(),
	execution: z
		.object({
			maxConsecutiveMistakes: z.number().int().positive().optional(),
			reminderAfterIterations: z.number().nonnegative().optional(),
			reminderText: z.string().optional(),
			loopDetection: z
				.union([
					z.literal(false),
					z.object({
						softThreshold: z.number().int().positive().optional(),
						hardThreshold: z.number().int().positive().optional(),
					}),
				])
				.optional(),
		})
		.optional(),
	// Reasoning Settings
	reasoningEffort: ReasoningEffortSchema.optional(),
	thinkingBudgetTokens: z.number().positive().optional(),
	thinking: z.boolean().optional(),

	// Callbacks
	onEvent: z
		.function()
		.input([z.custom<AgentEvent>()])
		.output(z.void())
		.optional(),
	hooks: z.custom<AgentHooks>().optional(),
	parentAgentId: z.string().optional(),
	extensions: z.array(z.custom<AgentExtension>()).optional(),
	hookErrorMode: z.enum(["ignore", "throw"]).default("ignore"),
	hookPolicies: z.custom<HookPolicies>().optional(),
	toolPolicies: z
		.record(
			z.string(),
			z.object({
				enabled: z.boolean().optional(),
				autoApprove: z.boolean().optional(),
			}),
		)
		.optional(),
	requestToolApproval: z
		.function()
		.input([
			z.object({
				agentId: z.string(),
				conversationId: z.string(),
				iteration: z.number(),
				toolCallId: z.string(),
				toolName: z.string(),
				input: z.unknown(),
				policy: z
					.object({
						enabled: z.boolean().optional(),
						autoApprove: z.boolean().optional(),
					})
					.default({}),
			}),
		])
		.output(
			z.union([
				z.object({
					approved: z.boolean(),
					reason: z.string().optional(),
				}),
				z.promise(
					z.object({
						approved: z.boolean(),
						reason: z.string().optional(),
					}),
				),
			]),
		)
		.optional(),
	onConsecutiveMistakeLimitReached: z
		.function()
		.input([
			z.object({
				iteration: z.number().int().positive(),
				consecutiveMistakes: z.number().int().positive(),
				maxConsecutiveMistakes: z.number().int().positive(),
				reason: z.enum([
					"api_error",
					"invalid_tool_call",
					"tool_execution_failed",
				]),
				details: z.string().optional(),
			}),
		])
		.output(
			z.union([
				z.object({
					action: z.literal("continue"),
					guidance: z.string().optional(),
				}),
				z.object({
					action: z.literal("stop"),
					reason: z.string().optional(),
				}),
				z.promise(
					z.union([
						z.object({
							action: z.literal("continue"),
							guidance: z.string().optional(),
						}),
						z.object({
							action: z.literal("stop"),
							reason: z.string().optional(),
						}),
					]),
				),
			]),
		)
		.optional(),
	logger: z.custom<BasicLogger>().optional(),
	extensionContext: z.custom<ExtensionContext>().optional(),

	// Cancellation
	abortSignal: z.custom<AbortSignal>().optional(),
});

// =============================================================================
// Internal Types
// =============================================================================

/**
 * Pending tool call from the model
 */
export interface PendingToolCall {
	id: string;
	name: string;
	input: unknown;
	signature?: string;
	review?: boolean;
}

/**
 * Processed response from one turn of the loop
 */
export interface ProcessedTurn {
	/** Text output from the model */
	text: string;
	/** Reasoning/thinking content */
	reasoning?: string;
	/** Tool calls requested by the model */
	toolCalls: PendingToolCall[];
	/** Model-emitted tool calls that were invalid or missing required fields */
	invalidToolCalls: Array<{
		id: string;
		name?: string;
		input?: unknown;
		reason: "missing_name" | "missing_arguments" | "invalid_arguments";
	}>;
	/** Token usage for this turn */
	usage: {
		inputTokens: number;
		outputTokens: number;
		cacheReadTokens?: number;
		cacheWriteTokens?: number;
		cost?: number;
	};
	/** Whether the response was truncated */
	truncated: boolean;
	/** Response ID from the API */
	responseId?: string;
}
