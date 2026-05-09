/**
 * Per-session consecutive-mistake tracker.
 *
 * @see PLAN.md §3.1 — wrapped around `recordMistake` moved from
 *                    `packages/agents/src/api/error-handling.ts` lines 147–311.
 * @see PLAN.md §3.2.3 — public surface of `MistakeTracker`.
 *
 * The pure procedural `recordMistake(input, deps)` becomes `record(input)`
 * on the class; `consecutiveMistakes` is internal state. Other deps flow
 * through the constructor instead.
 *
 * NOTE: the §3.2.3 constructor shape omits some fields (agentId,
 * conversationId/runId getters, appendRecoveryNotice). They are retained
 * here for log + notice parity per PLAN.md §3.4.3/§3.4.5. Step 8
 * (`impl-runtime-porter`) may refactor once SessionRuntime is wired up.
 */

import type {
	AgentEvent,
	BasicLogMetadata,
	ConsecutiveMistakeLimitContext,
	ConsecutiveMistakeLimitDecision,
} from "@clinebot/shared";

/**
 * Legacy-agents-style leveled log function. The sdk-re `BasicLogger`
 * does not carry a level argument (§shared/logging/logger.ts); callers
 * are expected to bridge via `metadata.severity` or dispatch to
 * `debug`/`log`/`error`. `MistakeTracker` accepts a leveled callable
 * here so Step 8 can plug in whichever bridging shape `SessionRuntime`
 * ends up using.
 */
export type LeveledLog = (
	level: "debug" | "info" | "warn" | "error",
	message: string,
	metadata?: BasicLogMetadata,
) => void;

export type MistakeReason =
	| "api_error"
	| "invalid_tool_call"
	| "tool_execution_failed";

export interface RecordMistakeInput {
	iteration: number;
	reason: MistakeReason;
	details?: string;
	/** When true, jump straight to maxConsecutiveMistakes instead of incrementing by 1. */
	forceAtLimit?: boolean;
}

export type MistakeOutcome =
	| { action: "continue"; guidance?: string }
	| { action: "stop"; message: string; reason?: string };

export interface MistakeTrackerOptions {
	readonly maxConsecutiveMistakes: number;
	readonly onLimitReached?: (
		ctx: ConsecutiveMistakeLimitContext,
	) =>
		| Promise<ConsecutiveMistakeLimitDecision>
		| ConsecutiveMistakeLimitDecision;
	readonly emit: (event: AgentEvent) => void;
	readonly log: LeveledLog;
	readonly agentId: string;
	readonly getConversationId: () => string;
	readonly getActiveRunId: () => string;
	readonly appendRecoveryNotice: (
		message: string,
		reason: MistakeReason,
	) => void;
}

export class MistakeTracker {
	private consecutiveMistakes = 0;
	private readonly options: MistakeTrackerOptions;

	constructor(options: MistakeTrackerOptions) {
		this.options = options;
	}

	async record(input: RecordMistakeInput): Promise<MistakeOutcome> {
		const max = this.options.maxConsecutiveMistakes;
		const next = input.forceAtLimit && max ? max : this.consecutiveMistakes + 1;
		this.consecutiveMistakes = next;

		const errorMessage =
			input.details?.trim() || `consecutive mistake (${input.reason})`;
		this.options.emit({
			type: "error",
			error: new Error(errorMessage),
			recoverable: true,
			iteration: input.iteration,
		});
		this.options.log("warn", "Recorded consecutive mistake", {
			agentId: this.options.agentId,
			conversationId: this.options.getConversationId(),
			runId: this.options.getActiveRunId(),
			iteration: input.iteration,
			reason: input.reason,
			details: input.details,
			consecutiveMistakes: next,
			maxConsecutiveMistakes: this.options.maxConsecutiveMistakes,
		});

		if (!max || next < max) {
			return { action: "continue" };
		}

		const decision = await resolveConsecutiveMistakeDecision(
			{
				iteration: input.iteration,
				consecutiveMistakes: next,
				maxConsecutiveMistakes: max,
				reason: input.reason,
				details: input.details,
			},
			this.options.onLimitReached,
		);

		if (decision.action === "continue") {
			const guidance = decision.guidance?.trim();
			if (guidance) {
				this.options.appendRecoveryNotice(guidance, input.reason);
			}
			this.consecutiveMistakes = 0;
			return { action: "continue", guidance };
		}

		return {
			action: "stop",
			reason: decision.reason?.trim() || undefined,
			message: buildMistakeLimitStopMessage({
				iteration: input.iteration,
				consecutiveMistakes: next,
				maxConsecutiveMistakes: max,
				reason: input.reason,
				details: input.details,
				stopReason: decision.reason,
			}),
		};
	}

	reset(): void {
		this.consecutiveMistakes = 0;
	}

	get value(): number {
		return this.consecutiveMistakes;
	}
}

// =============================================================================
// Mistake Limit Stop Message (pure helper — ported verbatim)
// =============================================================================

export function buildMistakeLimitStopMessage(input: {
	iteration: number;
	consecutiveMistakes: number;
	maxConsecutiveMistakes: number;
	reason:
		| "api_error"
		| "invalid_tool_call"
		| "completion_without_submit"
		| "tool_execution_failed";
	details?: string;
	stopReason?: string;
}): string {
	const parts = [
		`Stopped after ${input.consecutiveMistakes}/${input.maxConsecutiveMistakes} consecutive mistakes (${input.reason}) at iteration ${input.iteration}.`,
	];
	const details = input.details?.trim();
	if (details) {
		parts.push(`Error: ${details}`);
	}
	const stopReason = input.stopReason?.trim();
	if (stopReason) {
		parts.push(`Decision: ${stopReason}`);
	}
	parts.push(
		"Session state was preserved. Send a new prompt to resume from the latest state.",
	);
	return parts.join(" ");
}

// =============================================================================
// Consecutive Mistake Decision Resolution (pure helper — ported verbatim)
// =============================================================================

async function resolveConsecutiveMistakeDecision(
	input: ConsecutiveMistakeLimitContext,
	callback?: (
		context: ConsecutiveMistakeLimitContext,
	) =>
		| Promise<ConsecutiveMistakeLimitDecision>
		| ConsecutiveMistakeLimitDecision,
): Promise<ConsecutiveMistakeLimitDecision> {
	if (!callback) {
		return {
			action: "stop",
			reason: `maximum consecutive mistakes reached (${input.maxConsecutiveMistakes})`,
		};
	}
	try {
		return await callback(input);
	} catch (error) {
		return {
			action: "stop",
			reason:
				error instanceof Error
					? error.message
					: `maximum consecutive mistakes reached (${input.maxConsecutiveMistakes})`,
		};
	}
}

// TODO(PLAN.md Step 8): The `emit` channel currently accepts legacy `AgentEvent`
// so the "recoverable error" event shape is preserved verbatim. When
// `SessionRuntime` wires this up in Step 8, consider whether this should
// emit an `AgentRuntimeEvent` (per the §3.2.3 signature proposal) and let
// the bridge translate, or keep the direct legacy channel for notice parity.
