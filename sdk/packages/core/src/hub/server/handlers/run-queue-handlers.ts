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

	constructor(
		private readonly ctx: HubTransportContext,
		private readonly queue: HubRunQueue,
	) {}

	/** Start (or continue) draining the session's queue in the background. */
	pump(sessionId: string): void {
		if (this.activeSessions.has(sessionId)) {
			return;
		}
		this.activeSessions.add(sessionId);
		void this.drainSession(sessionId)
			.catch((error) => {
				logHubMessage("error", "run.queue.pump_failed", { sessionId, error });
			})
			.finally(() => {
				this.activeSessions.delete(sessionId);
				// New work admitted while the finally raced the last check.
				if (this.queue.nextQueued(sessionId)) {
					this.pump(sessionId);
				}
			});
	}

	private async drainSession(sessionId: string): Promise<void> {
		for (;;) {
			const run = this.queue.nextQueued(sessionId);
			if (!run) {
				return;
			}
			this.queue.markRunning(run.runId);
			await this.execute(run);
		}
	}

	private async execute(run: HubRunRecord): Promise<void> {
		const envelope: HubCommandEnvelope = {
			version: "v1",
			command: "run.start",
			requestId: run.runId,
			clientId: run.clientId,
			sessionId: run.sessionId,
			payload: { ...run.input, sessionId: run.sessionId },
		};
		try {
			const reply = await handleSessionInput(this.ctx, envelope);
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
			this.queue.markTerminal(
				run.runId,
				"failed",
				error instanceof Error ? error.message : String(error),
			);
		}
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
