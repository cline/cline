import type {
	AgentMode,
	AgentResult,
	HubCommandEnvelope,
	HubReplyEnvelope,
} from "@cline/shared";
import { parseHookEventPayload } from "../../../hooks";
import {
	isSessionNotFoundError,
	SESSION_NOT_FOUND_ERROR_CODE,
	type SendSessionInput,
} from "../../../runtime/host/runtime-host";
import { logHubMessage } from "../hub-server-logging";
import { cancelPendingApprovals } from "./approval-handlers";
import { cancelPendingCapabilityRequests } from "./capability-handlers";
import {
	errorReply,
	extractSessionId,
	type HubTransportContext,
	okReply,
	readCoreSessionSnapshot,
	type SessionRunDeadlines,
} from "./context";

const HUB_RUN_HEARTBEAT_MS = 30_000;
/** How long a timed-out turn may keep unwinding before it stops counting as active. */
const HUB_RUN_UNWIND_GRACE_MS = 5 * 60_000;

function terminalRunEventForReason(
	reason: string,
): "run.aborted" | "run.completed" | "run.failed" {
	if (reason === "aborted") return "run.aborted";
	if (reason === "error" || reason === "failed") return "run.failed";
	return "run.completed";
}

function errorMessageForResult(result: AgentResult): string | undefined {
	if (result.finishReason !== "error") {
		return undefined;
	}
	const text = result.text.trim();
	return text || undefined;
}

/**
 * Marks an RPC-driven turn as in flight for the session. While marked, the
 * session-event projector suppresses its own `run.failed` projection for
 * agent-level error events — this handler publishes the authoritative
 * terminal event once `runTurn` settles.
 */
function trackActiveRpcTurn(
	ctx: HubTransportContext,
	sessionId: string,
): () => void {
	const counts = ctx.activeRpcTurnCountBySession;
	counts.set(sessionId, (counts.get(sessionId) ?? 0) + 1);
	let released = false;
	return () => {
		if (released) return;
		released = true;
		const remaining = (counts.get(sessionId) ?? 1) - 1;
		if (remaining <= 0) {
			counts.delete(sessionId);
		} else {
			counts.set(sessionId, remaining);
		}
	};
}

/**
 * Marks an RPC turn whose unwind outlived the grace period. Returns a release
 * to call once its run promise finally settles.
 */
function markAbandonedRpcTurn(
	ctx: HubTransportContext,
	sessionId: string,
): () => void {
	const counts = ctx.abandonedRpcTurnCountBySession;
	counts.set(sessionId, (counts.get(sessionId) ?? 0) + 1);
	let released = false;
	return () => {
		if (released) return;
		released = true;
		const remaining = (counts.get(sessionId) ?? 1) - 1;
		if (remaining <= 0) {
			counts.delete(sessionId);
		} else {
			counts.set(sessionId, remaining);
		}
	};
}

function sessionNotFoundReply(
	envelope: HubCommandEnvelope,
	sessionId: string,
	error?: unknown,
): HubReplyEnvelope {
	const message =
		error instanceof Error && error.message.trim()
			? error.message
			: `Unknown session: ${sessionId}`;
	return errorReply(envelope, SESSION_NOT_FOUND_ERROR_CODE, message);
}

function parseTurnMode(mode?: unknown): AgentMode | undefined {
	// Unknown truthy values flow through and formatModePrompt treats them as act.
	return mode ? (mode as AgentMode) : undefined;
}

function parseRunTimeoutMs(
	payload: Record<string, unknown>,
): number | undefined {
	const timeoutMs =
		typeof payload.timeoutMs === "number"
			? payload.timeoutMs
			: typeof payload.timeout_ms === "number"
				? payload.timeout_ms
				: undefined;
	if (timeoutMs && Number.isFinite(timeoutMs) && timeoutMs > 0) {
		return Math.floor(timeoutMs);
	}
	const timeoutSeconds =
		typeof payload.timeoutSeconds === "number"
			? payload.timeoutSeconds
			: typeof payload.timeout_seconds === "number"
				? payload.timeout_seconds
				: undefined;
	if (timeoutSeconds && Number.isFinite(timeoutSeconds) && timeoutSeconds > 0) {
		return Math.floor(timeoutSeconds * 1000);
	}
	return undefined;
}

