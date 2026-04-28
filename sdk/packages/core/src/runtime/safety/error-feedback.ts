/**
 * Pure error-classification and tool-call-feedback helpers.
 *
 * @see PLAN.md §3.1 — moved from `packages/agents/src/api/error-handling.ts` lines 20–145.
 *
 * Consumed by `SessionRuntime` (and `MistakeTracker`) when composing
 * follow-up turns after API failures or invalid tool calls.
 */

import type * as LlmsProviders from "@clinebot/llms";
import type { ToolCallRecord } from "@clinebot/shared";

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

export interface InvalidToolCall {
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
	invalidToolCalls: readonly InvalidToolCall[],
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
	invalidToolCalls: readonly InvalidToolCall[],
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
	toolResults: readonly ToolCallRecord[],
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
