import type {
	AgentSideConnection,
	SessionConfigOption,
	SessionUpdate,
	Usage,
} from "@agentclientprotocol/sdk";
import type { AgentEvent } from "@cline/core";
import type { GeneratedMedia } from "@cline/shared";
import { getErrorMessage } from "@cline/shared";
import { buildToolTitle, mapToolKind } from "./tool-utils";

/**
 * Maps an AgentEvent to zero or more ACP SessionUpdate notifications,
 * sending each via the connection's sessionUpdate method.
 */
export function forwardAgentEvent(
	conn: AgentSideConnection,
	sessionId: string,
	event: AgentEvent,
): void {
	const updates = translateEvent(event);
	for (const update of updates) {
		void conn.sessionUpdate({ sessionId, update });
	}
}

function translateEvent(event: AgentEvent): SessionUpdate[] {
	switch (event.type) {
		case "content_start":
			return translateContentStart(event);
		case "content_end":
			return translateContentEnd(event);
		case "done":
			return [];
		case "error":
			return [];
		case "iteration_start":
		case "iteration_end":
			return [];
		// Usage needs the model's context window, which the agent knows and this
		// mapping does not: see `usageUpdateFor`, sent from `AcpAgent`.
		case "usage":
			return [];
		default:
			return [];
	}
}

function translateContentStart(
	event: AgentEvent & { type: "content_start" },
): SessionUpdate[] {
	switch (event.contentType) {
		case "text": {
			if (!event.text) return [];
			return [
				{
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: event.text },
				},
			];
		}
		case "reasoning": {
			if (!event.reasoning) return [];
			return [
				{
					sessionUpdate: "agent_thought_chunk",
					content: { type: "text", text: event.reasoning },
				},
			];
		}
		case "tool": {
			const toolCallId = event.toolCallId ?? "unknown";
			const toolName = event.toolName ?? "unknown";
			return [
				{
					sessionUpdate: "tool_call",
					toolCallId,
					title: buildToolTitle(toolName, event.input),
					kind: mapToolKind(toolName),
					status: "pending",
					rawInput: event.input,
				},
			];
		}
		default:
			return [];
	}
}

export function describeAgentError(error: unknown): string {
	const message = getErrorMessage(error).trim();
	return message || "The agent reported an unknown error.";
}

function translateContentEnd(
	event: AgentEvent & { type: "content_end" },
): SessionUpdate[] {
	const e = event as {
		type: "content_end";
		contentType: string;
		text?: string;
		reasoning?: string;
		toolName?: string;
		toolCallId?: string;
		output?: unknown;
		error?: string;
		durationMs?: number;
		media?: GeneratedMedia;
	};

	switch (e.contentType) {
		case "text":
			// Text was already streamed via content_start chunks; don't re-send.
			return [];
		case "reasoning":
			// Reasoning was already streamed via content_start chunks; don't re-send.
			return [];
		case "media":
			if (!e.media) return [];
			if (e.media.modality !== "image" || e.media.source.type !== "base64") {
				return [
					{
						sessionUpdate: "agent_message_chunk",
						content: {
							type: "text",
							text: `[Generated ${e.media.modality}: ${e.media.mediaType}]`,
						},
					},
				];
			}
			return [
				{
					sessionUpdate: "agent_message_chunk",
					content: {
						type: "image",
						data: e.media.source.data,
						mimeType: e.media.mediaType,
					},
				},
			];
		case "tool": {
			const toolCallId = e.toolCallId ?? "unknown";
			const failed = !!e.error;
			return [
				{
					sessionUpdate: "tool_call_update",
					toolCallId,
					status: failed ? "failed" : "completed",
					rawOutput: e.error ?? e.output,
				},
			];
		}
		default:
			return [];
	}
}

/**
 * Send a current_mode_update notification to the client.
 */
export function sendCurrentModeUpdate(
	conn: AgentSideConnection,
	sessionId: string,
	modeId: string,
): void {
	void conn.sessionUpdate({
		sessionId,
		update: { sessionUpdate: "current_mode_update", currentModeId: modeId },
	});
}

/**
 * Send a config_option_update notification to the client.
 */
export function sendConfigOptionUpdate(
	conn: AgentSideConnection,
	sessionId: string,
	configOptions: Array<SessionConfigOption>,
): void {
	void conn.sessionUpdate({
		sessionId,
		update: { sessionUpdate: "config_option_update", configOptions },
	});
}

/**
 * Send a session_info_update notification to the client.
 */
export function sendSessionInfoUpdate(
	conn: AgentSideConnection,
	sessionId: string,
	info: { title?: string | null; updatedAt?: string | null },
): void {
	void conn.sessionUpdate({
		sessionId,
		update: { sessionUpdate: "session_info_update", ...info },
	});
}

type AgentUsageEvent = AgentEvent & { type: "usage" };

/**
 * The ACP `usage_update` for one model call: how much of the context window
 * it filled and the session's cost so far.
 *
 * `used` counts the call's whole prompt and its reply — input, cache reads,
 * cache writes and output — the same total Cline shows as context used. A
 * subagent's call fills the subagent's context, not the session's, so it is
 * not reported here; nor is a call whose model has no known context window,
 * since `size` is required.
 */
export function usageUpdateFor(
	event: AgentUsageEvent,
	contextWindow: number | undefined,
): SessionUpdate | null {
	if (event.parentAgentId) return null;
	if (!contextWindow || contextWindow <= 0) return null;
	const used =
		event.inputTokens +
		event.outputTokens +
		(event.cacheReadTokens ?? 0) +
		(event.cacheWriteTokens ?? 0);
	return {
		sessionUpdate: "usage_update",
		used,
		size: contextWindow,
		...(typeof event.totalCost === "number"
			? { cost: { amount: event.totalCost, currency: "USD" } }
			: {}),
	};
}

/** A turn's token usage in the shape `PromptResponse.usage` takes. */
export function promptUsageFrom(
	usage:
		| {
				inputTokens: number;
				outputTokens: number;
				cacheReadTokens?: number;
				cacheWriteTokens?: number;
		  }
		| undefined,
): Usage | undefined {
	if (!usage) return undefined;
	const cachedReadTokens = usage.cacheReadTokens ?? 0;
	const cachedWriteTokens = usage.cacheWriteTokens ?? 0;
	return {
		inputTokens: usage.inputTokens,
		outputTokens: usage.outputTokens,
		...(cachedReadTokens ? { cachedReadTokens } : {}),
		...(cachedWriteTokens ? { cachedWriteTokens } : {}),
		totalTokens:
			usage.inputTokens +
			usage.outputTokens +
			cachedReadTokens +
			cachedWriteTokens,
	};
}
