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

const VOLATILE_OUTPUT_KEYS = new Set([
	"correlationid",
	"checkedat",
	"createdat",
	"duration",
	"durationms",
	"elapsed",
	"elapsedms",
	"endedat",
	"eventid",
	"finishedat",
	"lastseenat",
	"polledat",
	"requestid",
	"spanid",
	"startedat",
	"time",
	"timestamp",
	"traceid",
	"updatedat",
]);

const LOG_OUTPUT_KEYS = new Set([
	"log",
	"logs",
	"logtail",
	"stderr",
	"stdout",
	"tail",
]);

const PROGRESS_TEXT_PATTERN =
	/\b(?:complete(?:d)?|done|failed|phase|progress|queued|running|stage|state|status|succeeded|success)\b|\b\d+(?:\.\d+)?%|\b\d+\s*\/\s*\d+\b/i;

function compactOutputKey(key: string): string {
	return key.replaceAll(/[^a-z0-9]/gi, "").toLowerCase();
}

function normalizeOutputText(value: string, logLike: boolean): string {
	const lines = value
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
		)
		.split(/\r?\n/)
		.map((line) => line.trim().replaceAll(/\s+/g, " "))
		.filter(Boolean);

	const uniqueLines = [...new Set(lines)];
	if (!logLike) {
		return uniqueLines.join("\n");
	}

	const progressLines = uniqueLines.filter((line) =>
		PROGRESS_TEXT_PATTERN.test(line),
	);
	if (progressLines.length === 0) {
		return "<log-output>";
	}
	return [...new Set(progressLines)].join("\n");
}

function normalizeToolOutcome(value: unknown, parentKey?: string): unknown {
	if (typeof value === "string") {
		const compactParentKey =
			parentKey === undefined ? undefined : compactOutputKey(parentKey);
		return normalizeOutputText(
			value,
			compactParentKey !== undefined && LOG_OUTPUT_KEYS.has(compactParentKey),
		);
	}
	if (value == null || typeof value !== "object") {
		return value;
	}
	if (Array.isArray(value)) {
		const normalizedEntries = value.map((entry) =>
			normalizeToolOutcome(entry, parentKey),
		);
		const compactParentKey =
			parentKey === undefined ? undefined : compactOutputKey(parentKey);
		if (
			compactParentKey !== undefined &&
			LOG_OUTPUT_KEYS.has(compactParentKey)
		) {
			return [
				...new Set(
					normalizedEntries.map((entry) => JSON.stringify(entry) ?? "null"),
				),
			].sort();
		}
		return normalizedEntries;
	}

	const normalized: Record<string, unknown> = {};
	for (const key of Object.keys(value as Record<string, unknown>).sort()) {
		const compactKey = compactOutputKey(key);
		if (VOLATILE_OUTPUT_KEYS.has(compactKey)) {
			continue;
		}
		normalized[key] = normalizeToolOutcome(
			(value as Record<string, unknown>)[key],
			key,
		);
	}
	return normalized;
}

interface ToolOutcomeFingerprint {
	signature: string;
}

function toolOutcomeFingerprint(output: unknown): ToolOutcomeFingerprint {
	try {
		const normalized = normalizeToolOutcome(output);
		return {
			signature: JSON.stringify(normalized) ?? "undefined",
		};
	} catch {
		const normalized = normalizeOutputText(String(output), false);
		return {
			signature: normalized,
		};
	}
}

interface InspectedCall {
	batchId: number;
	generation: number;
	toolName: string;
	toolSignature: string;
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
	private currentSequence:
		| {
				generation: number;
				toolName: string;
				toolSignature: string;
				totalBatchCount: number;
		  }
		| undefined;
	private nextGeneration = 1;
	private nextBatchId = 1;
	private readonly pendingCalls = new Map<string, InspectedCall>();
	private anonymousPendingCall: InspectedCall | undefined;
	private readonly batchOutcomes = new Map<number, ToolOutcomeFingerprint[]>();
	private lastSuccessfulOutcome:
		| {
				generation: number;
				outputSignature: string;
		  }
		| undefined;

	constructor(config?: Partial<LoopDetectionConfig>) {
		this.config = {
			softThreshold: config?.softThreshold ?? DEFAULT_CONFIG.softThreshold,
			hardThreshold: config?.hardThreshold ?? DEFAULT_CONFIG.hardThreshold,
		};
	}

