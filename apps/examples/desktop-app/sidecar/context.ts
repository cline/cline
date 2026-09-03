import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname } from "node:path";
import {
	type AgentToolContext,
	type BasicLogger,
	ClineCore,
	type CoreSessionEvent,
	ensureCompatibleLocalHubUrl,
	type ITelemetryService,
	NodeHubClient,
	type RuntimeCapabilities,
	setHomeDirIfUnset,
	type ToolApprovalRequest,
	type ToolApprovalResult,
} from "@cline/core";
import {
	type AgentEvent,
	HUB_CLIENT_TOOL_APPROVAL_CAPABILITY,
	isGeneratedMedia,
} from "@cline/shared";
import {
	discardAllTrackedAttachments,
	flushConsumedAttachments,
	markQueuedAttachmentsSubmitted,
	reconcileQueuedAttachments,
} from "./attachments";
import {
	disposeDesktopFeatureFlagsService,
	getDesktopFeatureFlagsService,
} from "./feature-flags";
import { sessionLogPath } from "./paths";
import type {
	LiveSession,
	PendingAskQuestion,
	PendingToolApproval,
	PromptInQueue,
	SidecarContext,
	SidecarWebSocketClient,
} from "./types";

const ASK_QUESTION_TIMEOUT_MS = 5 * 60_000;
const hubClientInitialization = new WeakMap<
	SidecarContext,
	Promise<NodeHubClient>
>();
const approvalReadinessUpdates = new WeakMap<SidecarContext, Promise<void>>();

// ---------------------------------------------------------------------------
// Helpers — WebSocket broadcast
// ---------------------------------------------------------------------------

function nowMs(): number {
	return Date.now();
}

export function encodeSidecarEvent(name: string, payload: unknown): string {
	return JSON.stringify({
		type: "event",
		event: { name, payload },
	});
}

function sendEvent(ctx: SidecarContext, name: string, payload: unknown): void {
	const encoded = encodeSidecarEvent(name, payload);
	for (const client of ctx.wsClients) {
		try {
			client.send(encoded);
		} catch {
			ctx.wsClients.delete(client);
			cancelSidecarToolApprovalsForOwner(ctx, client);
			void syncSidecarApprovalReadiness(ctx).catch((error) =>
				ctx.logger?.error?.("Hub approval readiness update failed", { error }),
			);
		}
	}
}

export function sendEventToClient(
	ctx: SidecarContext,
	client: SidecarWebSocketClient,
	name: string,
	payload: unknown,
): boolean {
	try {
		client.send(encodeSidecarEvent(name, payload));
		return true;
	} catch {
		ctx.wsClients.delete(client);
		cancelSidecarToolApprovalsForOwner(ctx, client);
		void syncSidecarApprovalReadiness(ctx).catch((error) =>
			ctx.logger?.error?.("Hub approval readiness update failed", { error }),
		);
		return false;
	}
}

export function cancelSidecarToolApprovalsForOwner(
	ctx: SidecarContext,
	owner: SidecarWebSocketClient,
): void {
	for (const [requestId, pending] of ctx.pendingApprovals) {
		if (pending.owner !== owner) continue;
		ctx.pendingApprovals.delete(requestId);
		pending.resolve({
			approved: false,
			reason: "Desktop approval surface disconnected",
		});
	}
}

export function syncSidecarApprovalReadiness(
	ctx: SidecarContext,
): Promise<void> {
	const previous = approvalReadinessUpdates.get(ctx) ?? Promise.resolve();
	const update = previous
		.catch(() => undefined)
		.then(async () => {
			const hubClient = ctx.hubClient;
			if (!hubClient) return;
			await hubClient.updateCapabilities(
				[...ctx.wsClients].some(
					(client) => client.data?.canApproveTools === true,
				)
					? [
							{
								name: HUB_CLIENT_TOOL_APPROVAL_CAPABILITY,
								description:
									"Cline Code has a live user surface for tool review.",
							},
						]
					: [],
			);
		});
	approvalReadinessUpdates.set(ctx, update);
	return update.finally(() => {
		if (approvalReadinessUpdates.get(ctx) === update) {
			approvalReadinessUpdates.delete(ctx);
		}
	});
}

