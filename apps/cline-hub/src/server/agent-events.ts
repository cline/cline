import type { CoreSessionEvent } from "@cline/core";
import type { AgentEvent } from "@cline/shared";
import type { WebviewToolEvent } from "../webview-protocol";
import { rejectPendingApprovalsForSession } from "./approvals";
import type { HubContext } from "./state";
import { broadcastHubState } from "./state-payloads";
import { asString, chunkText } from "./utils";

function agentEventText(event: AgentEvent): string {
	if (
		event.type === "content_start" &&
		event.contentType === "text" &&
		typeof event.text === "string"
	) {
		return event.text;
	}
	return "";
}

function sendChunkToSelectedPeers(
	ctx: HubContext,
	sessionId: string,
	text: string,
): void {
	if (!text) return;
	ctx.sendToSelectedPeers(sessionId, { type: "assistant_delta", text });
}

function forwardAgentEvent(
	ctx: HubContext,
	sessionId: string,
	event: AgentEvent,
): void {
	if (event.type === "content_start") {
		if (event.contentType === "reasoning") {
			ctx.sendToSelectedPeers(sessionId, {
				type: "reasoning_delta",
				text: event.reasoning ?? event.text ?? "",
				redacted: event.redacted,
			});
			return;
		}
		if (event.contentType === "tool") {
			ctx.sendToSelectedPeers(sessionId, {
				type: "tool_event",
				text: `Running ${event.toolName ?? "tool"}...`,
				event: {
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					status: "running",
					input: event.input,
				},
			});
			return;
		}
		const text = agentEventText(event);
		if (text) sendChunkToSelectedPeers(ctx, sessionId, text);
		return;
	}
	if (event.type === "content_update" && event.contentType === "tool") {
		const toolEvent: WebviewToolEvent = {
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			status: "running",
			output: event.update,
		};
		ctx.sendToSelectedPeers(sessionId, {
			type: "tool_event",
			text: `${event.toolName ?? "tool"} updated`,
			event: toolEvent,
		});
		return;
	}
	if (event.type === "content_end") {
		if (event.contentType === "reasoning") {
			ctx.sendToSelectedPeers(sessionId, {
				type: "reasoning_delta",
				text: event.reasoning ?? event.text ?? "",
			});
			return;
		}
		if (event.contentType === "tool") {
			const toolName = event.toolName ?? "tool";
			ctx.sendToSelectedPeers(sessionId, {
				type: "tool_event",
				text: event.error
					? `${toolName} failed: ${event.error}`
					: `${toolName} completed`,
				event: {
					toolCallId: event.toolCallId,
					toolName,
					status: event.error ? "failed" : "completed",
					output: event.output,
					error: event.error,
				},
			});
		}
		return;
	}
	if (event.type === "notice") {
		ctx.sendToSelectedPeers(sessionId, { type: "status", text: event.message });
		return;
	}
	if (event.type === "done") {
		ctx.sendToSelectedPeers(sessionId, {
			type: "turn_done",
			finishReason: event.reason,
			iterations: event.iterations,
			usage: event.usage
				? {
						inputTokens: event.usage.inputTokens,
						outputTokens: event.usage.outputTokens,
						cacheCreationInputTokens: event.usage.cacheWriteTokens,
						cacheReadInputTokens: event.usage.cacheReadTokens,
						totalCost: event.usage.totalCost,
					}
				: undefined,
		});
		return;
	}
	if (event.type === "error") {
		ctx.sendToSelectedPeers(sessionId, {
			type: "error",
			text: event.error.message,
		});
	}
}

export function handleSessionEvent(
	ctx: HubContext,
	event: CoreSessionEvent,
): void {
	const payload = event.payload as Record<string, unknown> | undefined;
	const sessionId = asString(payload?.sessionId);
	if (!sessionId) return;
	if (event.type === "chunk") {
		const text = chunkText((payload as Record<string, unknown>).chunk);
		sendChunkToSelectedPeers(ctx, sessionId, text);
	} else if (event.type === "agent_event") {
		if (event.payload.teamRole === "teammate") return;
		forwardAgentEvent(ctx, sessionId, event.payload.event);
	} else if (event.type === "status") {
		const status = asString((payload as Record<string, unknown>).status);
		const tracked = ctx.sessions.get(sessionId);
		if (tracked && status) {
			tracked.status = status;
			tracked.updatedAt = Date.now();
		}
		for (const peer of ctx.peers) {
			if (peer.selectedSessionId === sessionId) {
				ctx.send(peer, {
					type: "status",
					text: status ?? "Session status changed.",
				});
			}
		}
		broadcastHubState(ctx);
	} else if (event.type === "ended") {
		rejectPendingApprovalsForSession(
			ctx,
			sessionId,
			"Session ended before approval was resolved.",
		);
		const tracked = ctx.sessions.get(sessionId);
		if (tracked) {
			tracked.status = "completed";
			tracked.updatedAt = Date.now();
		}
		for (const peer of ctx.peers) {
			if (peer.selectedSessionId === sessionId) {
				ctx.send(peer, {
					type: "turn_done",
					finishReason: event.payload.reason,
					iterations: 0,
				});
			}
		}
		broadcastHubState(ctx);
	}
}
