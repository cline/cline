/**
 * Repeated tool-call loop detection.
 *
 * @see PLAN.md §3.1 — helpers moved from `packages/agents/src/context/loop-detection.ts`.
 * @see PLAN.md §3.2.3 — public surface of `LoopDetectionTracker`.
 *
 * The pure helpers (`createLoopDetectionState`, `resetLoopDetectionState`,
 * `toolCallSignature`, `checkRepeatedToolCall`) are ported verbatim. The
 * `LoopDetectionTracker` owns the repeated-call state, correlates parallel
 * outcomes, and distinguishes semantic result progress from volatile output
 * before `SessionRuntime` decides whether to warn or abort.
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

/** Minimal call shape the tracker needs; matches `AgentToolCallPart` subset. */
export interface LoopDetectionCall {
	id?: string;
	name: string;
	input: unknown;
}

const DEFAULT_CONFIG: LoopDetectionConfig = {
	softThreshold: 3,
	hardThreshold: 5,
};

// Output comparison is necessarily heuristic for arbitrary tools. Keep an
// absolute ceiling so even unrecognized volatile changes cannot grant progress
// forever, while allowing several normal polling windows to complete.
const MAX_PROGRESS_WINDOWS = 4;

const VOLATILE_OUTPUT_KEY =
	/^(?:correlationid|checkedat|createdat|duration(?:ms)?|elapsed(?:ms)?|endedat|eventid|finishedat|lastseenat|polledat|requestid|spanid|startedat|time|timestamp|traceid|updatedat)$/;
const LOG_OUTPUT_KEY = /^(?:log|logs|logtail|stderr|stdout|tail)$/;

const PROGRESS_TEXT_PATTERN =
	/\b(?:complete(?:d)?|done|failed|phase|progress|queued|running|stage|state|status|succeeded|success)\b|\b\d+(?:\.\d+)?%|\b\d+\s*\/\s*\d+\b/i;

function compactOutputKey(key: string): string {
	return key.replaceAll(/[^a-z0-9]/gi, "").toLowerCase();
}

