/**
 * Error Handling Utilities
 *
 * Centralized error detection, mistake tracking, recovery notices,
 * and invalid tool-call feedback for the agent loop.
 */

import type * as LlmsProviders from "@clinebot/llms";
import type {
	AgentEvent,
	ConsecutiveMistakeLimitContext,
	ConsecutiveMistakeLimitDecision,
	ToolCallRecord,
} from "../types";

// =============================================================================
// API Error Classification
// =============================================================================

const NON_RECOVERABLE_STATUS_CODES = [
	400, 401, 402, 403, 404, 405, 406, 409, 410, 429,
];

const NON_RECOVERABLE_PHRASES = [
	"not found",
	"unsupported for",
	"missing api key",
	"invalid api key",
	"authentication",
	"unauthorized",
	"forbidden",
	"overloaded",
	"insufficient balance",
];

export function isNonRecoverableApiError(error: Error): boolean {
	const message = error.message.toLowerCase();

	if (
		NON_RECOVERABLE_STATUS_CODES.some((code) =>
			new RegExp(`(?:\\b|\\"code\\"\\s*:\\s*)${code}(?:\\b|\\s)`).test(message),
		)
	) {
		return true;
	}

	if (NON_RECOVERABLE_PHRASES.some((s) => message.includes(s))) {
		return true;
	}

	return false;
}

// =============================================================================
// Invalid Tool Call Feedback
// =============================================================================

interface InvalidToolCall {
	id: string;
	name?: string;
	input?: unknown;
	reason: "missing_name" | "missing_arguments" | "invalid_arguments";
}

function extractParseError(input: unknown): string | undefined {
	if (
		input &&
		typeof input === "object" &&
		!Array.isArray(input) &&
		typeof (input as { parse_error?: unknown }).parse_error === "string"
	) {
		return (input as { parse_error: string }).parse_error;
	}
	return undefined;
}

export function buildInvalidToolCallFeedback(
	invalidToolCalls: InvalidToolCall[],
): string {
	const details = invalidToolCalls
		.map((call) => {
			const name = call.name?.trim() || "(unknown tool)";
			const parseError = extractParseError(call.input);
			const reason =
				call.reason === "missing_name"
					? "missing tool name"
					: call.reason === "missing_arguments"
						? "missing arguments"
						: (parseError ?? "arguments could not be parsed as JSON");
			return `${name} [${call.id}]: ${reason}`;
		})
		.join("; ");
	return `One or more tool calls were invalid or missing required parameters (${details}). Retry with valid tool names and arguments.`;
}

export function buildInvalidToolResultMessage(
	invalidToolCalls: InvalidToolCall[],
): LlmsProviders.Message {
	return {
		role: "user",
		content: invalidToolCalls.map((call) => ({
			type: "tool_result" as const,
			tool_use_id: call.id,
			content: JSON.stringify({
				toolName: call.name?.trim() || "(unknown tool)",
				query: call.input ?? {},
				result: "",
				error:
					call.reason === "missing_name"
						? "Tool call was missing a tool name"
						: call.reason === "missing_arguments"
							? "Tool call was missing required arguments"
							: (extractParseError(call.input) ??
								"Tool call arguments could not be parsed as JSON"),
				success: false,
			}),
			is_error: true,
		})),
	};
}

// =============================================================================
// Failed Tool Call Feedback
// =============================================================================

export function buildFailedToolCallFeedback(
	toolResults: ToolCallRecord[],
): string {
	const failed = toolResults.filter((record) => !!record.error);
	if (failed.length === 0) {
		return "";
	}
	const details = failed
		.slice(0, 3)
		.map((record) => {
			const message = String(record.error ?? "unknown tool error")
				.replace(/\s+/g, " ")
				.trim();
			return `${record.name}: ${message}`;
		})
		.join("; ");
	return failed.length > 3
		? `${details}; +${failed.length - 3} more failed tool call(s)`
		: details;
}

// =============================================================================
// Mistake Tracking
// =============================================================================

export interface RecordMistakeInput {
	iteration: number;
	reason: "api_error" | "invalid_tool_call" | "tool_execution_failed";
	details?: string;
	/** When true, jump straight to maxConsecutiveMistakes instead of incrementing by 1. */
	forceAtLimit?: boolean;
	consecutiveMistakes: () => number;
	setConsecutiveMistakes: (value: number) => void;
}

export type MistakeOutcome =
	| { action: "continue" }
	| { action: "stop"; message: string; reason?: string };

