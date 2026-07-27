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

function progressStep(signature: string): number | undefined {
	const percent = signature.match(/\b(\d+(?:\.\d+)?)\s*%/);
	if (percent) {
		const value = Number(percent[1]);
		return value <= 100 ? Math.floor(value) : undefined;
	}

	const named = signature.match(
		/"(?:progress|percent|percentage|percentComplete)"\s*:\s*(\d+(?:\.\d+)?)/i,
	);
	if (named) {
		const value = Number(named[1]);
		const percentage = value <= 1 ? value * 100 : value;
		return percentage <= 100 ? Math.floor(percentage) : undefined;
	}

	const ratio = signature.match(/\b(\d+)\s*\/\s*(\d+)\b/);
	if (!ratio) return undefined;
	const current = Number(ratio[1]);
	const total = Number(ratio[2]);
	return total > 0 && current <= total
		? Math.floor((current / total) * 100)
		: undefined;
}

interface ToolBatch {
	iteration: number;
	key: string;
	pendingCount: number;
	outcomes: Set<string>;
	highestProgressStep?: number;
}

interface SignatureState {
	totalBatchCount: number;
	lastOutputSignature?: string;
	highestProgressStep?: number;
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
		this.finalizeCompletedBatchesBefore(call.iteration);
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
			batch = {
				iteration: call.iteration,
				key,
				pendingCount: 0,
				outcomes: new Set(),
			};
			this.pendingBatches.set(batchId, batch);
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
		const totalBatchCount = signatureState.totalBatchCount + 1;
		const result = checkRepeatedToolCall(
			this.state,
			call.name,
			signature,
			this.config,
		);
		if (result.hardEscalation || totalBatchCount >= absoluteHardLimit) {
			return this.hard(
				totalBatchCount >= absoluteHardLimit
					? `Detected ${totalBatchCount} repeated batches of identical calls to \`${call.name}\` despite changing results; stopping to avoid a loop.`
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
			const outputSignature = toolCallSignature(outcome.output);
			batch.outcomes.add(outputSignature);
			const step = progressStep(outputSignature);
			if (
				step !== undefined &&
				(batch.highestProgressStep === undefined ||
					step > batch.highestProgressStep)
			) {
				batch.highestProgressStep = step;
			}
		}
		batch.pendingCount = Math.max(0, batch.pendingCount - 1);
	}

	/**
	 * Finalize completed batches and drop calls that did not finish before their
	 * runtime stopped. Unfinished batches never consume the completed-batch
	 * fallback budget.
	 */
	clearPendingCalls(): void {
		for (const batch of this.pendingBatches.values()) {
			if (batch.pendingCount === 0) {
				this.finalizeBatch(batch);
			}
		}
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

	private finalizeCompletedBatchesBefore(iteration: number): void {
		for (const [batchId, batch] of this.pendingBatches) {
			if (batch.iteration === iteration || batch.pendingCount > 0) continue;
			this.pendingBatches.delete(batchId);
			this.finalizeBatch(batch);
		}
	}

	private finalizeBatch(batch: ToolBatch): void {
		const signatureState = this.signatures.get(batch.key);
		if (signatureState === undefined) return;
		signatureState.totalBatchCount++;
		if (batch.outcomes.size === 0) return;

		const outputSignature = JSON.stringify([...batch.outcomes].sort());
		if (
			signatureState.lastOutputSignature !== undefined &&
			signatureState.lastOutputSignature !== outputSignature
		) {
			signatureState.hasProgress = true;
		}
		if (
			batch.highestProgressStep !== undefined &&
			(signatureState.highestProgressStep === undefined ||
				batch.highestProgressStep > signatureState.highestProgressStep)
		) {
			signatureState.highestProgressStep = batch.highestProgressStep;
			signatureState.totalBatchCount = 0;
		}
		signatureState.lastOutputSignature = outputSignature;
	}

	private hard(message: string): LoopDetectionVerdict {
		return { kind: "hard", message };
	}
}