// Session log appends are chained per session so writes stay ordered, but
// they run asynchronously: a synchronous write per streamed token would stall
// the sidecar event loop (and therefore every pending UI command) under load.
const sessionLogWriteTails = new Map<string, Promise<void>>();

function appendSessionChunk(
	sessionId: string,
	stream: string,
	chunk: string,
	ts: number,
): void {
	const path = sessionLogPath(sessionId);
	const line = `${JSON.stringify({ ts, stream, chunk })}\n`;
	const tail = sessionLogWriteTails.get(sessionId) ?? Promise.resolve();
	const next = tail
		.then(async () => {
			await mkdir(dirname(path), { recursive: true });
			await appendFile(path, line);
		})
		.catch(() => {
			// Session logs are best-effort diagnostics; never fail the stream.
		});
	sessionLogWriteTails.set(sessionId, next);
	void next.finally(() => {
		if (sessionLogWriteTails.get(sessionId) === next) {
			sessionLogWriteTails.delete(sessionId);
		}
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
	return session.promptsInQueue.map(
		({ id, prompt, steer, attachmentCount, userImages }) => ({
			id,
			prompt,
			steer,
			attachmentCount,
			userImages,
		}),
	);
}

export function serializeQueuedPromptStart(input: {
	promptId: string;
	prompt: string;
	attachmentCount?: number;
	userImages?: string[];
}): string {
	return JSON.stringify({
		promptId: input.promptId,
		prompt: input.prompt,
		attachmentCount: input.attachmentCount ?? 0,
		userImages: input.userImages,
	});
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
			if (event.contentType === "media" && event.media) {
				emitChunk(ctx, sessionId, "chat_media", JSON.stringify(event.media));
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

// The runtime's queue drain emits a pending_prompts snapshot (head removed)
// and a pending_prompt_submitted event for the same prompt back-to-back, and
// both are translated here into chat_queued_prompt_start — dedupe by prompt
// id or the UI renders the user message twice.
function emitQueuedPromptStart(
	ctx: SidecarContext,
	sessionId: string,
	session: LiveSession | undefined,
	input: {
		promptId: string;
		prompt: string;
		attachmentCount: number;
		userImages?: string[];
	},
): void {
	if (session) {
		if (session.lastQueuedPromptStartId === input.promptId) {
			return;
		}
		session.lastQueuedPromptStartId = input.promptId;
	}
	emitChunk(
		ctx,
		sessionId,
		"chat_queued_prompt_start",
		serializeQueuedPromptStart(input),
	);
}

export function handleCoreSessionEvent(
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
					userImages: item.userImages,
				}))
				.filter(
					(item) => item.id && (item.prompt || (item.attachmentCount ?? 0) > 0),
				);
			if (session) {
				reconcileQueuedAttachments(
					session,
					mapped.map((item) => item.id),
				);
				const previous = session.promptsInQueue;
				session.promptsInQueue = mapped;
				if (
					previous.length > mapped.length &&
					previous[0] &&
					previous[0].id !== mapped[0]?.id
				) {
					emitQueuedPromptStart(ctx, sessionId, session, {
						promptId: previous[0].id,
						prompt: previous[0].prompt,
						attachmentCount: previous[0].attachmentCount ?? 0,
						userImages: previous[0].userImages,
					});
				}
			}
			sendPromptsInQueueSnapshot(ctx, sessionId);
			break;
		}
		case "pending_prompt_submitted": {
			const { sessionId, id, prompt, attachmentCount, userImages } =
				event.payload;
			const session = ctx.liveSessions.get(sessionId);
			markQueuedAttachmentsSubmitted(session, id);
			emitQueuedPromptStart(ctx, sessionId, session, {
				promptId: id,
				prompt,
				attachmentCount: attachmentCount ?? 0,
				userImages,
			});
			// The prompt left the queue; without a fresh snapshot the webview
			// keeps a stale busy queue and the composer never returns to idle
			// after the turn completes.
			if (session) {
				const remaining = session.promptsInQueue.filter(
					(item) => item.id !== id,
				);
				if (remaining.length !== session.promptsInQueue.length) {
					session.promptsInQueue = remaining;
					sendPromptsInQueueSnapshot(ctx, sessionId);
				}
			}
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
			discardAllTrackedAttachments(sessionId, session);
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
				if (status !== "running") {
					// The turn that consumed submitted attachments has finished.
					flushConsumedAttachments(sessionId, session);
				}
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

export function createSidecarContext(
	workspaceRoot: string,
	observability: {
		logger?: BasicLogger;
		telemetry?: ITelemetryService;
	} = {},
): SidecarContext {
	return {
		liveSessions: new Map(),
		restoringWorkspacePaths: new Set(),
		streamIndices: new Map(),
		wsClients: new Set(),
		pendingApprovals: new Map(),
		pendingQuestions: new Map(),
		sessionManager: null,
		hubClient: null,
		workspaceRoot,
		logger: observability.logger,
		telemetry: observability.telemetry,
		unsubscribeSessionEvents: null,
		hubBuildMismatch: null,
	};
}

export async function disposeSidecarContext(
	ctx: SidecarContext,
	reason = "code_sidecar_shutdown",
): Promise<void> {
	const cleanup: Array<Promise<unknown>> = [];

	ctx.unsubscribeSessionEvents?.();
	ctx.unsubscribeSessionEvents = null;

	for (const [sessionId, session] of ctx.liveSessions) {
		discardAllTrackedAttachments(sessionId, session);
	}
	ctx.liveSessions.clear();

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

	// Shuts down the PostHog client the feature flags service owns, flushing
	// any pending $feature_flag_called events.
	cleanup.push(disposeDesktopFeatureFlagsService());

	const results = await Promise.allSettled(cleanup);
	const firstFailure = results.find(
		(result): result is PromiseRejectedResult => result.status === "rejected",
	);
	if (firstFailure) {
		throw firstFailure.reason;
	}
}

function serializeQuestionContext(
	context: AgentToolContext,
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
	context: AgentToolContext,
): Promise<string> {
	const sessionId = context.sessionId?.trim();
	if (!sessionId) {
		return Promise.reject(
			new Error("ask_question requires an active session ID"),
		);
	}
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
				sessionId,
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
	const owner = [...ctx.wsClients].find(
		(client) => client.data?.canApproveTools === true,
	);
	if (!owner) {
		return Promise.resolve({
			approved: false,
			reason: "No trusted desktop approval surface is connected",
		});
	}
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
			owner,
			resolve,
		};
		ctx.pendingApprovals.set(requestId, pending);
		const sessionApprovals = Array.from(ctx.pendingApprovals.values())
			.filter(
				(approval) =>
					approval.owner === owner &&
					approval.item.sessionId === request.sessionId,
			)
			.map((approval) => approval.item);
		if (
			!sendEventToClient(ctx, owner, "tool_approval_state", {
				sessionId: request.sessionId,
				items: sessionApprovals,
			})
		) {
			cancelSidecarToolApprovalsForOwner(ctx, owner);
		}
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
	if (event.event === "approval.requested") {
		if (typeof event.payload?.agendaTaskId !== "string") return;
		void handleHubApprovalRequest(ctx, event).catch((error) => {
			ctx.logger?.error?.("Hub task approval forwarding failed", { error });
		});
		return;
	}
	// Task lifecycle events are Hub-wide invalidations and usually do not have a
	// session yet (pending and approved tasks explicitly predate their session).
	// Forward them before the session-only live-chat projection below so Agenda
	// surfaces stay current without polling.
	if (event.event.startsWith("task.")) {
		sendEvent(ctx, event.event, {
			...(event.payload ?? {}),
			...(event.sessionId ? { sessionId: event.sessionId } : {}),
		});
		return;
	}
	if (event.event === "settings.changed") {
		sendEvent(ctx, event.event, event.payload ?? {});
		return;
	}

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
		case "assistant.media": {
			const media = event.payload?.media;
			if (isGeneratedMedia(media)) {
				emitChunk(ctx, sessionId, "chat_media", JSON.stringify(media));
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
		case "tool.updated": {
			emitChunk(
				ctx,
				sessionId,
				"chat_tool_call_update",
				JSON.stringify({
					toolCallId:
						typeof event.payload?.toolCallId === "string"
							? event.payload.toolCallId
							: undefined,
					toolName:
						typeof event.payload?.toolName === "string"
							? event.payload.toolName
							: "tool",
					update: event.payload?.update,
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

async function handleHubApprovalRequest(
	ctx: SidecarContext,
	event: {
		sessionId?: string;
		payload?: Record<string, unknown>;
	},
): Promise<void> {
	const sessionId = event.sessionId?.trim() || "";
	const approvalId =
		typeof event.payload?.approvalId === "string"
			? event.payload.approvalId.trim()
			: "";
	const toolCallId =
		typeof event.payload?.toolCallId === "string"
			? event.payload.toolCallId.trim()
			: "";
	const toolName =
		typeof event.payload?.toolName === "string"
			? event.payload.toolName.trim()
			: "";
	if (!sessionId || !approvalId || !toolCallId || !toolName) return;
	let input: unknown;
	try {
		input =
			typeof event.payload?.inputJson === "string"
				? JSON.parse(event.payload.inputJson)
				: undefined;
	} catch {
		input = undefined;
	}
	const result = await requestSidecarToolApproval(ctx, {
		sessionId,
		agentId:
			typeof event.payload?.agentId === "string" ? event.payload.agentId : "",
		conversationId:
			typeof event.payload?.conversationId === "string"
				? event.payload.conversationId
				: sessionId,
		iteration:
			typeof event.payload?.iteration === "number"
				? event.payload.iteration
				: 0,
		toolCallId,
		toolName,
		input,
		policy:
			event.payload?.policy &&
			typeof event.payload.policy === "object" &&
			!Array.isArray(event.payload.policy)
				? (event.payload.policy as ToolApprovalRequest["policy"])
				: { autoApprove: false },
	});
	const client = ctx.hubClient;
	if (!client)
		throw new Error("Hub client disconnected before approval response");
	await client.command(
		"approval.respond",
		{
			approvalId,
			approved: result.approved,
			reason: result.reason,
		},
		sessionId,
	);
}

export async function initializeSessionManager(
	ctx: SidecarContext,
): Promise<void> {
	setHomeDirIfUnset(homedir());
	const sessionManager = await ClineCore.create({
		clientName: "cline-code",
		backendMode: "hub",
		capabilities: createSidecarRuntimeCapabilities(ctx),
		logger: ctx.logger,
		telemetry: ctx.telemetry,
		featureFlags: getDesktopFeatureFlagsService({
			logger: ctx.logger,
			telemetry: ctx.telemetry,
		}),
		hub: {
			strategy: "require-hub",
			workspaceRoot: ctx.workspaceRoot,
			cwd: ctx.workspaceRoot,
			clientType: "code-sidecar",
			displayName: "Cline Desktop sidecar",
		},
	});

	// Subscribe to all session events and relay them to WS clients
	const unsubscribe = sessionManager.subscribe((event: CoreSessionEvent) => {
		handleCoreSessionEvent(ctx, event);
	});

	try {
		await ensureSharedHubClient(ctx, sessionManager.runtimeAddress);
	} catch (error) {
		unsubscribe();
		await sessionManager.dispose("code_sidecar_hub_initialization_failed");
		throw error;
	}

	ctx.sessionManager = sessionManager;
	ctx.unsubscribeSessionEvents = unsubscribe;
}

export async function ensureSharedHubClient(
	ctx: SidecarContext,
	preferredUrl?: string,
): Promise<NodeHubClient> {
	if (ctx.hubClient) {
		return ctx.hubClient;
	}
	const pending = hubClientInitialization.get(ctx);
	if (pending) {
		return await pending;
	}

	const initialization = (async () => {
		const url =
			preferredUrl?.trim() ||
			(await ensureCompatibleLocalHubUrl({
				strategy: "require-hub",
				workspaceRoot: ctx.workspaceRoot,
				cwd: ctx.workspaceRoot,
			}));
		if (!url) {
			throw new Error("Unable to start or connect to the shared Cline Hub.");
		}

		const client = new NodeHubClient({
			url,
			clientType: "code-sidecar-observer",
			displayName: "Cline Desktop observer",
			workspaceRoot: ctx.workspaceRoot,
			cwd: ctx.workspaceRoot,
		});
		try {
			await client.connect();
			client.subscribe((event) => {
				handleHubLiveEvent(ctx, event);
			});
			ctx.hubClient = client;
			await syncSidecarApprovalReadiness(ctx);
			return client;
		} catch (error) {
			await client.dispose().catch(() => undefined);
			throw error;
		}
	})().finally(() => {
		hubClientInitialization.delete(ctx);
	});

	hubClientInitialization.set(ctx, initialization);
	return await initialization;
}
