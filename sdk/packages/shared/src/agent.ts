/**
 * AgentRuntime contract types (ported from clinee `@cline/shared`).
 *
 * These are the canonical type definitions consumed by `AgentRuntime`.
 *
 */

import type { GeneratedMedia } from "./llms/media";
import type { ModelInfo } from "./llms/model-info";
import type {
	ToolApprovalRequest,
	ToolApprovalResult,
	ToolPolicy,
} from "./llms/tools";
import type { BasicLogger } from "./logging/logger";
import type { ITelemetryService } from "./services/telemetry";

// =============================================================================
// Lightweight telemetry surface used by AgentRuntime
// =============================================================================

// =============================================================================
// Message parts
// =============================================================================

export interface AgentTextPart {
	type: "text";
	text: string;
}

export interface AgentReasoningPart {
	type: "reasoning";
	text: string;
	redacted?: boolean;
	metadata?: unknown;
}

export interface AgentImagePart {
	type: "image";
	image: string | Uint8Array | ArrayBuffer | URL;
	mediaType?: string;
}

export interface AgentFilePart {
	type: "file";
	path: string;
	content: string;
}

export interface AgentMediaPart {
	type: "media";
	media: GeneratedMedia;
}

export interface AgentToolCallPart {
	type: "tool-call";
	toolCallId: string;
	toolName: string;
	input: unknown;
	metadata?: unknown;
	/** Absent for ordinary AgentRuntime-executed tools. */
	execution?: ModelToolExecution;
}

export interface AgentToolResultPart {
	type: "tool-result";
	toolCallId: string;
	toolName: string;
	output: unknown;
	isError?: boolean;
	/** Absent for ordinary AgentRuntime-executed tools. */
	execution?: ModelToolExecution;
}

export type ModelToolExecution = "client" | "provider";

/** Observational record for a model tool executed outside AgentRuntime. */
export interface AgentModelToolActivity {
	toolCallId: string;
	toolName: string;
	execution: ModelToolExecution;
	input?: unknown;
	output?: unknown;
	isError?: boolean;
}

export type AgentMessagePart =
	| AgentTextPart
	| AgentReasoningPart
	| AgentImagePart
	| AgentFilePart
	| AgentMediaPart
	| AgentToolCallPart
	| AgentToolResultPart;

// =============================================================================
// Messages and token usage
// =============================================================================

export type AgentMessageRole = "user" | "assistant" | "tool";

export interface AgentTokenUsage {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	/** Provider-reported hidden reasoning tokens, when available. */
	reasoningTokenCount?: number;
}

/**
 * Canonical `AgentUsage` shape for the new runtime.
 *
 * This supersedes the legacy `AgentUsage` (now `LegacyAgentUsage` in
 * `./agents/types`). The old, host-facing shape is
 * retained for `AgentResult`/`AgentUsageEvent` consumers via the facade.
 */
export interface AgentUsage extends AgentTokenUsage {
	totalCost?: number;
}

export interface AgentMessage {
	id: string;
	role: AgentMessageRole;
	content: AgentMessagePart[];
	createdAt: number;
	metadata?: Record<string, unknown>;
	modelInfo?: {
		id: string;
		provider: string;
		family?: string;
	};
	metrics?: AgentTokenUsage & {
		cost?: number;
	};
}

// =============================================================================
// Runtime state
// =============================================================================

export type AgentRole = string;

export type AgentRunStatus =
	| "idle"
	| "running"
	| "completed"
	| "aborted"
	| "failed";

export interface AgentRuntimeStateSnapshot {
	agentId: string;
	agentRole?: AgentRole;
	parentAgentId?: string | null;
	conversationId?: string;
	runId?: string;
	status: AgentRunStatus;
	iteration: number;
	messages: readonly AgentMessage[];
	pendingToolCalls: readonly string[];
	usage: AgentUsage;
	lastError?: string;
	/** Classification of `lastError` when it came from a provider stream. */
	lastErrorClass?: ProviderErrorClass;
}

// =============================================================================
// Tools
// =============================================================================

export interface AgentToolDefinition {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	lifecycle?: {
		/**
		 * Whether a successful call to this tool completes the current run.
		 */
		completesRun?: boolean;
	};
}

export interface AgentToolResult<TOutput = unknown> {
	output: TOutput;
	isError?: boolean;
	metadata?: Record<string, unknown>;
}

export interface AgentToolContext {
	sessionId?: string;
	agentId: string;
	conversationId?: string;
	runId?: string;
	iteration: number;
	toolCallId?: string;
	signal?: AbortSignal;
	metadata?: Record<string, unknown>;
	snapshot?: AgentRuntimeStateSnapshot;
	emitUpdate?: (update: unknown) => void;
}

