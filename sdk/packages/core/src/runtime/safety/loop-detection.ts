/**
 * Repeated tool-call loop detection.
 *
 * @see PLAN.md §3.1 — helpers moved from `packages/agents/src/context/loop-detection.ts`.
 * @see PLAN.md §3.2.3 — public surface of `LoopDetectionTracker`.
 *
 * The pure helpers (`createLoopDetectionState`, `resetLoopDetectionState`,
 * `toolCallSignature`, `checkRepeatedToolCall`) are ported verbatim. The
 * `LoopDetectionTracker` owns the repeated-call state and groups parallel calls
 * by agent iteration before `SessionRuntime` decides whether to warn or abort.
 */

import type { LoopDetectionConfig } from "@cline/shared";

// =============================================================================
// Pure helpers (verbatim port)
// =============================================================================

export interface LoopDetectionState {
	lastToolName: string;
	lastToolSignature: string;
	consecutiveIdenticalCount: number;
}

export function createLoopDetectionState(): LoopDetectionState {
	return {
		lastToolName: "",
		lastToolSignature: "",
		consecutiveIdenticalCount: 0,
	};
}

export function resetLoopDetectionState(state: LoopDetectionState): void {
	state.lastToolName = "";
	state.lastToolSignature = "";
	state.consecutiveIdenticalCount = 0;
}

function sortKeys(value: unknown): unknown {
	if (value == null || typeof value !== "object") return value;
	if (Array.isArray(value)) return value.map(sortKeys);
	const sorted: Record<string, unknown> = {};
	for (const key of Object.keys(value as Record<string, unknown>).sort()) {
		sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
	}
	return sorted;
}

export function toolCallSignature(input: unknown): string {
	if (input == null) return "null";
	if (typeof input === "string") return input;
	if (typeof input !== "object") return String(input);
	try {
		return JSON.stringify(sortKeys(input));
	} catch {
		return String(input);
	}
}

export interface LoopCheckResult {
	softWarning: boolean;
	hardEscalation: boolean;
}

export function checkRepeatedToolCall(
	state: LoopDetectionState,
	toolName: string,
	signature: string,
	config: LoopDetectionConfig,
): LoopCheckResult {
	if (
		toolName === state.lastToolName &&
		signature === state.lastToolSignature
	) {
		state.consecutiveIdenticalCount++;
	} else {
		state.consecutiveIdenticalCount = 1;
	}
	state.lastToolName = toolName;
	state.lastToolSignature = signature;

	return {
		softWarning: state.consecutiveIdenticalCount === config.softThreshold,
		hardEscalation: state.consecutiveIdenticalCount >= config.hardThreshold,
	};
}

// =============================================================================
// Class wrapper (new — per PLAN.md §3.2.3)
// =============================================================================

/**
 * Verdict returned by {@link LoopDetectionTracker.inspect}.
 *
 * - `"ok"`   — no repeated call detected.
 * - `"soft"` — soft-warning threshold reached; SessionRuntime may surface a
 *              recovery notice but should not block the call.
 * - `"hard"` — hard-escalation threshold reached; SessionRuntime should
 *              stop the run with the provided `message`.
 */
export interface LoopDetectionVerdict {
	kind: "ok" | "soft" | "hard";
	message?: string;
}

/** Minimal runtime call shape needed by the tracker. */
export interface LoopDetectionCall {
	iteration: number;
	name: string;
	input: unknown;
}

const DEFAULT_CONFIG: LoopDetectionConfig = {
	softThreshold: 3,
	hardThreshold: 5,
};

// Changed output may be real progress or volatile noise. The absolute ceiling
// keeps either case bounded without guessing the meaning of arbitrary output.
const ABSOLUTE_LIMIT_MULTIPLIER = 4;

function callKey(toolName: string, toolSignature: string): string {
	return JSON.stringify([toolName, toolSignature]);
}

interface ToolBatch {
	pendingCount: number;
	outcomes: Set<string>;
}

interface SignatureState {
	totalBatchCount: number;
	lastOutputSignature?: string;
	hasProgress: boolean;
}

/**
 * Per-session repeated-tool-call detector.
 *
 * `SessionRuntime` owns the instance and calls `inspect()` for every
 * `tool-started` event.
 */
export class LoopDetectionTracker {
	private readonly config: LoopDetectionConfig;
	private readonly state: LoopDetectionState = createLoopDetectionState();
	private readonly pendingBatches = new Map<string, ToolBatch>();
	private readonly signatures = new Map<string, SignatureState>();

