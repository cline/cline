/**
 * AgentRuntime contract types (ported from clinee `@clinebot/shared`).
 *
 * These are the canonical type definitions consumed by `AgentRuntime`.
 *
 */

import type {
	ToolApprovalRequest,
	ToolApprovalResult,
	ToolPolicy,
} from "./llms/tools";
import type { BasicLogger } from "./logging/logger";

// =============================================================================
// Lightweight telemetry surface used by AgentRuntime
// =============================================================================

/**
 * Minimal telemetry interface consumed by the new `AgentRuntime`.
 *
 * This is intentionally smaller than `ITelemetryService` (see
 * `./services/telemetry`); hosts that wish to forward runtime telemetry
 * to the full service should adapt via a simple shim.
 */
export interface AgentTelemetry {
	capture?: (
		event: string,
		properties?: Record<string, unknown>,
	) => void | Promise<void>;
}

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

export interface AgentToolCallPart {
	type: "tool-call";
	toolCallId: string;
	toolName: string;
	input: unknown;
	metadata?: unknown;
}

export interface AgentToolResultPart {
	type: "tool-result";
	toolCallId: string;
	toolName: string;
	output: unknown;
	isError?: boolean;
}

export type AgentMessagePart =
	| AgentTextPart
	| AgentReasoningPart
	| AgentImagePart
	| AgentFilePart
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
	signal?: AbortSignal;
	options?: Record<string, unknown>;
}

export type AgentModelFinishReason =
	| "stop"
	| "tool-calls"
	| "max-tokens"
	| "aborted"
	| "error";

export type AgentModelEvent =
	| { type: "text-delta"; text: string }
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
	  }
	| {
			type: "usage";
			usage: Partial<AgentUsage>;
	  }
	| {
			type: "finish";
			reason: AgentModelFinishReason;
			error?: string;
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
	// biome-ignore lint/suspicious/noExplicitAny: tool input/output types vary per tool
	tools?: readonly AgentTool<any, any>[];
	hooks?: Partial<AgentRuntimeHooks>;
	plugins?: readonly AgentRuntimePlugin[];
	logger?: BasicLogger;
	telemetry?: AgentTelemetry;
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
}

// =============================================================================
// Runtime event union (13 variants)
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
			type: "run-finished";
			snapshot: AgentRuntimeStateSnapshot;
			result: AgentRunResult;
	  }
	| {
			type: "run-failed";
			snapshot: AgentRuntimeStateSnapshot;
			error: Error;
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
