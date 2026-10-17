/**
 * Queue-backed run admission (`run.enqueue`), queue introspection
 * (`run.list`), and drain lifecycle (`hub.drain`, `hub.status`).
 *
 * `run.start` keeps its historical synchronous-reply contract untouched;
 * `run.enqueue` is the additive path with app-server semantics: durable FIFO
 * admission, an immediate `{runId, acceptedAt, queuePosition}` ack, and
 * execution that never depends on the requesting socket staying alive.
 */

import type { HubCommandEnvelope, HubReplyEnvelope } from "@cline/shared";
import {
	HubRunAdmissionRejectedError,
	type HubRunQueue,
	type HubRunRecord,
} from "../hub-run-queue";
import { logHubMessage } from "../hub-server-logging";
import {
	errorReply,
	extractSessionId,
	type HubTransportContext,
	okReply,
} from "./context";
import { handleSessionInput } from "./run-handlers";

export const HUB_DRAINING_ERROR_CODE = "hub_draining";

/** Commands refused while the Hub is draining (all of them admit new work). */
const DRAIN_REFUSED_COMMANDS = new Set<string>([
	"session.create",
	"session.restore",
	"session.fork",
	"run.start",
	"session.send_input",
	"run.enqueue",
]);

export function isDrainRefusedCommand(command: string): boolean {
	return DRAIN_REFUSED_COMMANDS.has(command);
}

export function drainingReply(envelope: HubCommandEnvelope): HubReplyEnvelope {
	return {
		version: envelope.version,
		requestId: envelope.requestId,
		ok: false,
		error: {
			code: HUB_DRAINING_ERROR_CODE,
			message:
				"Hub is draining and refuses new mutating work; retry once a hub is serving again.",
			details: { retryable: true },
		},
	};
}

/**
 * Serial per-session executor over the durable queue. Admission and
 * execution are decoupled: `enqueue` acks immediately, `pump` runs turns one
 * at a time per session through the same `handleSessionInput` path (and thus
 * the same event projection) as `run.start`.
 */
export class HubRunExecutor {
	private readonly activeSessions = new Set<string>();
	private readonly retryTimers = new Map<
		string,
		ReturnType<typeof setTimeout>
	>();
	private stopped = false;
	private readonly executions = new Set<Promise<void>>();
	private readonly preparations = new Set<Promise<void>>();

	constructor(
		private readonly ctx: HubTransportContext,
		private readonly queue: HubRunQueue,
		private readonly prepareRun?: (run: HubRunRecord) => Promise<void>,
	) {}

	async stop(): Promise<void> {
		this.stopped = true;
		for (const timer of this.retryTimers.values()) clearTimeout(timer);
		this.retryTimers.clear();
		await Promise.allSettled([...this.executions]);
	}

	/** After stop() blocks new work, let existing activation finish before disposing the host. */
	async waitForPreparations(): Promise<void> {
		await Promise.allSettled([...this.preparations]);
	}

	/** Start (or continue) draining the session's queue in the background. */
	pump(sessionId: string): void {
		if (
			this.stopped ||
			this.retryTimers.has(sessionId) ||
			this.activeSessions.has(sessionId)
		) {
			return;
		}
		this.activeSessions.add(sessionId);
		const execution = this.drainSession(sessionId)
			.catch((error) => {
				logHubMessage("error", "run.queue.pump_failed", { sessionId, error });
			})
			.finally(() => {
				this.activeSessions.delete(sessionId);
				// New work admitted while the finally raced the last check.
				if (
					!this.stopped &&
					!this.retryTimers.has(sessionId) &&
					this.queue.nextQueued(sessionId)
				) {
					this.pump(sessionId);
				}
			});
		this.executions.add(execution);
		void execution.then(() => this.executions.delete(execution));
	}

	private async drainSession(sessionId: string): Promise<void> {
		for (;;) {
			if (this.stopped) return;
			const run = this.queue.nextQueued(sessionId);
			if (!run) {
				return;
			}
			if (await this.execute(run)) return;
		}
	}

