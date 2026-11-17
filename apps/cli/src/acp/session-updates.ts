import type {
	AgentSideConnection,
	SessionConfigOption,
	SessionUpdate,
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
	contextWindowSize?: number,
	cumulativeCost?: number,
): void {
	const updates = translateEvent(event, contextWindowSize, cumulativeCost);
	for (const update of updates) {
		void conn.sessionUpdate({ sessionId, update });
	}
}

function translateEvent(
	event: AgentEvent,
	contextWindowSize?: number,
	cumulativeCost?: number,
): SessionUpdate[] {
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
		case "usage":
			return translateUsage(event, contextWindowSize, cumulativeCost);
		default:
			return [];
	}
}

function translateUsage(
	event: AgentEvent & { type: "usage" },
	contextWindowSize?: number,
	cumulativeCost?: number,
): SessionUpdate[] {
	if (typeof contextWindowSize !== "number" || contextWindowSize <= 0) {
		return [];
	}
	const used =
		(event.inputTokens ?? 0) +
		(event.cacheReadTokens ?? 0) +
		(event.cacheWriteTokens ?? 0);
	const costAmount = cumulativeCost ?? event.totalCost ?? event.cost;
	return [
		{
			sessionUpdate: "usage_update",
			used,
			size: contextWindowSize,
			...(typeof costAmount === "number"
				? { cost: { amount: costAmount, currency: "USD" } }
				: {}),
		},
	];
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

/**
 * Send a usage_update notification to the client when the context window size is known.
 */
export function sendUsageUpdate(
	conn: AgentSideConnection,
	sessionId: string,
	usage: { used: number; size?: number; costAmount?: number },
): void {
	if (typeof usage.size !== "number" || usage.size <= 0) {
		return;
	}
	void conn.sessionUpdate({
		sessionId,
		update: {
			sessionUpdate: "usage_update",
			used: usage.used,
			size: usage.size,
			...(typeof usage.costAmount === "number"
				? { cost: { amount: usage.costAmount, currency: "USD" } }
				: {}),
		},
	});
}
