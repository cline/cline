/**
 * Shared tool policy and execution record types.
 */

import { z } from "zod";

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
	/** Absent for ordinary AgentRuntime-executed tools. */
	execution?: "client" | "provider";
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

/**
 * Model-facing reason a client sends when the user rejects a tool approval.
 * No tool name is interpolated: tool results are already paired with their
 * tool call blocks. Hosts also match on this string to classify a tool
 * result as a user rejection (vs. a timeout/disconnect/system rejection).
 */
export const USER_REJECTED_TOOL_REASON =
	"This tool call was rejected by the user and not executed.";

/**
 * Guidance the agent runtime appends to every rejected tool approval reason
 * so the model treats the rejection as deliberate instead of retrying it as
 * a tool/system failure. Clients only supply the leading reason (who
 * rejected and why); the runtime appends this suffix.
 */
export const TOOL_REJECTION_SUFFIX =
	"NOT a tool or system failure. Clarify with user before proceeding.";

export const ToolCallRecordSchema = z.object({
	id: z.string(),
	name: z.string(),
	execution: z.enum(["client", "provider"]).optional(),
	input: z.unknown(),
	output: z.unknown(),
	error: z.string().optional(),
	durationMs: z.number(),
	startedAt: z.date(),
	endedAt: z.date(),
});
