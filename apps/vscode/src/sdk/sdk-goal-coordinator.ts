import {
	createInteractiveGoalGuard,
	formatGoalVerificationPrompt,
	type InteractiveGoalGuard,
	MAX_GOAL_VERIFICATION_ROUNDS,
} from "@cline/core"
import type { AgentResult, AgentTool } from "@cline/shared"
import { Logger } from "@/shared/services/Logger"
import type { SdkSendOrigin } from "./sdk-session-lifecycle"

/**
 * A leading "/goal ..." chat message parsed into its subcommand. Mirrors the
 * CLI's /goal chat command: no arguments (or "status") reports the active
 * goal, the off aliases clear it, anything else sets a new goal.
 */
export type GoalCommand = { kind: "status" } | { kind: "clear" } | { kind: "set"; goal: string }

const GOAL_CLEAR_KEYWORDS = new Set(["off", "clear", "stop", "disable"])

/**
 * Parses a chat message that invokes the /goal slash command. Returns
 * undefined for anything else (including messages that merely mention
 * "/goal" mid-text), so ordinary prompts are never hijacked.
 */
export function parseGoalCommand(text: string): GoalCommand | undefined {
	const match = /^\/goal(?=$|\s)([\s\S]*)$/i.exec(text.trim())
	if (!match) {
		return undefined
	}
	const args = (match[1] ?? "").trim()
	const keyword = args.toLowerCase()
	if (!args || keyword === "status") {
		return { kind: "status" }
	}
	if (GOAL_CLEAR_KEYWORDS.has(keyword)) {
		return { kind: "clear" }
	}
	return { kind: "set", goal: args }
}

export interface SdkGoalCoordinatorOptions {
	/**
	 * Sends a hidden verification prompt to the session (no user_feedback
	 * echo, origin "goal-verification"). Returns false when the session is no
	 * longer the active one, so the guard can roll the round back.
	 */
	sendVerificationTurn: (sessionId: string, prompt: string) => boolean
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
	handleSendStart(origin: SdkSendOrigin): void {
		if (origin === "user") {
			this.verificationRounds = 0
			this.guard.resetVerification()
		}
	}

	/**
	 * Called after a non-queued send settles successfully. While a goal is
	 * active and the turn finished "completed", follows up with a hidden
	 * verification turn (up to the round cap per user submission).
	 */
	handleTurnSettled(sessionId: string, result: AgentResult | undefined, _origin: SdkSendOrigin): void {
		if (result?.finishReason !== "completed") {
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
}
