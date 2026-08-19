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
	readHubDiscovery,
	resolveHubOwnerContext,
	setHomeDirIfUnset,
	stopLocalHubServerGracefully,
	type ToolApprovalRequest,
	type ToolApprovalResult,
} from "@cline/core";
import {
	type AgentEvent,
	type AgentTool,
	createTool,
	isGeneratedMedia,
} from "@cline/shared";
import {
	discardAllTrackedAttachments,
	flushConsumedAttachments,
	markQueuedAttachmentsSubmitted,
	reconcileQueuedAttachments,
} from "./attachments";
import { sessionLogPath } from "./paths";
import type {
	LiveSession,
	MessageBotMode,
	MessageBotRequestItem,
	MessageBotResult,
	PendingAskQuestion,
	PendingMessageBot,
	PendingToolApproval,
	PromptInQueue,
	SidecarContext,
} from "./types";

const ASK_QUESTION_TIMEOUT_MS = 5 * 60_000;
const MESSAGE_BOT_FIRE_AND_FORGET_TIMEOUT_MS = 30_000;
const MESSAGE_BOT_MIN_AWAIT_TIMEOUT_MS = 5_000;
const MESSAGE_BOT_MAX_AWAIT_TIMEOUT_MS = 600_000;
const MESSAGE_BOT_DEFAULT_AWAIT_TIMEOUT_MS = 120_000;
// Sidecar-side safety net *beyond* the caller's own requested timeout - the
// webview's own relay work (bot lookup, resolving the target's endpoint,
// possibly cold-starting its daemon via get_desktop_backend_endpoint's own
// 3x-retried startup, connecting, then attach/start) all happens BEFORE the
// timed portion (the actual send) even begins, so a buffer that only covers
// network jitter would let this timeout fire first and orphan the webview's
// real result once it does land - resolveSidecarMessageBot would find the
// pending entry already gone.
const MESSAGE_BOT_TIMEOUT_BUFFER_MS = 30_000;
// The SDK's own createTool() defaults an AgentTool's timeoutMs to 30s
// (sdk/packages/shared/src/tools/create.ts) - far shorter than await_reply's
// own max wait. Must exceed the longest possible internal wait
// (MESSAGE_BOT_MAX_AWAIT_TIMEOUT_MS + its buffer) or the SDK's own tool-call
// timeout would kill execute() before requestSidecarMessageBot ever settles.
const MESSAGE_BOT_TOOL_TIMEOUT_MS =
	MESSAGE_BOT_MAX_AWAIT_TIMEOUT_MS + MESSAGE_BOT_TIMEOUT_BUFFER_MS + 10_000;
const hubClientInitialization = new WeakMap<
	SidecarContext,
	Promise<NodeHubClient>
>();

// A transient hiccup on this very first connect (e.g. a brief accept-queue
// stall right after the daemon starts listening) must not be fatal: this URL
// was already verified reachable moments earlier by ensureCompatibleLocalHubUrl
// (or handed in as an already-running daemon's address), so a failed first
// attempt is worth retrying rather than crashing sidecar startup outright.
const HUB_CLIENT_CONNECT_RETRY_ATTEMPTS = 3;
const HUB_CLIENT_CONNECT_RETRY_DELAY_MS = 300;

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The Hub daemon requires this token on every connection (it's not
 * optional) - without it the WS upgrade is rejected outright, which
 * surfaces as a generic "Connection ended" with no indication it was an
 * auth problem. Neither ensureCompatibleLocalHubUrl (returns just a URL)
 * nor ClineCore.create()'s own `hub` options default it in, so every
 * connection this file establishes - the observer client below and
 * ClineCore's own internal Hub connection in initializeSessionManager -
 * reads it fresh here from the same discovery record the SDK's own
 * connection resolution reads.
 */