export interface AgentTool<TInput = unknown, TOutput = unknown>
	extends AgentToolDefinition {
	timeoutMs?: number;
	retryable?: boolean;
	maxRetries?: number;
	execute: (
		input: TInput,
		context: AgentToolContext,
	) => Promise<TOutput> | TOutput;
}

// =============================================================================
// Model adapter contract
// =============================================================================

export interface AgentModelRequest {
	systemPrompt?: string;
	messages: readonly AgentMessage[];
	tools: readonly AgentToolDefinition[];
	/** Provider-executed tools enabled for this model request. */
	modelTools?: readonly import("./llms/model-tools").ModelTool[];
	signal?: AbortSignal;
	options?: Record<string, unknown>;
}

export interface AgentRuntimePrepareTurnContext {
	agentId: string;
	conversationId?: string;
	parentAgentId?: string | null;
	iteration: number;
	messages: readonly AgentMessage[];
	systemPrompt?: string;
	tools: readonly AgentToolDefinition[];
	model: {
		id?: string;
		provider?: string;
		info?: ModelInfo;
	};
	signal?: AbortSignal;
	/**
	 * Set when the previous model request was rejected as exceeding the
	 * model's context window; asks the prepare-turn pipeline to force a
	 * compaction rather than trust its token estimates.
	 */
	overflowRecovery?: boolean;
	emitStatusNotice?: (
		message: string,
		metadata?: Record<string, unknown>,
	) => void;
}

export interface AgentRuntimePrepareTurnResult {
	messages?: readonly AgentMessage[];
	systemPrompt?: string;
}

/**
 * Why a model turn stopped producing output.
 *
 * `content-filter` is distinct from `stop` because the two need opposite
 * handling when the turn produced nothing: a `stop` with no content is a
 * transient upstream flake worth retrying, while a filtered turn will
 * reproduce on every attempt. Collapsing them (as this union did before)
 * left both surfacing as "Model returned empty response", which tells a
 * user to retry something that cannot succeed.
 *
 * Provider finish reasons with no dedicated member here (`other`,
 * `unknown`, ...) still normalize to `stop`.
 */
export type AgentModelFinishReason =
	| "stop"
	| "tool-calls"
	| "max-tokens"
	| "content-filter"
	| "aborted"
	| "error";

/**
 * Coarse classification of a provider error, derived from the raw provider
 * error object before it is flattened into a display string. Shared by the
 * runtime's recovery policy and telemetry (`error_class`). Extend with new
 * classes (rate_limit, billing, ...) as consumers need them.
 *
 * `auth`: the provider rejected the request's credentials (HTTP 401/403) —
 * hosts should point the user at their API key configuration.
 */
export type ProviderErrorClass = "context_window_exceeded" | "auth" | "unknown";

export type AgentModelEvent =
	| { type: "text-delta"; text: string }
	| { type: "media"; media: GeneratedMedia }
	| {
			type: "reasoning-delta";
			text: string;
			redacted?: boolean;
			metadata?: unknown;
	  }
	| {
			type: "tool-call-delta";
			index?: number;
			toolCallId?: string;
			toolName?: string;
			inputText?: string;
			input?: unknown;
			metadata?: unknown;
			/** Set when execution is owned by AI SDK or the model provider. */
			execution?: ModelToolExecution;
	  }
	| {
			type: "tool-result";
			toolCallId: string;
			/**
			 * Declared model tools carry a ModelToolName; provider-executed tools
			 * (e.g. the Claude Code CLI's own tools) carry arbitrary names.
			 */
			toolName: string;
			input?: unknown;
			output: unknown;
			isError?: boolean;
			execution: ModelToolExecution;
	  }
	| {
			type: "usage";
			usage: Partial<AgentUsage>;
	  }
	| {
			type: "finish";
			reason: AgentModelFinishReason;
			error?: string;
			errorClass?: ProviderErrorClass;
			/**
			 * The model layer already recorded `sdk.error` telemetry for this
			 * failure at its own error boundary. `error` is a flattened string,
			 * so this bit carries reporting ownership across the boundary: the
			 * agent loop skips re-reporting when it is set, and still reports
			 * failures from model implementations that do not record their own
			 * telemetry.
			 */
			errorReported?: boolean;
	  };

export interface AgentModel {
	stream: (
		request: AgentModelRequest,
	) => AsyncIterable<AgentModelEvent> | Promise<AsyncIterable<AgentModelEvent>>;
}

// =============================================================================
// Hook contexts
// =============================================================================

export interface AgentBeforeModelContext {
	snapshot: AgentRuntimeStateSnapshot;
	request: AgentModelRequest;
}

export interface AgentStopControl {
	stop?: boolean;
	reason?: string;
}

export interface AgentBeforeModelResult {
	stop?: boolean;
	reason?: string;
	messages?: readonly AgentMessage[];
	tools?: readonly AgentToolDefinition[];
	options?: Record<string, unknown>;
}

