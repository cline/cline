/**
 * Repeated tool-call loop detection.
 *
 * @see PLAN.md §3.1 — helpers moved from `packages/agents/src/context/loop-detection.ts`.
 * @see PLAN.md §3.2.3 — public surface of `LoopDetectionTracker`.
 *
 * The pure helpers (`createLoopDetectionState`, `resetLoopDetectionState`,
 * `toolCallSignature`, `checkRepeatedToolCall`) are ported verbatim. The
 * `LoopDetectionTracker` class is a thin wrapper that owns a
 * `LoopDetectionState` and exposes the `inspect()` / `reset()` surface that
 * `SessionRuntime` installs as a `beforeTool` hook per §3.2.3.
 */

import type { LoopDetectionConfig } from "@cline/shared";

// =============================================================================
// Pure helpers (verbatim port)
// =============================================================================

/**
 * Rolling-window defaults for interleaved-loop detection. Once the window is
 * full, few *distinct* calls means the agent is cycling through a tiny set of
 * actions. Diversity (not raw repeat count) is the signal, so a productive
 * edit / test loop — whose edits vary each turn — never trips it.
 */
const DEFAULT_WINDOW_SIZE = 12;
const DEFAULT_WINDOW_SOFT_DISTINCT = 3;
const DEFAULT_WINDOW_HARD_DISTINCT = 2;

export interface LoopDetectionState {
	lastToolName: string;
	lastToolSignature: string;
	consecutiveIdenticalCount: number;
	/** Recent `toolName + signature` keys, most-recent last, capped at windowSize. */
	recentKeys: string[];
}

export function createLoopDetectionState(): LoopDetectionState {
	return {
		lastToolName: "",
		lastToolSignature: "",
		consecutiveIdenticalCount: 0,
		recentKeys: [],
	};
}

export function resetLoopDetectionState(state: LoopDetectionState): void {
	state.lastToolName = "";
	state.lastToolSignature = "";
	state.consecutiveIdenticalCount = 0;
	state.recentKeys = [];
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
	/** Length of the current run of strictly-consecutive identical calls. */
	consecutiveCount: number;
	/**
	 * Distinct calls in the current rolling window once it is full; Infinity
	 * until then (so the windowed check stays dormant while the window fills).
	 */
	windowDistinct: number;
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

	// Windowed repeat detection catches loops that interleave a small set of
	// identical calls (e.g. write-file / delete-file / write-file …), which the
	// consecutive counter above never sees because each call differs from the one
	// immediately before it. Identity is name + arguments, so a productive
	// edit / test cycle (whose edit arguments differ each turn) is not flagged.
	const windowSize = config.windowSize ?? DEFAULT_WINDOW_SIZE;
	const windowSoftDistinct =
		config.windowSoftDistinct ?? DEFAULT_WINDOW_SOFT_DISTINCT;
	const windowHardDistinct =
		config.windowHardDistinct ?? DEFAULT_WINDOW_HARD_DISTINCT;
	const key = `${toolName}\u0000${signature}`;
	state.recentKeys.push(key);
	if (state.recentKeys.length > windowSize) {
		state.recentKeys.shift();
	}
	// Only judge diversity on a full window; a distinct count that low over a
	// partial window would flag the opening of any run.
	const windowDistinct =
		state.recentKeys.length >= windowSize
			? new Set(state.recentKeys).size
			: Number.POSITIVE_INFINITY;

	const consecutiveCount = state.consecutiveIdenticalCount;
	return {
		consecutiveCount,
		windowDistinct,
		softWarning:
			consecutiveCount === config.softThreshold ||
			windowDistinct <= windowSoftDistinct,
		hardEscalation:
			consecutiveCount >= config.hardThreshold ||
			windowDistinct <= windowHardDistinct,
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
	name: string;
	input: unknown;
}

const DEFAULT_CONFIG: LoopDetectionConfig = {
	softThreshold: 3,
	hardThreshold: 5,
	windowSize: DEFAULT_WINDOW_SIZE,
	windowSoftDistinct: DEFAULT_WINDOW_SOFT_DISTINCT,
	windowHardDistinct: DEFAULT_WINDOW_HARD_DISTINCT,
};

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

	constructor(config?: Partial<LoopDetectionConfig>) {
		this.config = {
			softThreshold: config?.softThreshold ?? DEFAULT_CONFIG.softThreshold,
			hardThreshold: config?.hardThreshold ?? DEFAULT_CONFIG.hardThreshold,
			windowSize: config?.windowSize ?? DEFAULT_CONFIG.windowSize,
			windowSoftDistinct:
				config?.windowSoftDistinct ?? DEFAULT_CONFIG.windowSoftDistinct,
			windowHardDistinct:
				config?.windowHardDistinct ?? DEFAULT_CONFIG.windowHardDistinct,
		};
	}

	inspect(call: LoopDetectionCall): LoopDetectionVerdict {
		const signature = toolCallSignature(call.input);
		const result = checkRepeatedToolCall(
			this.state,
			call.name,
			signature,
			this.config,
		);
		if (result.hardEscalation) {
			return {
				kind: "hard",
				message:
					result.consecutiveCount >= this.config.hardThreshold
						? `Detected ${result.consecutiveCount} consecutive identical calls to \`${call.name}\`; stopping to avoid a loop.`
						: `Detected a repeating tool-call loop cycling through only ${result.windowDistinct} distinct actions; stopping to avoid a loop.`,
			};
		}
		if (result.softWarning) {
			return {
				kind: "soft",
				message:
					result.consecutiveCount === this.config.softThreshold
						? `Detected ${result.consecutiveCount} consecutive identical calls to \`${call.name}\`; consider trying a different approach.`
						: `Detected a repeating tool-call loop cycling through only ${result.windowDistinct} distinct actions; consider trying a different approach.`,
			};
		}
		return { kind: "ok" };
	}

	reset(): void {
		resetLoopDetectionState(this.state);
	}
}