async function resolveCurrentHubAuthToken(): Promise<string | undefined> {
	return (await readHubDiscovery(resolveHubOwnerContext().discoveryPath))
		?.authToken;
}

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
		}
	}
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
	metadata: { clientTurnId?: string } = {},
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
		...(metadata.clientTurnId ? { clientTurnId: metadata.clientTurnId } : {}),
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
	clientTurnId?: string,
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
				{ clientTurnId },
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
				{ clientTurnId },
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
			const { sessionId, event: agentEvent, clientTurnId } = event.payload;
			handleAgentEvent(ctx, sessionId, agentEvent, clientTurnId);
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
			sendEvent(ctx, "chat_session_ended", {
				sessionId,
				reason,
				...(event.payload.clientTurnId
					? { clientTurnId: event.payload.clientTurnId }
					: {}),
			});
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
			sendEvent(ctx, "chat_session_status", {
				sessionId,
				status,
				...(event.payload.clientTurnId
					? { clientTurnId: event.payload.clientTurnId }
					: {}),
			});
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
		pendingMessageBots: new Map(),
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
		// This app runs each (bot, project) pair's Hub daemon behind its own
		// per-process sandbox proxy (see sandbox/launcher.ts's
		// CLINE_HUB_DISCOVERY_PATH override) - unlike the SDK's general
		// multi-client sharing model, this sidecar is that daemon's only
		// client, so nothing else is left depending on it once this sidecar
		// exits. Without this, the daemon detaches and keeps running with
		// proxy env vars baked in at spawn time; once this sidecar's own
		// process (and the in-process proxy it started) exits, those vars
		// point at a dead port forever, and the daemon - still "alive" by
		// every PID/WS-reachability check the SDK's own reuse logic runs,
		// since its control-plane socket is local and unaffected - silently
		// fails every outbound provider call from then on. Stopping it here
		// means the next connection attempt for this (bot, project) finds no
		// reusable daemon and spawns a fresh one, paired with a fresh, live
		// proxy from that fresh launcher invocation.
		cleanup.push(stopLocalHubServerGracefully().catch(() => false));
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

function serializeMessageBotContext(
	context: AgentToolContext,
): MessageBotRequestItem["context"] {
	return {
		agentId: context.agentId,
		conversationId: context.conversationId,
		iteration: context.iteration,
		...(context.metadata ? { metadata: context.metadata } : {}),
	};
}

export interface MessageBotInput {
	botName: string;
	message: string;
	mode: MessageBotMode;
	sessionId?: string;
	timeoutMs?: number;
}

/**
 * Bridges a `message_bot` tool call out to the webview - the only unsandboxed
 * layer that can reach a *different* bot's own sidecar (see
 * apps/cline/sandbox/launcher.ts: this sidecar's own OS sandbox has no
 * filesystem access to another bot's discovery file and no network-allowlist
 * entry for its port). Mirrors requestSidecarAskQuestion's bridge shape
 * exactly: park a resolver keyed by requestId, emit an event over this
 * sidecar's own WS server (which the webview already dialed into), and let
 * `resolveSidecarMessageBot` (invoked by the webview's `respond_message_bot`
 * command once it has actually relayed the message) settle it.
 *
 * Always resolves - never rejects - so a calling agent always sees a clear
 * `{delivered, ...}` result instead of a crashed tool call, including on
 * timeout (where `sessionId`, if known, is still returned so the agent can
 * follow up later rather than losing track of the target bot's session).
 */
export function requestSidecarMessageBot(
	ctx: SidecarContext,
	input: MessageBotInput,
	context: AgentToolContext,
): Promise<MessageBotResult> {
	const botName = input.botName?.trim();
	const message = input.message?.trim();
	if (!botName) {
		return Promise.resolve({ delivered: false, error: "botName is required" });
	}
	if (!message) {
		return Promise.resolve({ delivered: false, error: "message is required" });
	}
	const mode: MessageBotMode =
		input.mode === "fire_and_forget" ? "fire_and_forget" : "await_reply";
	const sessionId = input.sessionId?.trim() || undefined;
	const resolvedTimeoutMs =
		mode === "fire_and_forget"
			? MESSAGE_BOT_FIRE_AND_FORGET_TIMEOUT_MS
			: Math.min(
					Math.max(
						typeof input.timeoutMs === "number" &&
							Number.isFinite(input.timeoutMs)
							? input.timeoutMs
							: MESSAGE_BOT_DEFAULT_AWAIT_TIMEOUT_MS,
						MESSAGE_BOT_MIN_AWAIT_TIMEOUT_MS,
					),
					MESSAGE_BOT_MAX_AWAIT_TIMEOUT_MS,
				);

	return new Promise<MessageBotResult>((resolve) => {
		const requestId = randomUUID();
		const timeoutId = setTimeout(() => {
			ctx.pendingMessageBots.delete(requestId);
			resolve({
				delivered: false,
				botName,
				sessionId,
				error: `message_bot timed out waiting for a response after ${resolvedTimeoutMs}ms`,
			});
		}, resolvedTimeoutMs + MESSAGE_BOT_TIMEOUT_BUFFER_MS);
		const pending: PendingMessageBot = {
			item: {
				requestId,
				createdAt: new Date().toISOString(),
				botName,
				message,
				mode,
				sessionId,
				timeoutMs: resolvedTimeoutMs,
				context: serializeMessageBotContext(context),
			},
			resolve,
			timeoutId,
		};
		ctx.pendingMessageBots.set(requestId, pending);
		sendEvent(ctx, "message_bot_requested", pending.item);
	});
}

