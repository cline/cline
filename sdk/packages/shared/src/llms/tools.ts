/**
 * Types and Zod Schemas for the Agent Package
 *
 * This module defines all TypeScript types and Zod validation schemas
 * for agent configuration, tools, events, and results.
 */

import { z } from "zod";

// =============================================================================
// Tool Context
// =============================================================================

/**
 * Context passed to tool execution functions
 */
export interface ToolContext {
	/** Unique identifier for the agent instance */
	agentId: string;
	/** Unique identifier for the current conversation */
	conversationId: string;
	/** Current iteration number in the agentic loop */
	iteration: number;
	/** Abort signal for cancellation */
	abortSignal?: AbortSignal;
	/** Optional metadata for the tool execution */
	metadata?: Record<string, unknown>;
}

export interface ToolPolicy {
	/**
	 * Whether the tool can be executed at all.
	 * @default true
	 */
	enabled?: boolean;
	/**
	 * Whether this tool can run without asking the client for approval.
	 * @default true
	 */
	autoApprove?: boolean;
}

export interface ToolLifecycle {
	/**
	 * Whether a successful call to this tool completes the current agent run.
	 */
	completesRun?: boolean;
}

export const ToolContextSchema = z.object({
	agentId: z.string(),
	conversationId: z.string(),
	iteration: z.number(),
	abortSignal: z.custom<AbortSignal>().optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});

// =============================================================================
// Tool Definition
// =============================================================================

/**
 * A tool that the agent can use
 *
 * @template TInput - The type of the input to the tool
 * @template TOutput - The type of the output from the tool
 */
export interface Tool<TInput = unknown, TOutput = unknown> {
	/** Unique name for the tool */
	name: string;
	/** Human-readable description of what the tool does */
	description: string;
	/** JSON Schema defining the tool's input parameters */
	inputSchema: Record<string, unknown>;
	/** Runtime lifecycle semantics for this tool. */
	lifecycle?: ToolLifecycle;
	/** The function that executes the tool */
	execute: (
		input: TInput,
		context: ToolContext,
		onChange?: (update: unknown) => void,
	) => Promise<TOutput>;
	/**
	 * Optional timeout in milliseconds for tool execution
	 * @default 30000 (30 seconds)
	 */
	timeoutMs?: number;
	/**
	 * Whether the tool can be retried on failure
	 * @default true
	 */
	retryable?: boolean;
	/**
	 * Maximum number of retries for this tool
	 * @default 2
	 */
	maxRetries?: number;
}

// =============================================================================
// Tool Call Record
// =============================================================================

/**
 * Record of a tool call execution
 */
export interface ToolCallRecord {
	/** Unique identifier for this tool call */
	id: string;
	/** Name of the tool that was called */
	name: string;
	/** Input passed to the tool */
	input: unknown;
	/** Output returned from the tool (if successful) */
	output: unknown;
	/** Error message (if the tool failed) */
	error?: string;
	/** Time taken to execute the tool in milliseconds */
	durationMs: number;
	/** Timestamp when the tool call started */
	startedAt: Date;
	/** Timestamp when the tool call ended */
	endedAt: Date;
}

export interface ToolApprovalRequest {
	/**
	 * Core/hub runtime session identifier.
	 *
	 * This is the routing and lifecycle id for the task/session that owns the
	 * tool call. Hosts and hub transports use it to deliver approval events to
	 * clients subscribed to that session and to correlate approval responses
	 * with the pending runtime session. It should not be used as the transcript
	 * id for model history.
	 */
	sessionId: string;
	/**
	 * Agent instance identifier.
	 *
	 * This identifies the lead or delegated agent that requested the tool call.
	 * It is used for attribution in approval prompts, events, telemetry, and
	 * team/sub-agent flows. It is not a hub routing key and should not be used
	 * to find the owning runtime session.
	 */
	agentId: string;
	/**
	 * Agent conversation/transcript identifier.
	 *
	 * This identifies the model conversation that produced the tool call. Tools,
	 * hooks, telemetry, and persisted session metadata use it to correlate work
	 * with the agent's message history. It is contextual data, not the hub event
	 * routing key.
	 */
	conversationId: string;
	iteration: number;
	toolCallId: string;
	toolName: string;
	input: unknown;
	policy: ToolPolicy;
}

export interface ToolApprovalResult {
	approved: boolean;
	reason?: string;
}

export const ToolCallRecordSchema = z.object({
	id: z.string(),
	name: z.string(),
	input: z.unknown(),
	output: z.unknown(),
	error: z.string().optional(),
	durationMs: z.number(),
	startedAt: z.date(),
	endedAt: z.date(),
});