export interface AgentAfterModelContext {
	snapshot: AgentRuntimeStateSnapshot;
	assistantMessage: AgentMessage;
	finishReason: AgentModelFinishReason;
}

export interface AgentBeforeToolContext {
	snapshot: AgentRuntimeStateSnapshot;
	tool: AgentTool;
	toolCall: AgentToolCallPart;
	input: unknown;
}

export interface AgentBeforeToolResult {
	skip?: boolean;
	stop?: boolean;
	reason?: string;
	input?: unknown;
	policy?: ToolPolicy;
	/**
	 * Text to inject into the conversation as hook context (e.g. a hook's
	 * `contextModification`). Collected across hooks and appended after this
	 * iteration's tool results as a `<hook_context>` user message, so the
	 * model sees it on the next request.
	 */
	appendContext?: string;
}

export interface AgentAfterToolContext {
	snapshot: AgentRuntimeStateSnapshot;
	tool: AgentTool;
	toolCall: AgentToolCallPart;
	input: unknown;
	result: AgentToolResult;
	startedAt: Date;
	endedAt: Date;
	durationMs: number;
}

export interface AgentAfterToolResult {
	stop?: boolean;
	reason?: string;
	result?: AgentToolResult;
	/**
	 * Text to inject into the conversation as hook context (e.g. a hook's
	 * `contextModification`). Collected across hooks and appended after this
	 * iteration's tool results as a `<hook_context>` user message, so the
	 * model sees it on the next request.
	 */
	appendContext?: string;
}

export interface AgentRunLifecycleContext {
	snapshot: AgentRuntimeStateSnapshot;
}

// =============================================================================
// Runtime hook bag
// =============================================================================

/**
 * 7-callback hook bag consumed by `AgentRuntime`.
 */
export interface AgentRuntimeHooks {
	beforeRun?: (
		context: AgentRunLifecycleContext,
	) => AgentStopControl | undefined | Promise<AgentStopControl | undefined>;
	afterRun?: (
		context: AgentRunLifecycleContext & { result: AgentRunResult },
	) => void | Promise<void>;
	beforeModel?: (
		context: AgentBeforeModelContext,
	) =>
		| AgentBeforeModelResult
		| undefined
		| Promise<AgentBeforeModelResult | undefined>;
	afterModel?: (
		context: AgentAfterModelContext,
	) => AgentStopControl | undefined | Promise<AgentStopControl | undefined>;
	beforeTool?: (
		context: AgentBeforeToolContext,
	) =>
		| AgentBeforeToolResult
		| undefined
		| Promise<AgentBeforeToolResult | undefined>;
	afterTool?: (
		context: AgentAfterToolContext,
	) =>
		| AgentAfterToolResult
		| undefined
		| Promise<AgentAfterToolResult | undefined>;
	onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>;
}

// =============================================================================
// Plugins
// =============================================================================

export interface AgentRuntimePluginContext {
	agentId: string;
	agentRole?: AgentRole;
	systemPrompt?: string;
}

export interface AgentRuntimePluginSetup {
	// biome-ignore lint/suspicious/noExplicitAny: tool input/output types vary per tool
	tools?: readonly AgentTool<any, any>[];
	hooks?: Partial<AgentRuntimeHooks>;
}

export interface AgentRuntimePlugin {
	name: string;
	setup?: (
		context: AgentRuntimePluginContext,
	) =>
		| AgentRuntimePluginSetup
		| undefined
		| Promise<AgentRuntimePluginSetup | undefined>;
}

// =============================================================================
// Runtime config
// =============================================================================

