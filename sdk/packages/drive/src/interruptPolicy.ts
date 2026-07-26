/**
 * Interrupt / barge-in classifier (DRV-KERNEL / DRV-INTERRUPT).
 *
 * Maps stop | clarify | redirect | fresh against turn state into
 * pause-after-tool | hard-cancel | queue-steer, with revise-not-restart
 * as the default mid-turn correction policy.
 */

export type InterruptIntent = "stop" | "clarify" | "redirect" | "fresh";

export type InterruptAction =
	| "pause-after-tool"
	| "hard-cancel"
	| "queue-steer";

/** Revise preserves useful tool results; restart discards the in-flight turn. */
export type ReviseDecision = "revise" | "restart";

export type InterruptInput = {
	/** Null/undefined/empty degrades to `stop`. */
	readonly intent?: InterruptIntent | null;
	/** Missing gist on clarify/redirect degrades to `fresh`. */
	readonly gist?: string | null;
	readonly turnInFlight: boolean;
	readonly hardCancel?: boolean;
	readonly explicitRestart?: boolean;
};

export type InterruptClassification = {
	readonly intent: InterruptIntent;
	readonly action: InterruptAction;
	readonly revise: ReviseDecision;
};

function normalizeIntent(input: InterruptInput): InterruptIntent {
	const raw = input.intent;
	if (raw == null) {
		return "stop";
	}
	if (
		(raw === "clarify" || raw === "redirect") &&
		(input.gist == null || input.gist.trim() === "")
	) {
		return "fresh";
	}
	return raw;
}

/**
 * Classify a hand-raise / barge-in.
 * Mid-turn corrections default to revise unless the user explicitly
 * cancels/restarts (DEC-open-product-forks revise-not-restart).
 */
export function classifyInterrupt(
	input: InterruptInput,
): InterruptClassification {
	if (input.hardCancel) {
		return {
			intent: "stop",
			action: "hard-cancel",
			revise: "restart",
		};
	}

	if (input.explicitRestart) {
		return {
			intent: "fresh",
			action: input.turnInFlight ? "pause-after-tool" : "hard-cancel",
			revise: "restart",
		};
	}

	const intent = normalizeIntent(input);

	switch (intent) {
		case "stop":
			return {
				intent,
				action: input.turnInFlight
					? "pause-after-tool"
					: "hard-cancel",
				revise: "revise",
			};
		case "clarify":
		case "redirect":
			return {
				intent,
				action: "queue-steer",
				revise: "revise",
			};
		case "fresh":
			return {
				intent,
				action: input.turnInFlight
					? "pause-after-tool"
					: "hard-cancel",
				revise: "restart",
			};
		default: {
			const _exhaustive: never = intent;
			return _exhaustive;
		}
	}
}

/**
 * Mid-turn correction policy: revise unless explicit restart/cancel.
 */
export function decideReviseOrRestart(input: {
	readonly explicitRestart?: boolean;
	readonly hardCancel?: boolean;
}): ReviseDecision {
	if (input.explicitRestart || input.hardCancel) {
		return "restart";
	}
	return "revise";
}
