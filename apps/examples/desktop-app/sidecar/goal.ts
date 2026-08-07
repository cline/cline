import {
	createInteractiveGoalGuard,
	type InteractiveGoalGuard,
} from "@cline/core";
import type { SidecarContext } from "./types";

/**
 * Per-session /goal completion guards (the shared @cline/core implementation
 * also used by the CLI and the VS Code extension).
 *
 * Guards are keyed by session id, so switching between live threads keeps
 * each conversation's goal without any navigation-time bookkeeping. Entries
 * follow the conversation across session-id transitions that continue it
 * (forks) and are dropped when the conversation is discarded (reset) or
 * rewound (checkpoint restore).
 */
export function goalGuardFor(
	ctx: SidecarContext,
	sessionId: string,
): InteractiveGoalGuard {
	let guard = ctx.goalGuards.get(sessionId);
	if (!guard) {
		guard = createInteractiveGoalGuard();
		ctx.goalGuards.set(sessionId, guard);
	}
	return guard;
}

/**
 * The extraTools entry registered on every desktop session start, so the
 * mark_goal_complete tool survives provider rebuilds the same way it
 * survives mode/provider rebuilds on the other surfaces. The tool refuses
 * until a verification prompt is pending, so registering it for sessions
 * that never set a goal is inert.
 */
export function goalExtraTools(ctx: SidecarContext, sessionId: string) {
	return [goalGuardFor(ctx, sessionId).markGoalCompleteTool];
}