function normalizeOutputText(value: string, logLike: boolean): string {
	const normalized = value
		.replaceAll(
			/\b(?:correlation|event|request|span|trace)[-_ ]?id\s*[:=]\s*["']?[a-z0-9._:/-]+/gi,
			"<volatile-id>",
		)
		.replaceAll(
			/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
			"<volatile-id>",
		)
		.replaceAll(
			/\b(?:checked|created|elapsed|ended|finished|polled|started|time|timestamp|updated)(?:[-_ ]?at)?\s*[:=]\s*["']?(?:\d{10,13}|\d+(?:\.\d+)?(?:ms|s))/gi,
			"<volatile-time>",
		)
		.replaceAll(
			/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?\b/g,
			"<volatile-time>",
		)
		.replaceAll(
			/\b(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?\b/g,
			"<volatile-time>",
		);
	const lines = normalized
		.split(/\r?\n/)
		.map((line) => line.trim().replaceAll(/\s+/g, " "))
		.filter(Boolean);

	const uniqueLines = [...new Set(lines)];
	if (!logLike) return uniqueLines.join("\n");
	return (
		uniqueLines.filter((line) => PROGRESS_TEXT_PATTERN.test(line)).join("\n") ||
		"<log-output>"
	);
}

function normalizeToolOutcome(value: unknown, parentKey?: string): unknown {
	if (typeof value === "string") {
		return normalizeOutputText(
			value,
			parentKey !== undefined &&
				LOG_OUTPUT_KEY.test(compactOutputKey(parentKey)),
		);
	}
	if (value == null || typeof value !== "object") return value;
	if (Array.isArray(value)) {
		const normalizedEntries = value.map((entry) =>
			normalizeToolOutcome(entry, parentKey),
		);
		if (
			parentKey !== undefined &&
			LOG_OUTPUT_KEY.test(compactOutputKey(parentKey))
		) {
			const progressEntries = normalizedEntries
				.map((entry) => JSON.stringify(entry) ?? "null")
				.filter((entry) => PROGRESS_TEXT_PATTERN.test(entry));
			return progressEntries.length === 0
				? ["<log-output>"]
				: [...new Set(progressEntries)].sort();
		}
		return normalizedEntries;
	}

	const normalized: Record<string, unknown> = {};
	for (const key of Object.keys(value as Record<string, unknown>).sort()) {
		if (VOLATILE_OUTPUT_KEY.test(compactOutputKey(key))) continue;
		normalized[key] = normalizeToolOutcome(
			(value as Record<string, unknown>)[key],
			key,
		);
	}
	return normalized;
}

function toolOutcomeFingerprint(output: unknown): string {
	try {
		return JSON.stringify(normalizeToolOutcome(output)) ?? "undefined";
	} catch {
		return normalizeOutputText(String(output), false);
	}
}

function sequenceKey(toolName: string, toolSignature: string): string {
	return JSON.stringify([toolName, toolSignature]);
}

interface PendingBatch {
	key: string;
	pendingCount: number;
	outcomes: Set<string>;
}

interface SignatureProgressState {
	totalBatchCount: number;
	latestOutcomeBatchId: number;
	lastOutputSignature?: string;
	progressVersion: number;
}

interface ActiveSequence {
	key: string;
	observedProgressVersion: number;
	activeBatchId?: number;
}

/**
 * Per-session repeated-tool-call detector.
 *
 * `SessionRuntime` owns the instance and installs a `beforeTool` hook
 * (see `AgentRuntimeHooks.beforeTool`) that calls `inspect()` to decide
 * whether to return `{ skip, stop, reason }`.
 */
export class LoopDetectionTracker {
	private readonly config: LoopDetectionConfig;
	private readonly state: LoopDetectionState = createLoopDetectionState();
	private currentSequence: ActiveSequence | undefined;
	private nextBatchId = 1;
	private readonly pendingCalls = new Map<string, number>();
	private anonymousPendingBatchId: number | undefined;
	private readonly pendingBatches = new Map<number, PendingBatch>();
	private readonly signatureProgress = new Map<
		string,
		SignatureProgressState
	>();

	constructor(config?: Partial<LoopDetectionConfig>) {
		this.config = {
			softThreshold: config?.softThreshold ?? DEFAULT_CONFIG.softThreshold,
			hardThreshold: config?.hardThreshold ?? DEFAULT_CONFIG.hardThreshold,
		};
	}

	inspect(call: LoopDetectionCall): LoopDetectionVerdict {
		const signature = toolCallSignature(call.input);
		const key = sequenceKey(call.name, signature);
		const progress = this.getProgress(key);
		let sequence = this.currentSequence;
		if (sequence?.key !== key) {
			sequence = {
				key,
				observedProgressVersion: progress.progressVersion,
			};
			this.currentSequence = sequence;
		} else if (sequence.observedProgressVersion !== progress.progressVersion) {
			resetLoopDetectionState(this.state);
			sequence.observedProgressVersion = progress.progressVersion;
		}

		// Calls without ids cannot be correlated safely, so only identified calls
		// join an unfinished batch from the current uninterrupted sequence.
		let batchId = call.id === undefined ? undefined : sequence.activeBatchId;
		let batch =
			batchId === undefined ? undefined : this.pendingBatches.get(batchId);
		const isNewBatch = batch === undefined;
		if (batch === undefined) {
			batchId = this.nextBatchId++;
			batch = { key, pendingCount: 0, outcomes: new Set() };
			this.pendingBatches.set(batchId, batch);
			sequence.activeBatchId = batchId;
			progress.totalBatchCount++;
		}
		if (batchId === undefined) {
			throw new Error("Loop detection batch was not initialized");
		}
		batch.pendingCount++;
		if (call.id !== undefined) {
			this.pendingCalls.set(call.id, batchId);
		} else {
			this.anonymousPendingBatchId = batchId;
		}

		const absoluteHardLimit = this.config.hardThreshold * MAX_PROGRESS_WINDOWS;
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
			progress.totalBatchCount >= absoluteHardLimit
		) {
			return this.hard(
				progress.totalBatchCount >= absoluteHardLimit
					? `Detected ${progress.totalBatchCount} repeated batches of identical calls to \`${call.name}\` despite changing results; stopping to avoid a loop.`
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
	 * Complete an inspected call. Parallel calls in one uninterrupted sequence
	 * share a batch, so every outcome contributes regardless of finish order.
	 * Completed batches are applied by start order; failed outcomes only close
	 * their pending call.
	 */
	observeOutcome(
		call: LoopDetectionCall,
		outcome: { successful: boolean; output?: unknown },
	): void {
		const batchId =
			call.id === undefined
				? this.anonymousPendingBatchId
				: this.pendingCalls.get(call.id);
		if (call.id !== undefined) {
			this.pendingCalls.delete(call.id);
		} else {
			this.anonymousPendingBatchId = undefined;
		}
		if (batchId === undefined) return;
		const batch = this.pendingBatches.get(batchId);
		if (batch === undefined) return;

		const key = sequenceKey(call.name, toolCallSignature(call.input));
		if (batch.key === key && outcome.successful) {
			batch.outcomes.add(toolOutcomeFingerprint(outcome.output));
		}
		batch.pendingCount--;
		if (batch.pendingCount > 0) return;

		this.pendingBatches.delete(batchId);
		if (this.currentSequence?.activeBatchId === batchId) {
			this.currentSequence.activeBatchId = undefined;
		}
		if (batch.outcomes.size === 0) return;

		const progress = this.signatureProgress.get(batch.key);
		if (progress === undefined || batchId <= progress.latestOutcomeBatchId) {
			return;
		}
		const outputSignature = JSON.stringify([...batch.outcomes].sort());
		if (
			progress.lastOutputSignature !== undefined &&
			progress.lastOutputSignature !== outputSignature
		) {
			progress.progressVersion++;
		}
		progress.latestOutcomeBatchId = batchId;
		progress.lastOutputSignature = outputSignature;
	}

	/**
	 * Drop correlation state for calls that did not finish before their runtime
	 * stopped. Completed outcome history and repeated-call counters remain
	 * available to a subsequent continuation.
	 */
	clearPendingCalls(): void {
		this.pendingCalls.clear();
		this.anonymousPendingBatchId = undefined;
		this.pendingBatches.clear();
		if (this.currentSequence !== undefined) {
			this.currentSequence.activeBatchId = undefined;
		}
	}

	reset(): void {
		resetLoopDetectionState(this.state);
		this.currentSequence = undefined;
		this.nextBatchId = 1;
		this.pendingCalls.clear();
		this.anonymousPendingBatchId = undefined;
		this.pendingBatches.clear();
		this.signatureProgress.clear();
	}

	private getProgress(key: string): SignatureProgressState {
		let progress = this.signatureProgress.get(key);
		if (progress === undefined) {
			progress = {
				totalBatchCount: 0,
				latestOutcomeBatchId: 0,
				progressVersion: 0,
			};
			this.signatureProgress.set(key, progress);
		}
		return progress;
	}

	private hard(message: string): LoopDetectionVerdict {
		return { kind: "hard", message };
	}
}
