/**
 * Repeated tool call loop detection.
 *
 * Detects when the LLM calls the same tool with identical arguments
 * repeatedly, which wastes tokens without making progress.
 *
 * This is complementary to fileReadCache in ReadFileToolHandler, which
 * deduplicates file *content* on cache hits but still allows the tool
 * call to succeed and consume a turn. Loop detection catches the
 * repeated call pattern itself, regardless of which tool is involved.
 *
 * Shared between ToolExecutor (production) and tests so the
 * comparison algorithm cannot drift between the two.
 */

import type { TaskState } from "./TaskState"

// Soft threshold: inject a warning, giving the LLM one chance to self-correct.
// Hard threshold: escalate to user or fail task. Set higher to avoid false
// positives on tools that may legitimately repeat (e.g., browser_action screenshots).
export const LOOP_DETECTION_SOFT_THRESHOLD = 3
const LOOP_DETECTION_HARD_THRESHOLD = 5

// Params that are metadata/tracking, not tool-relevant input.
// These change between calls even when the user-facing arguments are identical
// (e.g., task_progress updates its checklist each turn).
const IGNORED_PARAMS = new Set(["task_progress"])

/**
 * Compute a canonical signature for a tool call's params.
 * Strips metadata fields and sorts keys via the JSON.stringify replacer
 * so key order doesn't affect comparison.
 *
 * block.params is Partial<Record<ToolParamName, string>> — always flat,
 * string-valued, no nesting — so the replacer array is sufficient.
 */
export function toolCallSignature(params: Partial<Record<string, string>> | undefined): string {
	if (!params) return "{}"
	const keys = Object.keys(params)
		.filter((k) => !IGNORED_PARAMS.has(k))
		.sort()
	return JSON.stringify(params, keys)
}

interface LoopDetectionResult {
	softWarning: boolean
	hardEscalation: boolean
}

/**
 * Core loop detection step. Must be called BEFORE updating
 * lastToolName / lastToolParams on TaskState.
 *
 * Compares the current call against the previous state, updates the
 * counter, and returns which thresholds (if any) were crossed.
 */
export function checkRepeatedToolCall(state: TaskState, toolName: string, currentSignature: string): LoopDetectionResult {
	if (toolName === state.lastToolName && currentSignature === state.lastToolParams) {
		state.consecutiveIdenticalToolCount++
	} else {
		state.consecutiveIdenticalToolCount = 1
	}

	return {
		softWarning: state.consecutiveIdenticalToolCount === LOOP_DETECTION_SOFT_THRESHOLD,
		hardEscalation: state.consecutiveIdenticalToolCount === LOOP_DETECTION_HARD_THRESHOLD,
	}
}
