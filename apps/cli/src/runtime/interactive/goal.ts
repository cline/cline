import { createTool, formatUserCommandBlock } from "@cline/shared";

/**
 * Native /goal completion guard for the interactive CLI.
 *
 * Setting a goal submits it as the task prompt and keeps the goal active
 * until the model explicitly confirms completion. After every completed run
 * with an active goal, the runtime sends a follow-up verification turn asking
 * the model whether the goal is actually done. The model either continues the
 * remaining work or calls the mark_goal_complete tool, which only succeeds
 * while a verification turn is pending so it cannot be used to end the
 * initial work run early.
 */
export type InteractiveGoalRecord = {
	goal: string;
	createdAt: string;
	awaitingVerification: boolean;
};

export type CompletedGoalRecord = {
	goal: string;
	completedAt: string;
	summary?: string;
};

export const GOAL_COMMAND_USAGE = [
	"Usage:",
	"/goal <task> - set a goal and start working on it",
	"/goal status - show the active goal",
	"/goal off - clear the active goal",
].join("\n");

/**
 * Upper bound on automatic verification turns per user submission. The goal
 * stays active when the cap is reached, so the next completed run nudges
 * again, but a model that never calls mark_goal_complete cannot spin
 * unattended forever within a single submission.
 */
export const MAX_GOAL_VERIFICATION_ROUNDS = 3;

export function formatGoalTaskPrompt(goal: string): string {
	return formatUserCommandBlock(goal, "goal");
}

const GOAL_VERIFICATION_PROMPT_PREFIX =
	"Are you sure you've completed the goal:";
const GOAL_VERIFICATION_PROMPT_MARKER =
	"This verification prompt is the only time you may call mark_goal_complete.";

export function formatGoalVerificationPrompt(goal: string): string {
	return [
		`${GOAL_VERIFICATION_PROMPT_PREFIX} ${goal}`,
		"",
		GOAL_VERIFICATION_PROMPT_MARKER,
		"If yes, call mark_goal_complete with a concise summary.",
		"If not, continue the remaining work before calling mark_goal_complete.",
	].join("\n");
}

/**
 * Detects the runtime-generated goal verification prompt so transcript
 * surfaces can hide it from user bubbles, the same way the act-mode
 * continuation prompt is hidden. The goal text is dynamic, so this matches
 * the fixed prefix plus the fixed instruction line instead of exact equality.
 */
export function isGoalVerificationPrompt(text: string): boolean {
	return (
		text.startsWith(GOAL_VERIFICATION_PROMPT_PREFIX) &&
		text.includes(GOAL_VERIFICATION_PROMPT_MARKER)
	);
}

function parseMarkGoalCompleteInput(input: unknown): { summary?: string } {
	if (input === null || typeof input !== "object" || Array.isArray(input)) {
		return {};
	}
	const summary = (input as Record<string, unknown>).summary;
	if (typeof summary === "string" && summary.trim()) {
		return { summary: summary.trim() };
	}
	return {};
}

export type InteractiveGoalGuard = ReturnType<
	typeof createInteractiveGoalGuard
>;

