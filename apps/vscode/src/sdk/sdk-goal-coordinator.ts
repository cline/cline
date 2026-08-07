import {
	type CompletedGoalRecord,
	createInteractiveGoalGuard,
	formatGoalVerificationPrompt,
	type InteractiveGoalGuard,
	MAX_GOAL_VERIFICATION_ROUNDS,
} from "@cline/core"
import type { AgentResult, AgentTool } from "@cline/shared"
import { Logger } from "@/shared/services/Logger"
import type { SdkSendOrigin } from "./sdk-session-lifecycle"

export interface SdkGoalCoordinatorOptions {
	/**
	 * Sends a hidden verification prompt to the session (no user_feedback
	 * echo, origin "goal-verification"). Returns false when the session is no
	 * longer the active one, so the guard can roll the round back.
	 */
	sendVerificationTurn: (sessionId: string, prompt: string) => boolean
	/**
	 * Called once when the model marks the active goal complete. The tool
	 * call itself has no dedicated chat row (custom extraTools render
	 * nothing), so the controller surfaces this as an info row instead.
	 */
	onGoalCompleted?: (record: CompletedGoalRecord) => void
}

/**
 * Owns the /goal completion guard for the SDK-backed VS Code controller.
 *
 * The guard itself (goal state + the mark_goal_complete tool) is the same
 * @cline/core implementation the CLI uses. This coordinator adapts it to the
 * extension's fire-and-forget send model: instead of an awaited wrapper
 * around each turn (the CLI's sendTurnWithGoalVerification), it drives the
 * verification loop from SdkSessionLifecycle's turn-settled callback.
 *
 * Lifetime: controller-scoped. Session rebuilds (mode/provider/MCP changes)
 * keep the same conversation, so the goal survives them; task boundaries
 * (new task, task navigation, clearing the view) drop it via clearGoal().
 */
export class SdkGoalCoordinator {
	private readonly guard: InteractiveGoalGuard = createInteractiveGoalGuard()
	/**
	 * Verification turns consumed since the last user submission. Bounded by
	 * MAX_GOAL_VERIFICATION_ROUNDS so a model that never calls
	 * mark_goal_complete cannot loop unattended forever; the goal stays
	 * active past the cap, so the next completed run nudges again.
	 */
	private verificationRounds = 0
	/** Completion timestamp already reported through onGoalCompleted. */
	private lastReportedCompletionAt: string | undefined
	/**
	 * sendId of the newest user submission (see SdkSessionLifecycle's
	 * onSendStart). Settles whose sendId predates it are stale and must not
	 * open a verification window.
	 */
	private lastUserSendId = 0

	constructor(private readonly options: SdkGoalCoordinatorOptions) {}

	/** The mark_goal_complete tool, registered host-lifetime on every session start. */
	get markGoalCompleteTool(): AgentTool {
		return this.guard.markGoalCompleteTool as AgentTool
	}

	hasActiveGoal(): boolean {
		return this.guard.getActiveGoal() !== undefined
	}

	formatStatus(): string {
		return this.guard.formatStatus()
	}

	/** Arms the guard. Returns the user-facing confirmation reply. */
	setGoal(goal: string): string {
		this.verificationRounds = 0
		return this.guard.setGoal(goal).reply
	}

	/** Drops the active goal (user /goal off, task boundary). Returns the reply. */
	clearGoal(): string {
		return this.guard.clearGoal()
	}

	/**
	 * Called when an outbound send starts. A user submission begins ordinary
	 * work: revoke any verification authorization left over from an earlier
	 * sequence (e.g. an aborted verification turn) so mark_goal_complete
	 * refuses during it, and reset the per-submission round budget.
	 */
	handleSendStart(origin: SdkSendOrigin, sendId: number): void {
		if (origin === "user") {
			this.lastUserSendId = sendId
			this.verificationRounds = 0
			this.guard.resetVerification()
		}
	}

	/**
	 * Called after a non-queued send settles successfully. While a goal is
	 * active and the turn finished "completed", follows up with a hidden
	 * verification turn (up to the round cap per user submission).
	 */
	handleTurnSettled(sessionId: string, result: AgentResult | undefined, _origin: SdkSendOrigin, sendId: number): void {
		this.reportNewCompletion()
		if (result?.finishReason !== "completed") {
			this.guard.resetVerification()
			return
		}
		if (sendId < this.lastUserSendId) {
			// Stale settle: the user already started a newer ordinary turn
			// (e.g. queued it while this send was in flight). Opening a
			// verification window now would authorize mark_goal_complete
			// during that ordinary turn without a verification prompt.
			this.guard.resetVerification()
			return
		}
		const pendingBefore = this.guard.getActiveGoal()
		if (!pendingBefore) {
			return
		}
		if (this.verificationRounds >= MAX_GOAL_VERIFICATION_ROUNDS) {
			// Cap reached for this submission: close the authorization window
			// but keep the goal, so the next completed run nudges again.
			this.guard.resetVerification()
			return
		}
		const pending = this.guard.beginVerification()
		if (!pending) {
			return
		}
		this.verificationRounds += 1
		const sent = this.options.sendVerificationTurn(sessionId, formatGoalVerificationPrompt(pending.goal))
		if (!sent) {
			Logger.debug(`[SdkGoalCoordinator] Verification send skipped; session no longer active: ${sessionId}`)
			this.verificationRounds -= 1
			this.guard.resetVerification()
		}
	}

	/**
	 * Called when a non-queued send ends without settling (aborted, rejected,
	 * or superseded by a session replacement). Closes the verification
	 * authorization window so an interrupted verification turn cannot leave
	 * mark_goal_complete armed for a later ordinary work turn, and still
	 * surfaces a completion the tool recorded before the interruption.
	 */
	handleTurnAbandoned(): void {
		this.reportNewCompletion()
		this.guard.resetVerification()
	}

	/**
	 * Surfaces a completion recorded since the last settle. The tool executes
	 * mid-turn inside the SDK runtime, so the turn-settled callback is the
	 * first host-side hook that can observe it.
	 */
	private reportNewCompletion(): void {
		const completed = this.guard.getLastCompletedGoal()
		if (!completed || completed.completedAt === this.lastReportedCompletionAt) {
			return
		}
		this.lastReportedCompletionAt = completed.completedAt
		this.options.onGoalCompleted?.(completed)
	}
}