	constructor(config?: Partial<LoopDetectionConfig>) {
		this.config = {
			softThreshold: config?.softThreshold ?? DEFAULT_CONFIG.softThreshold,
			hardThreshold: config?.hardThreshold ?? DEFAULT_CONFIG.hardThreshold,
		};
	}

	inspect(call: LoopDetectionCall): LoopDetectionVerdict {
		const signature = toolCallSignature(call.input);
		const key = callKey(call.name, signature);
		const signatureState = this.getSignature(key);
		if (signatureState.hasProgress) {
			resetLoopDetectionState(this.state);
			signatureState.hasProgress = false;
		}

		const batchId = JSON.stringify([call.iteration, key]);
		let batch = this.pendingBatches.get(batchId);
		const isNewBatch = batch === undefined;
		if (batch === undefined) {
			batch = { pendingCount: 0, outcomes: new Set() };
			this.pendingBatches.set(batchId, batch);
			signatureState.totalBatchCount++;
		}
		batch.pendingCount++;

		const absoluteHardLimit =
			this.config.hardThreshold * ABSOLUTE_LIMIT_MULTIPLIER;
		if (batch.pendingCount >= absoluteHardLimit) {
			return this.hard(
				`Detected ${batch.pendingCount} identical calls to \`${call.name}\` still pending in one batch; stopping because earlier calls did not complete.`,
			);
		}

		if (!isNewBatch) return { kind: "ok" };
		const result = checkRepeatedToolCall(
			this.state,
			call.name,
			signature,
			this.config,
		);
		if (
			result.hardEscalation ||
			signatureState.totalBatchCount >= absoluteHardLimit
		) {
			return this.hard(
				signatureState.totalBatchCount >= absoluteHardLimit
					? `Detected ${signatureState.totalBatchCount} repeated batches of identical calls to \`${call.name}\` despite changing results; stopping to avoid a loop.`
					: `Detected ${this.state.consecutiveIdenticalCount} consecutive identical calls to \`${call.name}\`; stopping to avoid a loop.`,
			);
		}
		if (result.softWarning) {
			return {
				kind: "soft",
				message: `Detected ${this.state.consecutiveIdenticalCount} consecutive identical calls to \`${call.name}\`; consider trying a different approach.`,
			};
		}
		return { kind: "ok" };
	}

	/**
	 * Complete an inspected call. AgentRuntime finishes every tool in an
	 * iteration before starting the next iteration, so iteration plus signature
	 * is the complete parallel-batch identity.
	 */
	observeOutcome(
		call: LoopDetectionCall,
		outcome: { successful: boolean; output?: unknown },
	): void {
		const key = callKey(call.name, toolCallSignature(call.input));
		const batchId = JSON.stringify([call.iteration, key]);
		const batch = this.pendingBatches.get(batchId);
		if (batch === undefined) return;

		if (outcome.successful) {
			batch.outcomes.add(toolCallSignature(outcome.output));
		}
		batch.pendingCount--;
		if (batch.pendingCount > 0) return;

		this.pendingBatches.delete(batchId);
		if (batch.outcomes.size === 0) return;

		const signatureState = this.signatures.get(key);
		if (signatureState === undefined) return;
		const outputSignature = JSON.stringify([...batch.outcomes].sort());
		if (
			signatureState.lastOutputSignature !== undefined &&
			signatureState.lastOutputSignature !== outputSignature
		) {
			signatureState.hasProgress = true;
		}
		signatureState.lastOutputSignature = outputSignature;
	}

	/**
	 * Drop correlation state for calls that did not finish before their runtime
	 * stopped. Completed outcome history and repeated-call counters remain
	 * available to a subsequent continuation.
	 */
	clearPendingCalls(): void {
		this.pendingBatches.clear();
	}

	reset(): void {
		resetLoopDetectionState(this.state);
		this.pendingBatches.clear();
		this.signatures.clear();
	}

	private getSignature(key: string): SignatureState {
		let state = this.signatures.get(key);
		if (state === undefined) {
			state = {
				totalBatchCount: 0,
				hasProgress: false,
			};
			this.signatures.set(key, state);
		}
		return state;
	}

	private hard(message: string): LoopDetectionVerdict {
		return { kind: "hard", message };
	}
}
