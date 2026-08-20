/**
 * Pure composer semantics (unit-tested):
 *
 * - No session for the selected bot: the first submit creates the
 *   session lazily through `run.start`.
 * - Session idle: submit enqueues an ordinary FIFO turn.
 * - Run active: the PRIMARY action steers the active run; the secondary
 *   action queues the text as the next FIFO turn.
 */

import type { DesktopProjection } from "@shared/projection";

export type ComposerAction =
	| "start_first_session"
	| "queue_turn"
	| "steer_active_run";

export interface ComposerPlan {
	primary: ComposerAction;
	secondary?: ComposerAction;
	/** Run the primary action targets, when steering. */
	activeRunId?: string;
	disabledReason?: string;
}

export function planComposer(projection: DesktopProjection): ComposerPlan {
	if (projection.connection.state !== "connected") {
		return {
			primary: "queue_turn",
			disabledReason:
				projection.connection.state === "incompatible"
					? "This client cannot talk to the running Gateway"
					: "The Gateway is not connected",
		};
	}
	if (!projection.selectedBotId) {
		return { primary: "queue_turn", disabledReason: "Select a bot first" };
	}
	const active = projection.activeSession;
	if (!active || active.botId !== projection.selectedBotId) {
		return { primary: "start_first_session" };
	}
	if (active.state === "closed") {
		return {
			primary: "queue_turn",
			disabledReason: "This session is closed and admits no runs",
		};
	}
	const currentRun = active.currentRun;
	if (currentRun && currentRun.state === "running") {
		return {
			primary: "steer_active_run",
			secondary: "queue_turn",
			activeRunId: currentRun.runId,
		};
	}
	if (currentRun && currentRun.state === "queued") {
		return { primary: "queue_turn" };
	}
	return { primary: "queue_turn" };
}

/** Generate a fresh idempotent client request ID (8-128 URL-safe). */
export function createClientRequestId(): string {
	const random =
		typeof crypto !== "undefined" && "randomUUID" in crypto
			? crypto.randomUUID().replaceAll("-", "")
			: `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
	return `req_${random}`;
}

export function retryableRun(
	projection: DesktopProjection,
): { runId: string; errorMessage?: string } | undefined {
	const run = projection.activeSession?.currentRun;
	if (!run || !run.retryable) {
		return undefined;
	}
	return { runId: run.runId, errorMessage: run.error?.message };
}
