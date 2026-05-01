import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import {
	ClineCore,
	type CoreSessionEvent,
	NodeHubClient,
	type RuntimeCapabilities,
	setHomeDirIfUnset,
	type ToolApprovalRequest,
	type ToolApprovalResult,
	type ToolContext,
} from "@clinebot/core";
import type { AgentEvent } from "@clinebot/shared";
import { sessionLogPath } from "./paths";
import type {
	LiveSession,
	PendingAskQuestion,
	PendingToolApproval,
	PromptInQueue,
	SidecarContext,
} from "./types";

const ASK_QUESTION_TIMEOUT_MS = 5 * 60_000;

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
	const nextIndex = (ctx.streamIndices.get(sessionId) ?? 0) + 1;
	ctx.streamIndices.set(sessionId, nextIndex);
	sendEvent(ctx, "chat_event", {
		sessionId,
		stream,
		chunk,
		ts,
		index: nextIndex,
	});
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
			// Text and reasoning `content_start` events are already emitted as
			// incremental deltas. Runtime `content_end` carries the final full text,
			// so forwarding it as another chat_text/chat_reasoning chunk duplicates
			// the live UI while persisted history remains correct after hydration.
			if (event.contentType === "text" || event.contentType === "reasoning") {
				break;
			}
			if (event.contentType === "tool") {
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
		streamIndices: new Map(),
		wsClients: new Set(),
		pendingApprovals: new Map(),
		pendingQuestions: new Map(),
		sessionManager: null,
		hubClient: null,
		workspaceRoot,
		unsubscribeSessionEvents: null,
	};
}

export async function disposeSidecarContext(
	ctx: SidecarContext,
	reason = "code_sidecar_shutdown",
): Promise<void> {
	const cleanup: Array<Promise<unknown>> = [];

	ctx.unsubscribeSessionEvents?.();
	ctx.unsubscribeSessionEvents = null;

	for (const client of ctx.wsClients) {
		try {
			client.close?.();
		} catch {
			// Best-effort websocket close during shutdown.
		}
	}
	ctx.wsClients.clear();
	for (const pending of ctx.pendingApprovals.values()) {
		pending.resolve({ approved: false, reason });
	}
	ctx.pendingApprovals.clear();
	for (const pending of ctx.pendingQuestions.values()) {
		if (pending.timeoutId) clearTimeout(pending.timeoutId);
		pending.reject(new Error(reason));
	}
	ctx.pendingQuestions.clear();

	const hubClient = ctx.hubClient;
	ctx.hubClient = null;
	if (hubClient) {
		cleanup.push(hubClient.dispose());
	}

	const sessionManager = ctx.sessionManager;
	ctx.sessionManager = null;
	if (sessionManager) {
		cleanup.push(sessionManager.dispose(reason));
	}

	const results = await Promise.allSettled(cleanup);
	const firstFailure = results.find(
		(result): result is PromiseRejectedResult => result.status === "rejected",
	);
	if (firstFailure) {
		throw firstFailure.reason;
	}
}

function serializeQuestionContext(
	context: ToolContext,
): PendingAskQuestion["item"]["context"] {
	return {
		agentId: context.agentId,
		conversationId: context.conversationId,
		iteration: context.iteration,
		...(context.metadata ? { metadata: context.metadata } : {}),
	};
}

export function requestSidecarAskQuestion(
	ctx: SidecarContext,
	question: string,
	options: string[],
	context: ToolContext,
): Promise<string> {
	const choices = options
		.map((option) => option.trim())
		.filter((option) => option.length > 0)
		.slice(0, 5);
	if (choices.length === 0) {
		return Promise.resolve("");
	}

	return new Promise<string>((resolve, reject) => {
		const requestId = randomUUID();
		const timeoutId = setTimeout(() => {
			ctx.pendingQuestions.delete(requestId);
			reject(
				new Error(
					`Ask question request timed out after ${ASK_QUESTION_TIMEOUT_MS}ms`,
				),
			);
			sendEvent(ctx, "ask_question_cancelled", {
				requestId,
				reason: "timeout",
			});
		}, ASK_QUESTION_TIMEOUT_MS);
		const pending: PendingAskQuestion = {
			item: {
				requestId,
				createdAt: new Date().toISOString(),
				question,
				options: choices,
				context: serializeQuestionContext(context),
			},
			resolve,
			reject,
			timeoutId,
		};
		ctx.pendingQuestions.set(requestId, pending);
		sendEvent(ctx, "ask_question_requested", pending.item);
	});
}

export function resolveSidecarAskQuestion(
	ctx: SidecarContext,
	requestId: string,
	answer: string,
): boolean {
	const pending = ctx.pendingQuestions.get(requestId);
	if (!pending) {
		return false;
	}
	ctx.pendingQuestions.delete(requestId);
	if (pending.timeoutId) clearTimeout(pending.timeoutId);
	pending.resolve(answer);
	return true;
}

export function createSidecarRuntimeCapabilities(
	ctx: SidecarContext,
): RuntimeCapabilities {
	return {
		toolExecutors: {
			askQuestion: (question, options, context) =>
				requestSidecarAskQuestion(ctx, question, options, context),
		},
		requestToolApproval: (request) => requestSidecarToolApproval(ctx, request),
	};
}