	inspect(call: LoopDetectionCall): LoopDetectionVerdict {
		const signature = toolCallSignature(call.input);
		let sequence = this.currentSequence;
		let startedNewSequence = false;
		if (
			sequence === undefined ||
			sequence.toolName !== call.name ||
			sequence.toolSignature !== signature
		) {
			sequence = {
				generation: this.nextGeneration++,
				toolName: call.name,
				toolSignature: signature,
				totalBatchCount: 0,
			};
			this.currentSequence = sequence;
			startedNewSequence = true;
			this.anonymousPendingCall = undefined;
		}

		const parallelCall =
			call.id === undefined
				? undefined
				: [...this.pendingCalls.values()].find(
						(pending) =>
							pending.toolName === call.name &&
							pending.toolSignature === signature,
					);
		const inspected: InspectedCall = {
			batchId: parallelCall?.batchId ?? this.nextBatchId++,
			generation: sequence.generation,
			toolName: call.name,
			toolSignature: signature,
		};
		if (call.id !== undefined) {
			this.pendingCalls.set(call.id, inspected);
		} else {
			this.anonymousPendingCall = inspected;
		}
		const absoluteHardLimit = this.config.hardThreshold * MAX_PROGRESS_WINDOWS;
		const pendingBatchCallCount =
			[...this.pendingCalls.values()].filter(
				(pending) => pending.batchId === inspected.batchId,
			).length +
			(this.anonymousPendingCall?.batchId === inspected.batchId ? 1 : 0);
		if (parallelCall !== undefined && !startedNewSequence) {
			if (pendingBatchCallCount >= absoluteHardLimit) {
				return {
					kind: "hard",
					message: `Detected ${pendingBatchCallCount} identical calls to \`${call.name}\` still pending in one batch; stopping because earlier calls did not complete.`,
				};
			}
			return { kind: "ok" };
		}

		sequence.totalBatchCount++;
		const result = checkRepeatedToolCall(
			this.state,
			call.name,
			signature,
			this.config,
		);
		if (
			result.hardEscalation ||
			sequence.totalBatchCount >= absoluteHardLimit ||
			pendingBatchCallCount >= absoluteHardLimit
		) {
			return {
				kind: "hard",
				message:
					pendingBatchCallCount >= absoluteHardLimit
						? `Detected ${pendingBatchCallCount} identical calls to \`${call.name}\` still pending in one batch; stopping because earlier calls did not complete.`
						: sequence.totalBatchCount >= absoluteHardLimit
							? `Detected ${sequence.totalBatchCount} repeated batches of identical calls to \`${call.name}\` despite changing results; stopping to avoid a loop.`
							: `Detected ${this.state.consecutiveIdenticalCount} consecutive identical calls to \`${call.name}\`; stopping to avoid a loop.`,
			};
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
	 * Complete an inspected call. Parallel calls in the same batch can span a
	 * temporarily interleaved tool sequence, so every still-relevant outcome can
	 * contribute progress regardless of finish order. Failed outcomes only close
	 * their pending call and never reset loop detection.
	 */
	observeOutcome(
		call: LoopDetectionCall,
		outcome: { successful: boolean; output?: unknown },
	): void {
		const toolSignature = toolCallSignature(call.input);
		const inspected =
			call.id === undefined
				? this.anonymousPendingCall
				: this.pendingCalls.get(call.id);
		if (call.id !== undefined) {
			this.pendingCalls.delete(call.id);
		} else {
			this.anonymousPendingCall = undefined;
		}
		const isCurrentCall =
			inspected !== undefined &&
			this.currentSequence?.toolName === call.name &&
			this.currentSequence.toolSignature === toolSignature &&
			inspected.toolName === call.name &&
			inspected.toolSignature === toolSignature;
		if (!isCurrentCall) {
			if (
				inspected !== undefined &&
				![...this.pendingCalls.values()].some(
					(pending) => pending.batchId === inspected.batchId,
				) &&
				this.anonymousPendingCall?.batchId !== inspected.batchId
			) {
				this.batchOutcomes.delete(inspected.batchId);
			}
			return;
		}

		if (outcome.successful) {
			const outcomes = this.batchOutcomes.get(inspected.batchId) ?? [];
			outcomes.push(toolOutcomeFingerprint(outcome.output));
			this.batchOutcomes.set(inspected.batchId, outcomes);
		}
		const hasPendingBatchCall =
			[...this.pendingCalls.values()].some(
				(pending) => pending.batchId === inspected.batchId,
			) || this.anonymousPendingCall?.batchId === inspected.batchId;
		if (hasPendingBatchCall) {
			return;
		}

		const outcomes = this.batchOutcomes.get(inspected.batchId) ?? [];
		this.batchOutcomes.delete(inspected.batchId);
		if (outcomes.length === 0) {
			return;
		}
		const outputSignature = JSON.stringify(
			[...new Set(outcomes.map((entry) => entry.signature))].sort(),
		);
		const previous = this.lastSuccessfulOutcome;
		const currentGeneration = this.currentSequence?.generation;

		if (
			previous !== undefined &&
			previous.generation === currentGeneration &&
			previous.outputSignature !== outputSignature
		) {
			resetLoopDetectionState(this.state);
		}

		this.lastSuccessfulOutcome = {
			generation: currentGeneration ?? inspected.generation,
			outputSignature,
		};
	}

	reset(): void {
		resetLoopDetectionState(this.state);
		this.currentSequence = undefined;
		this.nextBatchId = 1;
		this.pendingCalls.clear();
		this.anonymousPendingCall = undefined;
		this.batchOutcomes.clear();
		this.lastSuccessfulOutcome = undefined;
	}
}
