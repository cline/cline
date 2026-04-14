import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import {
	type CoreSessionEvent,
	CoreSessionService,
	DefaultSessionManager,
	ProviderSettingsManager,
	SqliteSessionStore,
	setHomeDirIfUnset,
} from "@clinebot/core";
import type { AgentEvent } from "@clinebot/shared";
import { sessionLogPath } from "./paths";
import type { LiveSession, PromptInQueue, SidecarContext } from "./types";

// ---------------------------------------------------------------------------
// Helpers — WebSocket broadcast
// ---------------------------------------------------------------------------

function nowMs(): number {
	return Date.now();
}

function sendEvent(ctx: SidecarContext, name: string, payload: unknown): void {
	const encoded = JSON.stringify({
		type: "event",
		event: { name, payload },
	});
	for (const client of ctx.wsClients) {
		try {
			client.send(encoded);
		} catch {
			ctx.wsClients.delete(client);
		}
	}
}

function appendSessionChunk(
	sessionId: string,
	stream: string,
	chunk: string,
	ts: number,
): void {
	const path = sessionLogPath(sessionId);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify({ ts, stream, chunk })}\n`, {
		flag: "a",
	});
}

function emitChunk(
	ctx: SidecarContext,
	sessionId: string,
	stream: string,
	chunk: string,
): void {
	const ts = nowMs();
	appendSessionChunk(sessionId, stream, chunk, ts);
	sendEvent(ctx, "chat_event", { sessionId, stream, chunk, ts });
}

export { sendEvent, emitChunk, nowMs };

// ---------------------------------------------------------------------------
// Exported broadcast helpers (used by server.ts / commands)
// ---------------------------------------------------------------------------

export function broadcastEvent(
	ctx: SidecarContext,
	name: string,
	payload: unknown,
): void {
	sendEvent(ctx, name, payload);
}

export function broadcastChunk(
	ctx: SidecarContext,
	sessionId: string,
	stream: string,
	chunk: string,
): void {
	emitChunk(ctx, sessionId, stream, chunk);
}

// ---------------------------------------------------------------------------
// Prompt queue helpers
// ---------------------------------------------------------------------------

function getPromptsInQueue(session: LiveSession): PromptInQueue[] {
	return session.promptsInQueue;
}

function sendPromptsInQueueSnapshot(
	ctx: SidecarContext,
	sessionId: string,
): void {
	const session = ctx.liveSessions.get(sessionId);
	sendEvent(ctx, "prompts_in_queue_state", {
		sessionId,
		items: session ? getPromptsInQueue(session) : [],
	});
}

// ---------------------------------------------------------------------------
// Agent event mapping: AgentEvent → frontend transport chunks
// ---------------------------------------------------------------------------

function handleAgentEvent(
	ctx: SidecarContext,
	sessionId: string,
	event: AgentEvent,
): void {
	switch (event.type) {
		case "content_start": {
			if (event.contentType === "text" && event.text) {
				emitChunk(ctx, sessionId, "chat_text", event.text);
			} else if (event.contentType === "reasoning" && event.reasoning) {
				emitChunk(
					ctx,
					sessionId,
					"chat_reasoning",
					JSON.stringify({
						text: event.reasoning,
						redacted: event.redacted === true,
					}),
				);
			} else if (event.contentType === "tool") {
				emitChunk(
					ctx,
					sessionId,
					"chat_tool_call_start",
					JSON.stringify({
						toolCallId: event.toolCallId,
						toolName: event.toolName,
						input: event.input,
					}),
				);
			}
			break;
		}
		case "content_update": {
			if (event.contentType === "tool") {
				emitChunk(
					ctx,
					sessionId,
					"chat_tool_call_update",
					JSON.stringify({
						toolCallId: event.toolCallId,
						toolName: event.toolName,
						update: event.update,
					}),
				);
			}
			break;
		}
		case "content_end": {
			if (event.contentType === "text" && event.text) {
				emitChunk(ctx, sessionId, "chat_text", event.text);
			} else if (event.contentType === "reasoning" && event.reasoning) {
				emitChunk(
					ctx,
					sessionId,
					"chat_reasoning",
					JSON.stringify({
						text: event.reasoning,
						redacted: false,
					}),
				);
			} else if (event.contentType === "tool") {
				emitChunk(
					ctx,
					sessionId,
					"chat_tool_call_end",
					JSON.stringify({
						toolCallId: event.toolCallId,
						toolName: event.toolName,
						output: event.output,
						error: event.error,
						durationMs: event.durationMs,
					}),
				);
			}
			break;
		}
		case "notice": {
			emitChunk(
				ctx,
				sessionId,
				"chat_core_log",
				JSON.stringify({
					level: event.noticeType === "recovery" ? "warn" : "info",
					message: event.message,
					noticeType: event.noticeType,
					reason: event.reason,
				}),
			);
			break;
		}
		case "usage": {
			emitChunk(
				ctx,
				sessionId,
				"chat_usage",
				JSON.stringify({
					inputTokens: event.inputTokens,
					outputTokens: event.outputTokens,
					cacheReadTokens: event.cacheReadTokens,
					cacheWriteTokens: event.cacheWriteTokens,
					cost: event.cost,
					totalInputTokens: event.totalInputTokens,
					totalOutputTokens: event.totalOutputTokens,
					totalCost: event.totalCost,
				}),
			);
			break;
		}
		case "done": {
			const session = ctx.liveSessions.get(sessionId);
			if (session) {
				session.busy = false;
				session.status = event.reason === "completed" ? "idle" : event.reason;
			}
			emitChunk(
				ctx,
				sessionId,
				"chat_done",
				JSON.stringify({
					reason: event.reason,
					text: event.text,
					iterations: event.iterations,
					usage: event.usage,
				}),
			);
			break;
		}
		case "error": {
			const message =
				event.error instanceof Error
					? event.error.message
					: String(event.error);
			emitChunk(
				ctx,
				sessionId,
				"chat_core_log",
				JSON.stringify({
					level: "error",
					message,
				}),
			);
			break;
		}
		case "iteration_start":
		case "iteration_end":
			break;
	}
}

// ---------------------------------------------------------------------------
// CoreSessionEvent routing
// ---------------------------------------------------------------------------

function handleCoreSessionEvent(
	ctx: SidecarContext,
	event: CoreSessionEvent,
): void {
	switch (event.type) {
		case "chunk": {
			const { sessionId, stream, chunk } = event.payload;
			if (stream === "agent") break;
			emitChunk(ctx, sessionId, stream, chunk);
			break;
		}
		case "agent_event": {
			const { sessionId, event: agentEvent } = event.payload;
			handleAgentEvent(ctx, sessionId, agentEvent);
			break;
		}
		case "pending_prompts": {
			const { sessionId, prompts } = event.payload;
			const session = ctx.liveSessions.get(sessionId);
			const mapped: PromptInQueue[] = prompts
				.map((item) => ({
					id: item.id ?? "",
					prompt: item.prompt ?? "",
					steer: item.delivery === "steer",
					attachmentCount: item.attachmentCount ?? 0,
				}))
				.filter((item) => item.id && item.prompt);
			if (session) {
				const previous = session.promptsInQueue;
				session.promptsInQueue = mapped;
				if (
					previous.length > mapped.length &&
					previous[0] &&
					previous[0].id !== mapped[0]?.id
				) {
					emitChunk(
						ctx,
						sessionId,
						"chat_queued_prompt_start",
						JSON.stringify({
							prompt: previous[0].prompt,
							attachmentCount: previous[0].attachmentCount ?? 0,
						}),
					);
				}
			}
			sendPromptsInQueueSnapshot(ctx, sessionId);
			break;
		}
		case "pending_prompt_submitted": {
			const { sessionId, prompt, attachmentCount } = event.payload;
			emitChunk(
				ctx,
				sessionId,
				"chat_queued_prompt_start",
				JSON.stringify({
					prompt,
					attachmentCount: attachmentCount ?? 0,
				}),
			);
			break;
		}
		case "ended": {
			const { sessionId, reason } = event.payload;
			const session = ctx.liveSessions.get(sessionId);
			if (session) {
				session.busy = false;
				session.endedAt = nowMs();
				session.status = reason || "ended";
			}
			sendEvent(ctx, "chat_session_ended", { sessionId, reason });
			break;
		}
		case "hook": {
			const hookPayload = event.payload;
			emitChunk(
				ctx,
				hookPayload.sessionId,
				"chat_hook",
				JSON.stringify(hookPayload),
			);
			break;
		}
		case "status": {
			const { sessionId, status } = event.payload;
			const session = ctx.liveSessions.get(sessionId);
			if (session) {
				session.status = status;
				session.busy = status === "running";
			}
			sendEvent(ctx, "chat_session_status", { sessionId, status });
			break;
		}
		case "team_progress": {
			sendEvent(ctx, "team_progress", event.payload);
			break;
		}
	}
}

// ---------------------------------------------------------------------------
// Context factory
// ---------------------------------------------------------------------------

export function createSidecarContext(workspaceRoot: string): SidecarContext {
	return {
		liveSessions: new Map(),
		wsClients: new Set(),
		pendingApprovals: new Map(),
		sessionManager: null,
		workspaceRoot,
		unsubscribeSessionEvents: null,
	};
}

export async function initializeSessionManager(
	ctx: SidecarContext,
): Promise<void> {
	setHomeDirIfUnset(homedir());

	const store = new SqliteSessionStore();
	const sessionService = new CoreSessionService(store);
	const providerSettingsManager = new ProviderSettingsManager();

	const sessionManager = new DefaultSessionManager({
		sessionService,
		providerSettingsManager,
		defaultToolExecutors: {
			askQuestion: async (_question, options) => options[0] ?? "",
			submit: async (summary, verified) => {
				const status = verified ? "verified" : "unverified";
				return `Submission recorded (${status}): ${summary}`;
			},
		},
		requestToolApproval: async (request) => {
			const requestId = `${request.conversationId}_${request.toolCallId}`;
			const item = {
				requestId,
				sessionId: request.conversationId,
				createdAt: new Date().toISOString(),
				toolCallId: request.toolCallId,
				toolName: request.toolName,
				input: request.input,
				iteration: request.iteration,
				agentId: request.agentId,
				conversationId: request.conversationId,
			};

			return new Promise<{ approved: boolean; reason?: string }>((resolve) => {
				ctx.pendingApprovals.set(requestId, {
					request,
					resolve,
					item,
				});

				// Broadcast approval snapshot so the frontend renders the dialog
				const sessionApprovals = Array.from(ctx.pendingApprovals.values())
					.filter((a) => a.item.sessionId === request.conversationId)
					.map((a) => a.item);

				sendEvent(ctx, "tool_approval_state", {
					sessionId: request.conversationId,
					items: sessionApprovals,
				});
			});
		},
	});

	// Subscribe to all session events and relay them to WS clients
	const unsubscribe = sessionManager.subscribe((event: CoreSessionEvent) => {
		handleCoreSessionEvent(ctx, event);
	});

	ctx.sessionManager = sessionManager;
	ctx.unsubscribeSessionEvents = unsubscribe;
}