function sessionRunDeadlines(
	ctx: HubTransportContext,
	sessionId: string,
): SessionRunDeadlines {
	let state = ctx.runDeadlinesBySession.get(sessionId);
	if (!state) {
		state = { deadlines: new Set(), humanWaits: new Set() };
		ctx.runDeadlinesBySession.set(sessionId, state);
	}
	return state;
}

function releaseSessionRunDeadlines(
	ctx: HubTransportContext,
	sessionId: string,
	state: SessionRunDeadlines,
): void {
	if (state.deadlines.size === 0 && state.humanWaits.size === 0) {
		ctx.runDeadlinesBySession.delete(sessionId);
	}
}

/**
 * Arms a run deadline that counts only active execution: it stays paused
 * while the session has a human-input wait and resumes with the remaining
 * budget. Returns an idempotent stop function.
 */
function startRunDeadline(
	ctx: HubTransportContext,
	sessionId: string,
	timeoutMs: number,
	onTimeout: () => void,
): () => void {
	const state = sessionRunDeadlines(ctx, sessionId);
	let remainingMs = timeoutMs;
	let resumedAt = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let stopped = false;
	const stop = () => {
		if (stopped) return;
		stopped = true;
		clearTimeout(timer);
		state.deadlines.delete(deadline);
		releaseSessionRunDeadlines(ctx, sessionId, state);
	};
	const deadline = {
		pause() {
			if (!timer) return;
			clearTimeout(timer);
			timer = undefined;
			remainingMs -= performance.now() - resumedAt;
		},
		resume() {
			if (timer) return;
			resumedAt = performance.now();
			timer = setTimeout(
				() => {
					stop();
					onTimeout();
				},
				Math.max(0, remainingMs),
			);
		},
	};
	state.deadlines.add(deadline);
	if (state.humanWaits.size === 0) deadline.resume();
	return stop;
}

/**
 * Waits on a person without spending the session's run budget. Run deadlines
 * for the session stay paused until every such wait settles, and aborting
 * the session ends the wait, because tool execution does not observe aborts.
 */
export async function awaitHumanInput<T>(
	ctx: HubTransportContext,
	sessionId: string,
	waiting: Promise<T>,
): Promise<T> {
	const state = sessionRunDeadlines(ctx, sessionId);
	let cancel: (reason: string) => void = () => {};
	const cancelled = new Promise<never>((_, reject) => {
		cancel = (reason) => reject(new Error(reason));
	});
	if (state.humanWaits.size === 0) {
		for (const deadline of state.deadlines) deadline.pause();
	}
	state.humanWaits.add(cancel);
	try {
		return await Promise.race([waiting, cancelled]);
	} finally {
		state.humanWaits.delete(cancel);
		if (state.humanWaits.size === 0) {
			for (const deadline of state.deadlines) deadline.resume();
		}
		releaseSessionRunDeadlines(ctx, sessionId, state);
	}
}

export function cancelHumanInputWaits(
	ctx: HubTransportContext,
	sessionId: string,
	reason: string,
): void {
	const waits = ctx.runDeadlinesBySession.get(sessionId)?.humanWaits ?? [];
	for (const cancel of waits) cancel(reason);
}

