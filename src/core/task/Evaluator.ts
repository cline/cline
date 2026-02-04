import { EvaluatorDecision, EvaluatorSignals } from "./focus-chain/types"

export interface EvaluatorContext {
	consecutiveMistakeCount: number
	apiRequestsCount: number
}

export class Evaluator {
	private replanCount: number = 0

	constructor(
		private readonly maxConsecutiveMistakes: number = 3,
		private readonly maxReplanAttempts: number = 3,
	) {}

	/**
	 * Evaluates the signals from the model properly with context awareness.
	 *
	 * @param signals - The signals provided by the model (or undefined if not provided)
	 * @param context - The current context of the task execution (mistakes, etc.)
	 * @returns The final decision on how to proceed
	 */
	public evaluate(signals: EvaluatorSignals | undefined, context: EvaluatorContext): EvaluatorDecision {
		// 1. Circuit Breaker: Safety override if mistakes are too high
		if (context.consecutiveMistakeCount >= this.maxConsecutiveMistakes) {
			// If we've hit the max mistakes, we force a stop regardless of what the model says.
			// This prevents the model from endlessly trying and failing.
			return "stop"
		}

		// 2. Fail-Safe Default: If no signals are provided
		if (!signals) {
			// If things are going well (low mistakes), assume continue
			if (context.consecutiveMistakeCount === 0) {
				return "continue"
			}
			// If we are starting to accumulate mistakes but no signal is given,
			// it's safer to just continue for now but relies on the mistake counter to eventually stop it.
			// Ideally the model SHOULD provide signals.
			return "continue"
		}

		// 3. Process Explicit Signal
		const decision = signals.decision

		if (decision === "stop") {
			return "stop"
		}

		if (decision === "replan") {
			// Security: Infinite Loop Prevention
			// If we replan too many times without clearing the counter, force a stop.
			// Note: The caller (Task) is responsible for resetting this counter if a successful action occurs between replans,
			// or we can track it purely here if we persist the evaluator instance.
			// For this iteration, assuming this instance persists for the task duration or is managed appropriately.
			// However, since we might re-instantiate, let's assume `replanCount` is tracked statefully or passed in context.
			// For now, tracking locally in the instance assumes the instance lives with the Task.
			if (this.replanCount >= this.maxReplanAttempts) {
				return "stop"
			}
			this.replanCount++
			return "replan"
		}

		if (decision === "continue") {
			// Reset replan count on a successful continue decision (implying we are moving forward)
			// Although "continue" doesn't guarantee success, it breaks the replan loop.
			this.replanCount = 0
			return "continue"
		}

		// Fallback for invalid decision string
		return "continue"
	}

	/**
	 * Resets internal state like replan counters.
	 * Should be called when a task step is successfully completed.
	 */
	public reset() {
		this.replanCount = 0
	}
}