export function resolveSidecarMessageBot(
	ctx: SidecarContext,
	requestId: string,
	result: MessageBotResult,
): boolean {
	const pending = ctx.pendingMessageBots.get(requestId);
	if (!pending) {
		return false;
	}
	ctx.pendingMessageBots.delete(requestId);
	if (pending.timeoutId) clearTimeout(pending.timeoutId);
	const botName = result.botName?.trim() || pending.item.botName;
	const sessionId = result.sessionId?.trim() || pending.item.sessionId;
	const reply = result.reply?.trim() ?? "";
	const error = result.error?.trim() ?? "";
	if (result.delivered && pending.item.mode === "await_reply" && !reply) {
		pending.resolve({
			delivered: false,
			botId: result.botId,
			botName,
			sessionId,
			error: error || `"${botName}" completed without returning reply text`,
		});
		return true;
	}
	if (!result.delivered && !error) {
		pending.resolve({
			delivered: false,
			botId: result.botId,
			botName,
			sessionId,
			error: `message_bot failed for "${botName}" without an error detail`,
		});
		return true;
	}
	if (result.delivered) {
		pending.resolve({
			delivered: true,
			botId: result.botId,
			botName,
			...(sessionId ? { sessionId } : {}),
			...(reply ? { reply } : {}),
		});
	} else {
		pending.resolve({
			delivered: false,
			botId: result.botId,
			botName,
			...(sessionId ? { sessionId } : {}),
			error,
		});
	}
	return true;
}

/**
 * Atomically assigns one pending relay request to a single webview
 * connection. The source sidecar owns this lease because renderer-local
 * state cannot coordinate multiple windows.
 */
export function claimSidecarMessageBot(
	ctx: SidecarContext,
	requestId: string,
	connection: object,
): boolean {
	const pending = ctx.pendingMessageBots.get(requestId);
	if (!pending) return false;
	if (pending.claimedBy && pending.claimedBy !== connection) return false;
	pending.claimedBy = connection;
	return true;
}

/** Re-offers claims owned by a webview connection that just disconnected. */
export function releaseSidecarMessageBotClaims(
	ctx: SidecarContext,
	connection: object,
): void {
	for (const pending of ctx.pendingMessageBots.values()) {
		if (pending.claimedBy !== connection) continue;
		pending.claimedBy = undefined;
		sendEvent(ctx, "message_bot_requested", pending.item);
	}
}

/**
 * The `message_bot` AgentTool, wired via `extraTools` (not the plugin
 * system - a plugin's AgentToolContext carries no hook back into this
 * sidecar's own request/response bridge). Callers gate inclusion to the
 * default "cline" bot; this factory itself does no such check.
 */