export interface AgentRuntimeConfig {
	/**
	 * Stable end-user distinct ID used for provider and observability metadata.
	 * This is intentionally separate from the host-owned session id.
	 */
	distinctId?: string;
	/** Calling client surface, for example `cline-vscode` or `cline-sdk`. */
	clientName?: string;
	/** Calling client version, such as the VS Code extension version. */
	clientVersion?: string;
	/** Version of the Cline Core SDK executing the runtime. */
	clineCoreVersion?: string;
	/**
	 * Core/hub runtime session identifier.
	 *
	 * The host-owned lifecycle id for the task/session containing this runtime.
	 * It is stable for hub subscriptions, session persistence, abort/stop
	 * commands, and approval routing. It can differ from `conversationId`, which
	 * tracks the agent transcript.
	 */
	sessionId?: string;
	agentId?: string;
	/**
	 * Agent conversation/transcript identifier.
	 *
	 * Used by the stateless agent loop, tools, hooks, telemetry, and model
	 * history correlation. This id follows the current conversation store and
	 * should not be used as the hub/session routing key.
	 */
	conversationId?: string;
	parentAgentId?: string | null;
	agentRole?: AgentRole;
	systemPrompt?: string;
	messageModelInfo?: AgentMessage["modelInfo"];
	model: AgentModel;
	modelOptions?: Record<string, unknown>;
	/** Provider-executed tools, separate from locally executed AgentTools. */
	modelTools?: readonly import("./llms/model-tools").ModelTool[];
	// biome-ignore lint/suspicious/noExplicitAny: tool input/output types vary per tool
	tools?: readonly AgentTool<any, any>[];
	hooks?: Partial<AgentRuntimeHooks>;
	plugins?: readonly AgentRuntimePlugin[];
	logger?: BasicLogger;
	telemetry?: ITelemetryService;
	initialMessages?: readonly AgentMessage[];
	maxIterations?: number;
	completionPolicy?: {
		requireCompletionTool?: boolean;
		completionGuard?: () => string | undefined;
	};
	toolExecution?: "sequential" | "parallel";
	toolPolicies?: Record<string, ToolPolicy>;
	toolContextMetadata?: Record<string, unknown>;
	requestToolApproval?: (
		request: ToolApprovalRequest,
	) => Promise<ToolApprovalResult> | ToolApprovalResult;
	/**
	 * Optional host-owned request projection hook invoked before each model call.
	 *
	 * Returned messages affect only the provider request for the current call.
	 * They do not replace the canonical runtime transcript, are not persisted as
	 * session history, and are not reflected in AgentRunResult.messages.
	 */
	prepareTurn?: (
		context: AgentRuntimePrepareTurnContext,
	) =>
		| Promise<AgentRuntimePrepareTurnResult | undefined>
		| AgentRuntimePrepareTurnResult
		| undefined;
	// Optional host callback used by interactive sessions to inject a queued
	// user steering message between agent loop iterations, before the next
	// model request.
	consumePendingUserMessage?: () =>
		| string
		| undefined
		| Promise<string | undefined>;
}

// =============================================================================
// Runtime event union
// =============================================================================

export type AgentRuntimeEvent =
	| {
			type: "run-started";
			snapshot: AgentRuntimeStateSnapshot;
	  }
	| {
			type: "message-added";
			snapshot: AgentRuntimeStateSnapshot;
			message: AgentMessage;
	  }
	| {
			type: "turn-started";
			snapshot: AgentRuntimeStateSnapshot;
			iteration: number;
	  }
	| {
			type: "assistant-text-delta";
			snapshot: AgentRuntimeStateSnapshot;
			iteration: number;
			text: string;
			accumulatedText: string;
	  }
	| {
			type: "assistant-reasoning-delta";
			snapshot: AgentRuntimeStateSnapshot;
			iteration: number;
			text: string;
			accumulatedText: string;
			redacted?: boolean;
			metadata?: unknown;
	  }
	| {
			type: "assistant-media";
			snapshot: AgentRuntimeStateSnapshot;
			iteration: number;
			media: GeneratedMedia;
	  }
	| {
			type: "assistant-message";
			snapshot: AgentRuntimeStateSnapshot;
			iteration: number;
			message: AgentMessage;
			finishReason: AgentModelFinishReason;
	  }
	| {
			type: "tool-started";
			snapshot: AgentRuntimeStateSnapshot;
			iteration: number;
			toolCall: AgentToolCallPart;
	  }
	| {
			type: "tool-updated";
			snapshot: AgentRuntimeStateSnapshot;
			iteration: number;
			toolCall: AgentToolCallPart;
			update: unknown;
	  }
	| {
			type: "tool-finished";
			snapshot: AgentRuntimeStateSnapshot;
			iteration: number;
			toolCall: AgentToolCallPart;
			message: AgentMessage;
	  }
	| {
			type: "usage-updated";
			snapshot: AgentRuntimeStateSnapshot;
			usage: AgentUsage;
	  }
	| {
			type: "turn-finished";
			snapshot: AgentRuntimeStateSnapshot;
			iteration: number;
			toolCallCount: number;
	  }
	| {
			type: "status-notice";
			snapshot: AgentRuntimeStateSnapshot;
			message: string;
			metadata?: Record<string, unknown>;
	  }
	| {
			type: "run-finished";
			snapshot: AgentRuntimeStateSnapshot;
			result: AgentRunResult;
	  }
	| {
			type: "run-failed";
			snapshot: AgentRuntimeStateSnapshot;
			error: Error;
			/** Classification of the provider error that failed the run. */
			errorClass?: ProviderErrorClass;
	  };

// =============================================================================
// Run result
// =============================================================================

export interface AgentRunResult {
	agentId: string;
	agentRole?: AgentRole;
	runId: string;
	status: Exclude<AgentRunStatus, "idle" | "running">;
	iterations: number;
	outputText: string;
	messages: readonly AgentMessage[];
	usage: AgentUsage;
	error?: Error;
}
