import type { DriveReviewGate, DriveReviewContext, DriveReviewDecision } from "./types";

export function continueReview(reason?: string): DriveReviewDecision {
	return { action: "continue", reason };
}

export function pauseReview(reason: string): DriveReviewDecision {
	return { action: "pause", reason };
}

export function abortReview(reason: string): DriveReviewDecision {
	return { action: "abort", reason };
}

/** Always continue. Useful as a default when no gates are configured. */
export const alwaysContinueReview: DriveReviewGate = {
	name: "always-continue",
	kinds: ["pre", "post", "emergency"],
	evaluate: () => continueReview("default"),
};

/**
 * Abort when any task in the wave failed and remaining pending work exists.
 * Post-wave only.
 */
export function failFastReview(name = "fail-fast"): DriveReviewGate {
	return {
		name,
		kinds: ["post"],
		evaluate: (ctx: DriveReviewContext): DriveReviewDecision => {
			const failed = ctx.tasks.filter((task) => task.status === "failed");
			if (failed.length === 0) {
				return continueReview();
			}
			const pending = ctx.tasks.some((task) => task.status === "pending");
			if (!pending) {
				return continueReview("failures present but no pending work");
			}
			return abortReview(
				`fail-fast: ${failed.length} failed task(s); aborting remaining work`,
			);
		},
	};
}

/**
 * Pause when scratch flag `drive.wave.pause` is truthy.
 * Emergency + pre gates.
 */
export function scratchPauseReview(name = "scratch-pause"): DriveReviewGate {
	return {
		name,
		kinds: ["emergency", "pre"],
		evaluate: (ctx: DriveReviewContext): DriveReviewDecision => {
			if (ctx.scratch.get("drive.wave.pause")) {
				return pauseReview("scratch flag drive.wave.pause is set");
			}
			return continueReview();
		},
	};
}

export async function evaluateReviews(
	gates: readonly DriveReviewGate[],
	ctx: DriveReviewContext,
): Promise<DriveReviewDecision> {
	const applicable = gates.filter((gate) => gate.kinds.includes(ctx.kind));
	for (const gate of applicable) {
		const decision = await gate.evaluate(ctx);
		if (decision.action !== "continue") {
			return { ...decision, reason: decision.reason ?? gate.name };
		}
	}
	return continueReview();
}