async function runTurnWithRuntimeHealth(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
	input: SendSessionInput,
	timeoutMs: number | undefined,
	onRunStarted?: (run: Promise<unknown>) => void,
): Promise<AgentResult | undefined> {
	const startedAt = performance.now();
	let settled = false;
	const baseContext = {
		command: envelope.command,
		requestId: envelope.requestId,
		clientId: envelope.clientId,
		sessionId: input.sessionId,
		timeoutMs,
	};
	const heartbeat = setInterval(() => {
		if (settled) return;
		const elapsedMs = Math.round(performance.now() - startedAt);
		logHubMessage("warn", "run.heartbeat", {
			...baseContext,
			elapsedMs,
		});
		ctx.publish(
			ctx.buildEvent(
				"run.heartbeat",
				{
					requestId: envelope.requestId,
					elapsedMs,
					...(timeoutMs ? { timeoutMs } : {}),
				},
				input.sessionId,
			),
		);
	}, HUB_RUN_HEARTBEAT_MS);
	const runPromise = ctx.sessionHost.runTurn(input);
	onRunStarted?.(runPromise);
	runPromise.then(
		(result) => {
			if (!settled) return;
			logHubMessage("warn", "run.late_end", {
				...baseContext,
				elapsedMs: Math.round(performance.now() - startedAt),
				finishReason: result?.finishReason,
			});
		},
		(error) => {
			if (!settled) return;
			logHubMessage("error", "run.late_error", {
				...baseContext,
				elapsedMs: Math.round(performance.now() - startedAt),
				error,
			});
		},
	);
	let stopDeadline: (() => void) | undefined;
	try {
		if (!timeoutMs) {
			return await runPromise;
		}
		return await Promise.race([
			runPromise,
			new Promise<never>((_, reject) => {
				stopDeadline = startRunDeadline(ctx, input.sessionId, timeoutMs, () => {
					const reason = `Hub run ${envelope.command} timed out after ${timeoutMs}ms.`;
					settled = true;
					clearInterval(heartbeat);
					reject(new Error(reason));
					logHubMessage("error", "run.timeout", {
						...baseContext,
						elapsedMs: Math.round(performance.now() - startedAt),
					});
					cancelPendingApprovals(
						ctx,
						(approval) => approval.sessionId === input.sessionId,
						reason,
					);
					cancelPendingCapabilityRequests(
						ctx,
						(request) => request.sessionId === input.sessionId,
						reason,
					);
					void ctx.sessionHost.abort(input.sessionId, reason).catch((error) => {
						logHubMessage("error", "run.timeout_abort_failed", {
							...baseContext,
							error,
						});
					});
				});
			}),
		]);
	} finally {
		settled = true;
		clearInterval(heartbeat);
		stopDeadline?.();
	}
}

export async function handleSessionInput(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const sessionId = extractSessionId(envelope);
	const payload =
		envelope.payload && typeof envelope.payload === "object"
			? envelope.payload
			: {};
	const prompt =
		typeof payload.prompt === "string"
			? payload.prompt
			: typeof payload.input === "string"
				? payload.input
				: "";
	const attachments =
		payload.attachments &&
		typeof payload.attachments === "object" &&
		!Array.isArray(payload.attachments)
			? (payload.attachments as Record<string, unknown>)
			: undefined;
	const userImages = Array.isArray(attachments?.userImages)
		? attachments.userImages.filter(
				(image): image is string =>
					typeof image === "string" && image.trim().length > 0,
			)
		: undefined;
	const userFiles = Array.isArray(attachments?.userFiles)
		? attachments.userFiles.filter(
				(filePath): filePath is string =>
					typeof filePath === "string" && filePath.trim().length > 0,
			)
		: undefined;
	if (!prompt.trim() && !userImages?.length && !userFiles?.length) {
		return errorReply(
			envelope,
			"invalid_session_input",
			"session input requires a prompt or attachment",
		);
	}
	const session = await ctx.sessionHost.getSession(sessionId);
	if (!session) {
		return sessionNotFoundReply(envelope, sessionId);
	}
	ctx.publish(
		ctx.buildEvent(
			"run.started",
			{
				...(envelope.requestId ? { requestId: envelope.requestId } : {}),
				...(envelope.clientId ? { clientId: envelope.clientId } : {}),
			},
			sessionId,
		),
	);
	const timeoutMs = parseRunTimeoutMs(payload);
	ctx.suppressNextTerminalEventBySession.set(sessionId, "run.start.reply");
	const releaseActiveRpcTurn = trackActiveRpcTurn(ctx, sessionId);
	// A timed-out turn keeps executing until the runtime unwinds it, so the
	// turn stays counted as active until its run settles (and this handler has
	// published its terminal event) rather than when this reply is sent.
	// Factory reconciliation relies on this to never start a second writer
	// beside it; a run that never settles is released after a grace period.
	let run: Promise<unknown> | undefined;
	let runSettled = false;
	let result: AgentResult | undefined;
	try {
		try {
			result = await runTurnWithRuntimeHealth(
				ctx,
				envelope,
				{
					sessionId,
					prompt,
					mode: parseTurnMode(payload.mode),
					delivery:
						payload.delivery === "queue" || payload.delivery === "steer"
							? payload.delivery
							: undefined,
					userImages,
					userFiles,
					timeoutMs,
				},
				timeoutMs,
				(started) => {
					run = started;
					const markSettled = () => {
						runSettled = true;
					};
					void started.then(markSettled, markSettled);
				},
			);
		} catch (error) {
			if (
				ctx.suppressNextTerminalEventBySession.get(sessionId) ===
				"run.start.reply"
			) {
				ctx.suppressNextTerminalEventBySession.delete(sessionId);
			}
			if (isSessionNotFoundError(error)) {
				return sessionNotFoundReply(envelope, sessionId, error);
			}
			ctx.publish(
				ctx.buildEvent(
					"run.failed",
					{
						reason: "error",
						error: error instanceof Error ? error.message : String(error),
					},
					sessionId,
				),
			);
			throw error;
		}
		if (result) {
			const snapshot = await readCoreSessionSnapshot(ctx, sessionId);
			const error = errorMessageForResult(result);
			ctx.publish(
				ctx.buildEvent(
					terminalRunEventForReason(result.finishReason),
					{
						reason: result.finishReason,
						...(error ? { error } : {}),
						result,
						...(snapshot ? { snapshot } : {}),
					},
					sessionId,
				),
			);
			if (
				ctx.suppressNextTerminalEventBySession.get(sessionId) ===
				"run.start.reply"
			) {
				ctx.suppressNextTerminalEventBySession.delete(sessionId);
			}
		} else {
			ctx.suppressNextTerminalEventBySession.delete(sessionId);
		}
	} finally {
		if (!run) {
			releaseActiveRpcTurn();
		} else {
			void run.then(releaseActiveRpcTurn, releaseActiveRpcTurn);
			if (!runSettled) {
				const unwinding = run;
				let releaseAbandoned: (() => void) | undefined;
				const grace = setTimeout(() => {
					if (runSettled) return;
					logHubMessage("error", "run.unwind_abandoned", {
						command: envelope.command,
						requestId: envelope.requestId,
						sessionId,
						graceMs: HUB_RUN_UNWIND_GRACE_MS,
					});
					// Only idle/status accounting is released: the run may still be
					// writing, so it stays marked abandoned until it settles.
					releaseAbandoned = markAbandonedRpcTurn(ctx, sessionId);
					releaseActiveRpcTurn();
				}, HUB_RUN_UNWIND_GRACE_MS);
				grace.unref?.();
				const stopGrace = () => {
					clearTimeout(grace);
					releaseAbandoned?.();
				};
				void unwinding.then(stopGrace, stopGrace);
			}
		}
	}
	const snapshot = await readCoreSessionSnapshot(ctx, sessionId);
	return okReply(
		envelope,
		result || snapshot
			? { ...(result ? { result } : {}), ...(snapshot ? { snapshot } : {}) }
			: undefined,
	);
}

