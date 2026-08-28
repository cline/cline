/**
 * Async run and session state machines (Gateway RFC, Phase 0).
 *
 * `run.start` acknowledges immediately with `{runId, acceptedAt,
 * queuePosition}` and the run proceeds through these states. One mutating
 * root run per session; admission is FIFO. Steering merges into the active
 * run (it is not a state change). Disconnect never implies abort: no
 * transition is triggered by connection lifecycle.
 */

import { z } from "zod";
import { createGatewayError, type GatewayError } from "./errors";
import { RunIdSchema } from "./ids";

// -----------------------------------------------------------------------------
// Runs
// -----------------------------------------------------------------------------

export const RUN_STATES = [
	/** Accepted at admission, waiting behind the active run (FIFO). */
	"queued",
	/** The engine is executing the run. */
	"running",
	/** Terminal: run finished normally. */
	"completed",
	/** Terminal: run failed with an error. */
	"failed",
	/** Terminal: run was aborted (hard stop). */
	"aborted",
	/** Terminal: run was cooperatively interrupted. */
	"interrupted",
] as const;

export type RunState = (typeof RUN_STATES)[number];

export const RunStateSchema = z.enum(RUN_STATES);

export const RUN_STATE_TRANSITIONS: Readonly<
	Record<RunState, readonly RunState[]>
> = {
	queued: ["running", "aborted"],
	running: ["completed", "failed", "aborted", "interrupted"],
	completed: [],
	failed: [],
	aborted: [],
	interrupted: [],
};

export const TERMINAL_RUN_STATES = [
	"completed",
	"failed",
	"aborted",
	"interrupted",
] as const satisfies readonly RunState[];

export function isTerminalRunState(state: RunState): boolean {
	return RUN_STATE_TRANSITIONS[state].length === 0;
}

export function canTransitionRunState(from: RunState, to: RunState): boolean {
	return RUN_STATE_TRANSITIONS[from].includes(to);
}

export class RunStateTransitionError extends Error {
	readonly gatewayError: GatewayError;

	constructor(from: RunState, to: RunState) {
		const message = `Illegal run state transition: ${from} -> ${to}`;
		super(message);
		this.name = "RunStateTransitionError";
		this.gatewayError = createGatewayError(
			"invalid_state_transition",
			message,
			{
				details: { from, to },
			},
		);
	}
}

export function assertRunStateTransition(from: RunState, to: RunState): void {
	if (!canTransitionRunState(from, to)) {
		throw new RunStateTransitionError(from, to);
	}
}

/** Immediate acknowledgement returned by `run.start`. */
export const RunAcceptedSchema = z
	.object({
		runId: RunIdSchema,
		/** Epoch milliseconds at admission. */
		acceptedAt: z.number().int().nonnegative(),
		/** 0 = active now; N = N runs ahead in the session's FIFO queue. */
		queuePosition: z.number().int().nonnegative(),
	})
	.strict();

export type RunAccepted = z.infer<typeof RunAcceptedSchema>;

// -----------------------------------------------------------------------------
// Sessions
// -----------------------------------------------------------------------------

export const SESSION_STATES = [
	/** Created (only ever with a first accepted prompt) and usable. */
	"active",
	/** Terminal: closed; admits no further runs. */
	"closed",
] as const;

export type SessionState = (typeof SESSION_STATES)[number];

export const SessionStateSchema = z.enum(SESSION_STATES);

export const SESSION_STATE_TRANSITIONS: Readonly<
	Record<SessionState, readonly SessionState[]>
> = {
	active: ["closed"],
	closed: [],
};

export function canTransitionSessionState(
	from: SessionState,
	to: SessionState,
): boolean {
	return SESSION_STATE_TRANSITIONS[from].includes(to);
}