export function createInteractiveGoalGuard() {
	let active: InteractiveGoalRecord | undefined;
	let lastCompleted: CompletedGoalRecord | undefined;

	const formatStatus = (): string => {
		const lines: string[] = [];
		if (active) {
			const suffix = active.awaitingVerification
				? " (awaiting verification)"
				: "";
			lines.push(`Active goal: ${active.goal}${suffix}`);
		} else {
			lines.push("No goal is active. Use /goal <task> to set one.");
		}
		if (lastCompleted) {
			const summary = lastCompleted.summary
				? ` — ${lastCompleted.summary}`
				: "";
			lines.push(`Last completed goal: ${lastCompleted.goal}${summary}`);
		}
		return lines.join("\n");
	};

	const markGoalCompleteTool = createTool<unknown, Record<string, unknown>>({
		name: "mark_goal_complete",
		description:
			"Mark the active goal complete only after the follow-up verification prompt explicitly asks whether the goal is complete. " +
			"Never call this during the initial work run; it only succeeds while a verification prompt is pending.",
		inputSchema: {
			type: "object",
			properties: {
				summary: {
					type: "string",
					description:
						"Concise summary of what was completed for the active goal. Only provide this after the verification prompt asks you to confirm completion.",
				},
			},
			additionalProperties: false,
		},
		retryable: false,
		maxRetries: 0,
		execute: async (input) => {
			if (!active) {
				return {
					completed: false,
					message: "No goal is active for this session.",
				};
			}
			if (!active.awaitingVerification) {
				return {
					completed: false,
					message:
						"Do not call mark_goal_complete until the follow-up verification prompt asks whether the goal is complete.",
				};
			}
			const { summary } = parseMarkGoalCompleteInput(input);
			lastCompleted = {
				goal: active.goal,
				completedAt: new Date().toISOString(),
				...(summary ? { summary } : {}),
			};
			active = undefined;
			return {
				completed: true,
				goal: lastCompleted.goal,
				summary: lastCompleted.summary ?? "",
			};
		},
	});

	return {
		markGoalCompleteTool,
		getActiveGoal: (): InteractiveGoalRecord | undefined => active,
		getLastCompletedGoal: (): CompletedGoalRecord | undefined => lastCompleted,
		formatStatus,
		setGoal(goal: string): { reply: string; submitPrompt: string } {
			const trimmed = goal.trim();
			active = {
				goal: trimmed,
				createdAt: new Date().toISOString(),
				awaitingVerification: false,
			};
			return {
				reply: `Goal set: ${trimmed}\nI'll keep nudging until it is verified complete. Use /goal off to clear it.`,
				submitPrompt: formatGoalTaskPrompt(trimmed),
			};
		},
		clearGoal(): string {
			if (!active) {
				return "No goal is active.";
			}
			active = undefined;
			return "Goal cleared.";
		},
		/**
		 * Marks the active goal as awaiting verification and returns it, or
		 * undefined when no goal needs verification. Called by the runtime
		 * right before it sends a verification turn.
		 */
		beginVerification(): InteractiveGoalRecord | undefined {
			if (!active) {
				return undefined;
			}
			active = { ...active, awaitingVerification: true };
			return active;
		},
		/**
		 * Revokes verification authorization. Called when a verification
		 * sequence ends without completing the goal (and defensively before
		 * each new submission), so mark_goal_complete cannot succeed during an
		 * ordinary work turn using authorization left over from an earlier
		 * verification turn.
		 */
		resetVerification(): void {
			if (active?.awaitingVerification) {
				active = { ...active, awaitingVerification: false };
			}
		},
	};
}

/**
 * Runs one interactive turn and, while a goal is active and the turn finished
 * "completed", follows up with verification turns asking the model to either
 * confirm completion (via mark_goal_complete) or continue the remaining work.
 * Mirrors sendTurnWithActModeContinuation so both wrappers compose.
 */
export async function sendTurnWithGoalVerification<
	T extends { finishReason: string; iterations: number },
>(input: {
	goalGuard: Pick<
		InteractiveGoalGuard,
		"beginVerification" | "resetVerification"
	>;
	sendInitialTurn: () => Promise<T | undefined>;
	sendVerificationTurn: (prompt: string) => Promise<T | undefined>;
}): Promise<T | undefined> {
	// The initial turn is ordinary work: revoke any verification
	// authorization left over from an earlier sequence (e.g. an aborted
	// verification turn) so mark_goal_complete refuses during it.
	input.goalGuard.resetVerification();
	let result = await input.sendInitialTurn();
	try {
		for (let round = 0; round < MAX_GOAL_VERIFICATION_ROUNDS; round += 1) {
			if (result?.finishReason !== "completed") {
				return result;
			}
			const pending = input.goalGuard.beginVerification();
			if (!pending) {
				return result;
			}
			const verification = await input.sendVerificationTurn(
				formatGoalVerificationPrompt(pending.goal),
			);
			if (!verification) {
				return result;
			}
			result = {
				...verification,
				iterations: result.iterations + verification.iterations,
			};
		}
		return result;
	} finally {
		// Every exit path is either before beginVerification or after its
		// verification turn finished, so closing authorization here can never
		// revoke a verification turn that is still in flight.
		input.goalGuard.resetVerification();
	}
}
