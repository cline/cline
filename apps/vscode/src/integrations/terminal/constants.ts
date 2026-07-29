/**
 * Terminal Constants
 *
 * Central location for all terminal-related constants.
 * This makes it easy to understand and tune terminal behavior.
 */

// =============================================================================
// Process "Hot" State Timeouts
// =============================================================================
// How long to wait after output before considering the process "cool"
// This stalls API requests to let terminal output settle

/** Normal timeout after last output (2 seconds) */
export const PROCESS_HOT_TIMEOUT_NORMAL = 2_000

/** Extended timeout for compilation/build commands (15 seconds) */
export const PROCESS_HOT_TIMEOUT_COMPILING = 15_000

// =============================================================================
// Markerless Shell Integration Fallback
// =============================================================================
// When shell integration is attached but not emitting OSC 633 markers (e.g.
// the user ssh'd from the terminal so commands run in a remote shell), the
// execution's read() stream never ends. These bound how long we wait before
// falling back to prompt-heuristic completion. Once the CommandExecuted (C)
// marker is seen, shell integration is trusted and these do not apply.

/** How long to wait for the first data before checking for markerless completion (10 seconds) */
export const MARKERLESS_FIRST_DATA_TIMEOUT = 10_000

/** Idle gap between data chunks that triggers a prompt-heuristic check (3 seconds) */
export const MARKERLESS_IDLE_TIMEOUT = 3_000

/** Quiet time after which a markerless command is considered done even without a prompt (30 seconds) */
export const MARKERLESS_MAX_QUIET_TIME = 30_000

// =============================================================================
// Exit Code Event Race
// =============================================================================
// onDidEndTerminalShellExecution fires asynchronously after the read() stream
// completes (VS Code calls flush().then(() => fire(endEvent))). We await it
// with a bounded race so a command whose shell integration never reports
// completion (e.g. no OSC 633 markers at all) doesn't hang indefinitely.

/** How long to wait for onDidEndTerminalShellExecution after the stream ends (3 seconds) */
export const EXIT_CODE_EVENT_TIMEOUT_MS = 3_000

// =============================================================================
// Large Output Protection
// =============================================================================
// Prevents memory exhaustion and context window overflow

/** Maximum size for fullOutput storage (memory protection) */
export const MAX_FULL_OUTPUT_SIZE = 1024 * 1024 // 1MB

/** Maximum lines to return from getUnretrievedOutput */
export const MAX_UNRETRIEVED_LINES = 500

/** Lines to keep at start/end when truncating unretrieved output */
export const TRUNCATE_KEEP_LINES = 100

// =============================================================================
// Compilation Detection Markers
// =============================================================================
// Used to detect if a command is compiling/building

/** Markers that indicate compilation is starting */
const COMPILING_MARKERS = ["compiling", "building", "bundling", "transpiling", "generating", "starting"]

/** Markers that indicate compilation is done (nullify extended timeout) */
const COMPILING_NULLIFIERS = [
	"compiled",
	"success",
	"finish",
	"complete",
	"succeed",
	"done",
	"end",
	"stop",
	"exit",
	"terminate",
	"error",
	"fail",
]

/**
 * Check if terminal output indicates compilation/building.
 * Matches markers anywhere in the output.
 */
export function isCompilingOutput(data: string): boolean {
	const lowerData = data.toLowerCase()
	const hasMarker = COMPILING_MARKERS.some((marker) => lowerData.includes(marker.toLowerCase()))
	const hasNullifier = COMPILING_NULLIFIERS.some((nullifier) => lowerData.includes(nullifier.toLowerCase()))
	return hasMarker && !hasNullifier
}