export async function handleRunAbort(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const sessionId = extractSessionId(envelope);
	const reason =
		typeof envelope.payload?.reason === "string"
			? envelope.payload.reason
			: "Run was aborted before pending approval or capability request was resolved.";
	cancelPendingApprovals(
		ctx,
		(approval) => approval.sessionId === sessionId,
		reason,
	);
	try {
		await ctx.sessionHost.abort(sessionId, envelope.payload?.reason);
	} catch (error) {
		logHubMessage("warn", "run.abort_failed", {
			command: envelope.command,
			requestId: envelope.requestId,
			clientId: envelope.clientId,
			sessionId,
			error,
		});
	} finally {
		cancelPendingCapabilityRequests(
			ctx,
			(request) => request.sessionId === sessionId,
			reason,
		);
		cancelHumanInputWaits(ctx, sessionId, reason);
	}
	return okReply(envelope, { applied: true });
}

export async function handleRunProceedWhileRunning(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const sessionId = extractSessionId(envelope);
	if (!sessionId) {
		return errorReply(
			envelope,
			"invalid_session_id",
			"run.proceed_while_running requires a sessionId",
		);
	}
	if (typeof ctx.sessionHost.proceedWhileRunning !== "function") {
		return errorReply(
			envelope,
			"unsupported_command",
			"This runtime does not support proceeding while commands are running.",
		);
	}
	const toolCallId =
		typeof envelope.payload?.toolCallId === "string" &&
		envelope.payload.toolCallId.trim().length > 0
			? envelope.payload.toolCallId.trim()
			: undefined;
	const detachedCount = await ctx.sessionHost.proceedWhileRunning(
		sessionId,
		toolCallId,
	);
	return okReply(envelope, { detachedCount });
}

export async function handleSessionHook(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const parsed = parseHookEventPayload(envelope.payload?.payload);
	if (!parsed) {
		return errorReply(
			envelope,
			"invalid_hook_payload",
			"session.hook requires a valid hook event payload",
		);
	}
	await ctx.sessionHost.dispatchHookEvent(parsed);
	return okReply(envelope, { applied: true });
}