function requestSidecarToolApproval(
	ctx: SidecarContext,
	request: ToolApprovalRequest,
): Promise<ToolApprovalResult> {
	return new Promise<ToolApprovalResult>((resolve) => {
		const requestId = randomUUID();
		const pending: PendingToolApproval = {
			item: {
				requestId,
				sessionId: request.sessionId,
				createdAt: new Date().toISOString(),
				toolCallId: request.toolCallId,
				toolName: request.toolName,
				input: request.input,
				iteration: request.iteration,
				agentId: request.agentId,
				conversationId: request.conversationId,
			},
			resolve,
		};
		ctx.pendingApprovals.set(requestId, pending);
		const sessionApprovals = Array.from(ctx.pendingApprovals.values())
			.filter((approval) => approval.item.sessionId === request.sessionId)
			.map((approval) => approval.item);
		sendEvent(ctx, "tool_approval_state", {
			sessionId: request.sessionId,
			items: sessionApprovals,
		});
	});
}

export function handleHubLiveEvent(
	ctx: SidecarContext,
	event: {
		event: string;
		sessionId?: string;
		payload?: Record<string, unknown>;
	},
): void {
	const sessionId = typeof event.sessionId === "string" ? event.sessionId : "";
	if (!sessionId) {
		return;
	}
	const session = ctx.liveSessions.get(sessionId);
	if (!session?.attachedViaHub) {
		return;
	}

	switch (event.event) {
		case "assistant.delta": {
			const text =
				typeof event.payload?.text === "string" ? event.payload.text : "";
			if (text) {
				emitChunk(ctx, sessionId, "chat_text", text);
			}
			return;
		}
		case "reasoning.delta": {
			const text =
				typeof event.payload?.text === "string" ? event.payload.text : "";
			const redacted = event.payload?.redacted === true;
			if (!text && !redacted) {
				return;
			}
			emitChunk(
				ctx,
				sessionId,
				"chat_reasoning",
				JSON.stringify({ text, redacted }),
			);
			return;
		}
		case "tool.started": {
			emitChunk(
				ctx,
				sessionId,
				"chat_tool_call_start",
				JSON.stringify({
					toolCallId:
						typeof event.payload?.toolCallId === "string"
							? event.payload.toolCallId
							: undefined,
					toolName:
						typeof event.payload?.toolName === "string"
							? event.payload.toolName
							: "tool",
					input: event.payload?.input,
				}),
			);
			return;
		}
		case "tool.finished": {
			emitChunk(
				ctx,
				sessionId,
				"chat_tool_call_end",
				JSON.stringify({
					toolCallId:
						typeof event.payload?.toolCallId === "string"
							? event.payload.toolCallId
							: undefined,
					toolName:
						typeof event.payload?.toolName === "string"
							? event.payload.toolName
							: "tool",
					output: event.payload?.output,
					error:
						typeof event.payload?.error === "string"
							? event.payload.error
							: undefined,
				}),
			);
			return;
		}
		case "run.started":
		case "session.attached":
		case "session.updated": {
			const payloadSession =
				event.payload?.session &&
				typeof event.payload.session === "object" &&
				!Array.isArray(event.payload.session)
					? (event.payload.session as Record<string, unknown>)
					: undefined;
			const status =
				typeof payloadSession?.status === "string"
					? payloadSession.status
					: event.event === "run.started"
						? "running"
						: session.status;
			session.status = status;
			session.busy = status === "running";
			sendEvent(ctx, "chat_session_status", { sessionId, status });
			return;
		}
		case "run.completed":
		case "run.failed":
		case "run.aborted": {
			const reason =
				typeof event.payload?.reason === "string"
					? event.payload.reason
					: event.event === "run.aborted"
						? "aborted"
						: event.event === "run.failed"
							? "error"
							: "completed";
			session.status = reason;
			session.busy = false;
			session.endedAt = nowMs();
			sendEvent(ctx, "chat_session_ended", { sessionId, reason });
			return;
		}
		default:
			return;
	}
}

export async function initializeSessionManager(
	ctx: SidecarContext,
): Promise<void> {
	setHomeDirIfUnset(homedir());
	const sessionManager = await ClineCore.create({
		backendMode: "hub",
		capabilities: createSidecarRuntimeCapabilities(ctx),
		hub: {
			workspaceRoot: ctx.workspaceRoot,
			cwd: ctx.workspaceRoot,
			clientType: "code-sidecar",
			displayName: "Code App sidecar",
		},
	});

	// Subscribe to all session events and relay them to WS clients
	const unsubscribe = sessionManager.subscribe((event: CoreSessionEvent) => {
		handleCoreSessionEvent(ctx, event);
	});

	const runtimeAddress = sessionManager.runtimeAddress?.trim();
	let hubClient: NodeHubClient | null = null;
	if (runtimeAddress) {
		hubClient = new NodeHubClient({
			url: runtimeAddress,
			clientType: "code-sidecar-approvals",
			displayName: "Code App approvals",
			workspaceRoot: ctx.workspaceRoot,
			cwd: ctx.workspaceRoot,
		});
		await hubClient.connect();
		hubClient.subscribe((event) => {
			handleHubLiveEvent(ctx, event);
		});
	}

	ctx.sessionManager = sessionManager;
	ctx.hubClient = hubClient;
	ctx.unsubscribeSessionEvents = unsubscribe;
}
