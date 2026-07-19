/**
 * # Refactoring Feature Flags
 *
 * Kill switches for the v5/v6 refactoring changes. Each flag controls a specific
 * high-risk architectural change. All default to **disabled** (safe).
 *
 * ## Adding a new flag
 * 1. Add the key to the `RefactoringFlag` interface below
 * 2. Add a default value to `DEFAULT_REFACTORING_FLAGS`
 * 3. Reference via `isRefactoringEnabled("flagName")` in the guarded code path
 *
 * ## Gradual rollout
 * Flags can be enabled via environment variable `CLINE_REFACTORING_FLAGS`:
 * ```
 * CLINE_REFACTORING_FLAGS="deltaStatePush=true,jsonlStorage=true" code .
 * ```
 * Or programmatically via `setRefactoringFlag()` for A/B testing.
 */

// ─── Flag Definitions ───────────────────────────────────────────────────────

export interface RefactoringFlags {
	/**
	 * Enable incremental state delta push to webview.
	 * When disabled, always sends full state snapshots (legacy behavior).
	 * Risk: State tearing if the webview misses a delta.
	 */
	deltaStatePush: boolean

	/**
	 * Enable JSONL-backed incremental storage in ClineFileStorage.
	 * When disabled, writes the full JSON file on every `_set()` (legacy).
	 * Risk: Corrupted JSONL on crash during append (mitigated by compact before crash).
	 */
	jsonlStorage: boolean

	/**
	 * Enable SSE heartbeat monitoring for streamable HTTP connections.
	 * When disabled, relies solely on ReconnectingEventSource's error detection.
	 * Risk: False positives on slow networks causing unnecessary reconnects.
	 */
	sseHeartbeat: boolean

	/**
	 * Enable terminal busy timeout (auto-release busy flag after 5 min).
	 * When disabled, busy terminals must be freed explicitly (legacy behavior).
	 * Risk: False timeout on long-running commands that exceed 5 min with no output.
	 */
	terminalBusyTimeout: boolean

	/**
	 * Enable message truncation for the initial state push.
	 * When enabled, only the first N messages are sent in `getStateToPostToWebview()`,
	 * reducing initial payload size for long conversations. The full message set is
	 * still available through the webview's lazy-load protocol.
	 * Risk: Initial render may show incomplete conversation if lazy-load fails.
	 */
	messageTruncation: boolean
}

const DEFAULT_REFACTORING_FLAGS: RefactoringFlags = {
	deltaStatePush: false,
	jsonlStorage: false,
	sseHeartbeat: false,
	terminalBusyTimeout: false,
	messageTruncation: false,
}

// ─── Runtime State ──────────────────────────────────────────────────────────

let currentFlags: RefactoringFlags = { ...DEFAULT_REFACTORING_FLAGS }

// Parse environment variable on module load
const envFlags = parseEnvFlags(process.env.CLINE_REFACTORING_FLAGS)
if (envFlags) {
	currentFlags = { ...currentFlags, ...envFlags }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Check if a specific refactoring feature flag is enabled.
 *
 * @example
 * ```typescript
 * import { isRefactoringEnabled } from "@/shared/services/feature-flags/refactoring-flags"
 *
 * if (isRefactoringEnabled("deltaStatePush")) {
 *   // Use delta push path
 * } else {
 *   // Use full snapshot path (legacy)
 * }
 * ```
 */
export function isRefactoringEnabled<K extends keyof RefactoringFlags>(flag: K): boolean {
	return currentFlags[flag]
}

/**
 * Enable or disable a refactoring flag at runtime.
 * Useful for tests or A/B experimentation.
 *
 * @example
 * ```typescript
 * import { setRefactoringFlag } from "@/shared/services/feature-flags/refactoring-flags"
 *
 * setRefactoringFlag("deltaStatePush", true)
 * ```
 */
export function setRefactoringFlag<K extends keyof RefactoringFlags>(flag: K, value: boolean): void {
	currentFlags[flag] = value
}

/**
 * Get all current refactoring flag values (for diagnostics/inspection).
 */
export function getAllRefactoringFlags(): RefactoringFlags {
	return { ...currentFlags }
}

/**
 * Reset all flags to their defaults (useful in tests).
 */
export function resetRefactoringFlags(): void {
	currentFlags = { ...DEFAULT_REFACTORING_FLAGS }
	const envFlags = parseEnvFlags(process.env.CLINE_REFACTORING_FLAGS)
	if (envFlags) {
		currentFlags = { ...currentFlags, ...envFlags }
	}
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

/**
 * Parse `CLINE_REFACTORING_FLAGS=deltaStatePush=true,jsonlStorage=true` env format.
 * Returns `null` if env var is not set.
 */
function parseEnvFlags(envValue: string | undefined): Partial<RefactoringFlags> | null {
	if (!envValue || !envValue.trim()) return null

	const flags: Partial<RefactoringFlags> = {}
	const pairs = envValue
		.split(",")
		.map((p) => p.trim())
		.filter(Boolean)

	for (const pair of pairs) {
		const eqIdx = pair.indexOf("=")
		if (eqIdx === -1) continue

		const key = pair.slice(0, eqIdx).trim() as keyof RefactoringFlags
		const value = pair.slice(eqIdx + 1).trim()

		if (key in DEFAULT_REFACTORING_FLAGS) {
			flags[key] = value === "true" || value === "1"
		}
	}

	return Object.keys(flags).length > 0 ? flags : null
}