export function buildMessageBotTool(
	ctx: SidecarContext,
): AgentTool<MessageBotInput, MessageBotResult> {
	return createTool({
		name: "message_bot",
		description:
			"Send a message to a DIFFERENT existing bot (a separate, fully " +
			"isolated agent identity - not this conversation) and, per your own " +
			"choice, either fire-and-forget or wait for that bot's reply. Provide " +
			"the target bot's name exactly as shown in the bot switcher. If you " +
			"already have a sessionId from a prior message_bot call to this same " +
			"bot and want to continue that conversation, pass it - otherwise a " +
			"fresh session is started there. In 'await_reply' mode this call " +
			"blocks until the target bot finishes its turn (or the timeout " +
			"elapses) and returns its reply text. In 'fire_and_forget' mode it " +
			"returns as soon as the message is dispatched, without waiting for " +
			"the target bot to finish - the returned sessionId can be used to " +
			"check back later.",
		inputSchema: {
			type: "object",
			properties: {
				botName: {
					type: "string",
					description:
						"Name of the target bot to message, exactly as shown in the bot switcher.",
				},
				message: {
					type: "string",
					description: "The message content to send to the target bot.",
				},
				mode: {
					type: "string",
					enum: ["fire_and_forget", "await_reply"],
					description:
						"'await_reply' waits for the target bot's full response; " +
						"'fire_and_forget' returns immediately once the message is dispatched.",
				},
				sessionId: {
					type: "string",
					description:
						"Optional - continue this existing session on the target bot " +
						"instead of starting a new one.",
				},
				timeoutMs: {
					type: "number",
					description:
						"Optional, await_reply only - how long to wait for a reply, in " +
						"milliseconds (default 120000, min 5000, max 600000).",
				},
			},
			required: ["botName", "message", "mode"],
		},
		timeoutMs: MESSAGE_BOT_TOOL_TIMEOUT_MS,
		async execute(input: MessageBotInput, context) {
			return requestSidecarMessageBot(ctx, input, context);
		},
	});
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

	// For a workspace whose Hub daemon has never been spawned before,
	// ClineCore.create() spins it up fresh and connects to it - the exact
	// same class of transient "just-started, not yet accepting connections"
	// hiccup ensureSharedHubClient's own retry loop guards against below.
	// A failure here is otherwise completely unguarded and fatal to sidecar
	// startup (nothing later in this function gets a chance to retry it).
	const createSessionManager = async () => {
		// Resolve (and, on a workspace whose daemon has never run before,
		// spin up) the Hub ourselves before reading its auth token - the
		// discovery record ClineCore.create() would otherwise resolve
		// *inside* its own call doesn't exist yet at the moment this
		// function's arguments are evaluated, so reading the token first and
		// only then calling create() would silently pass no token at all on
		// a fresh daemon (the exact bug this whole function guards against).
		// Passing the resolved endpoint back in also skips create()'s own
		// redundant re-resolution.
		const hubUrl = await ensureCompatibleLocalHubUrl({
			strategy: "require-hub",
			workspaceRoot: ctx.workspaceRoot,
			cwd: ctx.workspaceRoot,
		});
		if (!hubUrl) {
			throw new Error("Unable to start or connect to the shared Cline Hub.");
		}
		const authToken = await resolveCurrentHubAuthToken();
		return ClineCore.create({
			clientName: "cline-code",
			backendMode: "hub",
			capabilities: createSidecarRuntimeCapabilities(ctx),
			logger: ctx.logger,
			telemetry: ctx.telemetry,
			hub: {
				strategy: "require-hub",
				workspaceRoot: ctx.workspaceRoot,
				cwd: ctx.workspaceRoot,
				clientType: "cline-sidecar",
				displayName: "Code App sidecar",
				endpoint: hubUrl,
				authToken,
			},
		});
	};
	let sessionManager:
		| Awaited<ReturnType<typeof createSessionManager>>
		| undefined;
	let lastCoreCreateError: unknown;
	for (
		let attempt = 1;
		attempt <= HUB_CLIENT_CONNECT_RETRY_ATTEMPTS;
		attempt++
	) {
		try {
			sessionManager = await createSessionManager();
			break;
		} catch (error) {
			lastCoreCreateError = error;
			if (attempt < HUB_CLIENT_CONNECT_RETRY_ATTEMPTS) {
				await delay(HUB_CLIENT_CONNECT_RETRY_DELAY_MS);
			}
		}
	}
	if (!sessionManager) {
		throw lastCoreCreateError;
	}

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

		const authToken = await resolveCurrentHubAuthToken();
		const client = new NodeHubClient({
			url,
			authToken,
			clientType: "cline-sidecar-observer",
			displayName: "Code App observer",
			workspaceRoot: ctx.workspaceRoot,
			cwd: ctx.workspaceRoot,
		});
		let lastError: unknown;
		for (
			let attempt = 1;
			attempt <= HUB_CLIENT_CONNECT_RETRY_ATTEMPTS;
			attempt++
		) {
			try {
				await client.connect();
				client.subscribe((event) => {
					handleHubLiveEvent(ctx, event);
				});
				ctx.hubClient = client;
				return client;
			} catch (error) {
				lastError = error;
				if (attempt < HUB_CLIENT_CONNECT_RETRY_ATTEMPTS) {
					await delay(HUB_CLIENT_CONNECT_RETRY_DELAY_MS);
				}
			}
		}
		await client.dispose().catch(() => undefined);
		throw lastError;
	})().finally(() => {
		hubClientInitialization.delete(ctx);
	});

	hubClientInitialization.set(ctx, initialization);
	return await initialization;
}