export interface MistakeTrackingDeps {
	agentId: string;
	getConversationId: () => string;
	getActiveRunId: () => string;
	maxConsecutiveMistakes: number;
	onConsecutiveMistakeLimitReached?: (
		context: ConsecutiveMistakeLimitContext,
	) =>
		| Promise<ConsecutiveMistakeLimitDecision>
		| ConsecutiveMistakeLimitDecision;
	emit: (event: AgentEvent) => void;
	log: (
		level: "debug" | "info" | "warn" | "error",
		message: string,
		metadata?: Record<string, unknown>,
	) => void;
	appendRecoveryNotice: (
		message: string,
		reason: "api_error" | "invalid_tool_call" | "tool_execution_failed",
	) => void;
}

export async function recordMistake(
	input: RecordMistakeInput,
	deps: MistakeTrackingDeps,
): Promise<MistakeOutcome> {
	const max = deps.maxConsecutiveMistakes;
	const next =
		input.forceAtLimit && max ? max : input.consecutiveMistakes() + 1;
	input.setConsecutiveMistakes(next);
	const errorMessage =
		input.details?.trim() || `consecutive mistake (${input.reason})`;
	deps.emit({
		type: "error",
		error: new Error(errorMessage),
		recoverable: true,
		iteration: input.iteration,
	});
	deps.log("warn", "Recorded consecutive mistake", {
		agentId: deps.agentId,
		conversationId: deps.getConversationId(),
		runId: deps.getActiveRunId(),
		iteration: input.iteration,
		reason: input.reason,
		details: input.details,
		consecutiveMistakes: next,
		maxConsecutiveMistakes: deps.maxConsecutiveMistakes,
	});
	if (!deps.maxConsecutiveMistakes || next < deps.maxConsecutiveMistakes) {
		return { action: "continue" };
	}

	const decision = await resolveConsecutiveMistakeDecision(
		{
			iteration: input.iteration,
			consecutiveMistakes: next,
			maxConsecutiveMistakes: deps.maxConsecutiveMistakes,
			reason: input.reason,
			details: input.details,
		},
		deps.onConsecutiveMistakeLimitReached,
	);
	if (decision.action === "continue") {
		const guidance = decision.guidance?.trim();
		if (guidance) {
			deps.appendRecoveryNotice(guidance, input.reason);
		}
		input.setConsecutiveMistakes(0);
		return { action: "continue" };
	}
	return {
		action: "stop",
		reason: decision.reason?.trim() || undefined,
		message: buildMistakeLimitStopMessage({
			iteration: input.iteration,
			consecutiveMistakes: next,
			maxConsecutiveMistakes: deps.maxConsecutiveMistakes,
			reason: input.reason,
			details: input.details,
			stopReason: decision.reason,
		}),
	};
}

// =============================================================================
// Mistake Limit Stop Message
// =============================================================================

export function buildMistakeLimitStopMessage(input: {
	iteration: number;
	consecutiveMistakes: number;
	maxConsecutiveMistakes: number;
	reason:
		| "api_error"
		| "invalid_tool_call"
		| "completion_without_submit"
		| "tool_execution_failed";
	details?: string;
	stopReason?: string;
}): string {
	const parts = [
		`Stopped after ${input.consecutiveMistakes}/${input.maxConsecutiveMistakes} consecutive mistakes (${input.reason}) at iteration ${input.iteration}.`,
	];
	const details = input.details?.trim();
	if (details) {
		parts.push(`Latest failure: ${details}`);
	}
	const stopReason = input.stopReason?.trim();
	if (stopReason) {
		parts.push(`Decision: ${stopReason}`);
	}
	parts.push(
		"Session state was preserved. Send a new prompt to resume from the latest state.",
	);
	return parts.join(" ");
}

// =============================================================================
// Consecutive Mistake Decision Resolution
// =============================================================================

async function resolveConsecutiveMistakeDecision(
	input: ConsecutiveMistakeLimitContext,
	callback?: (
		context: ConsecutiveMistakeLimitContext,
	) =>
		| Promise<ConsecutiveMistakeLimitDecision>
		| ConsecutiveMistakeLimitDecision,
): Promise<ConsecutiveMistakeLimitDecision> {
	if (!callback) {
		return {
			action: "stop",
			reason: `maximum consecutive mistakes reached (${input.maxConsecutiveMistakes})`,
		};
	}
	try {
		return await callback(input);
	} catch (error) {
		return {
			action: "stop",
			reason:
				error instanceof Error
					? error.message
					: `maximum consecutive mistakes reached (${input.maxConsecutiveMistakes})`,
		};
	}
}