	private async execute(run: HubRunRecord): Promise<boolean> {
		const envelope: HubCommandEnvelope = {
			version: "v1",
			command: "run.start",
			requestId: run.runId,
			clientId: run.clientId,
			sessionId: run.sessionId,
			payload: { ...run.input, sessionId: run.sessionId },
		};
		try {
			if (this.prepareRun) {
				const preparation = this.prepareRun(run);
				this.preparations.add(preparation);
				try {
					await preparation;
				} finally {
					this.preparations.delete(preparation);
				}
			}
			if (this.stopped) return true;
			this.queue.markRunning(run.runId);
			const reply = await handleSessionInput(this.ctx, envelope);
			if (
				!reply.ok &&
				reply.error?.code === "session_run_in_progress" &&
				run.input.delivery === "immediate"
			) {
				this.queue.markQueued(run.runId);
				if (this.stopped) return true;
				const timer = setTimeout(() => {
					this.retryTimers.delete(run.sessionId);
					this.pump(run.sessionId);
				}, 1000);
				timer.unref?.();
				this.retryTimers.set(run.sessionId, timer);
				return true;
			}
			if (this.stopped) return true;
			if (reply.ok) {
				const finishReason = (
					reply.payload?.result as { finishReason?: string } | undefined
				)?.finishReason;
				this.queue.markTerminal(
					run.runId,
					finishReason === "aborted"
						? "aborted"
						: finishReason === "error" || finishReason === "failed"
							? "failed"
							: "completed",
					finishReason === "error" ? "Run finished with an error." : undefined,
				);
			} else {
				this.queue.markTerminal(
					run.runId,
					"failed",
					reply.error?.message ?? "Run failed.",
				);
			}
		} catch (error) {
			if (this.stopped) return true;
			this.queue.markTerminal(
				run.runId,
				"failed",
				error instanceof Error ? error.message : String(error),
			);
		}
		return false;
	}
}

export function handleRunEnqueue(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
	queue: HubRunQueue,
	executor: HubRunExecutor,
): HubReplyEnvelope {
	const sessionId = extractSessionId(envelope);
	if (!sessionId) {
		return errorReply(
			envelope,
			"invalid_session_id",
			"run.enqueue requires a sessionId",
		);
	}
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
	if (!prompt.trim()) {
		return errorReply(
			envelope,
			"invalid_session_input",
			"run.enqueue requires a prompt string",
		);
	}
	let accepted: ReturnType<HubRunQueue["admit"]>;
	try {
		accepted = queue.admit(
			sessionId,
			payload as Record<string, unknown>,
			envelope.clientId?.trim() || undefined,
		);
	} catch (error) {
		if (error instanceof HubRunAdmissionRejectedError) {
			return {
				version: envelope.version,
				requestId: envelope.requestId,
				ok: false,
				error: {
					code: "run_admission_rejected",
					message: error.message,
					details: { retryable: true },
				},
			};
		}
		throw error;
	}
	ctx.publish(
		ctx.buildEvent(
			"run.enqueued",
			{
				runId: accepted.runId,
				acceptedAt: accepted.acceptedAt,
				queuePosition: accepted.queuePosition,
				...(envelope.clientId ? { clientId: envelope.clientId } : {}),
			},
			sessionId,
		),
	);
	executor.pump(sessionId);
	return okReply(envelope, { ...accepted });
}

export function handleRunList(
	envelope: HubCommandEnvelope,
	queue: HubRunQueue,
): HubReplyEnvelope {
	const sessionId = extractSessionId(envelope) || undefined;
	const limit =
		typeof envelope.payload?.limit === "number" &&
		Number.isFinite(envelope.payload.limit) &&
		envelope.payload.limit > 0
			? Math.floor(envelope.payload.limit)
			: undefined;
	return okReply(envelope, {
		runs: queue.list({ sessionId, limit }).map((run) => ({
			runId: run.runId,
			sessionId: run.sessionId,
			state: run.state,
			acceptedAt: run.acceptedAt,
			startedAt: run.startedAt,
			endedAt: run.endedAt,
			error: run.error,
		})),
	});
}
