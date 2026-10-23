/**
 * Declarative turn scripts for the testkit's runtime host.
 *
 * A script is an ordered list of steps that the scripted host replays as
 * `CoreSessionEvent`s, which the real hub server then projects onto the wire as
 * `assistant.delta` / `reasoning.delta` / `tool.*` / `usage.updated` events.
 */

export type ApprovalMode =
	/** Tools run without ever asking the hub for approval. */
	| "auto-approve"
	/** Tools ask the hub and block until some client responds. */
	| "wait-for-respond";

export type ScriptStep =
	| { kind: "text"; chunks: string[] }
	| { kind: "reasoning"; chunks: string[]; redacted?: boolean }
	| {
			kind: "tool";
			name: string;
			toolCallId?: string;
			input?: unknown;
			/** Overrides the hub-level {@link ApprovalMode} for this step. */
			requiresApproval?: boolean;
			output?: unknown;
			error?: string;
	  }
	| {
			kind: "usage";
			inputTokens: number;
			outputTokens: number;
			cacheReadTokens?: number;
			cacheWriteTokens?: number;
			cost?: number;
	  }
	/** Blocks the turn until `hub.releaseGate(id)` is called. */
	| { kind: "gate"; id: string }
	/** Blocks the turn until the run is aborted. */
	| { kind: "abortable-stall" };

export interface TurnScript {
	steps: ScriptStep[];
	/** Terminal reason when the turn is not aborted. Defaults to `completed`. */
	finishReason?: "completed" | "error" | "max_iterations" | "mistake_limit";
	/** Final assistant text. Defaults to the concatenation of all text chunks. */
	text?: string;
}

export function toTurnScript(script: ScriptStep[] | TurnScript): TurnScript {
	return Array.isArray(script) ? { steps: script } : script;
}

/** Text a turn ends up with when the script does not name one explicitly. */
export function scriptedTurnText(script: TurnScript): string {
	if (typeof script.text === "string") {
		return script.text;
	}
	return script.steps
		.filter(
			(step): step is Extract<ScriptStep, { kind: "text" }> =>
				step.kind === "text",
		)
		.flatMap((step) => step.chunks)
		.join("");
}
