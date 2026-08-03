// V16 §5 — pure, headless-testable terminal-pool policy.
//
// VscodeTerminalManager (extension host, mocha-only tests) delegates its pool
// sizing / busy-timeout decisions here so the rules can be unit-tested without
// a VS Code host.

/**
 * Hard cap on tracked terminals. When the pool reaches this size, the
 * least-recently-active IDLE terminals are evicted (see
 * selectTerminalsToEvict). Chosen per V15 §5 (was 50 in earlier iterations);
 * terminals with active output ("hot") are exempt so dev servers survive.
 */
export const MAX_TERMINALS = 10

/**
 * Maximum time (ms) a terminal can stay busy before its flag is auto-released.
 * Prevents terminal-starvation deadlock when a terminal's completion promise
 * is never settled (user closed the terminal, task interrupted mid-write).
 */
export const BUSY_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

export interface EvictableTerminal {
	id: number | string
	/** Epoch ms of the last activity; lower = older. */
	lastActive: number
	/** True when the terminal is still producing output (protects dev servers). */
	isHot: boolean
}

/**
 * Selects the terminals to evict once the pool size reaches `maxTerminals`.
 * Candidates are the least-recently-active terminals beyond the cap; hot
 * terminals are skipped. Returns [] when nothing is safely evictable.
 */
export function selectTerminalsToEvict(
	terminals: readonly EvictableTerminal[],
	maxTerminals: number = MAX_TERMINALS,
): EvictableTerminal[] {
	if (terminals.length < maxTerminals) {
		return []
	}
	const sorted = [...terminals].sort((a, b) => a.lastActive - b.lastActive)
	const candidates = sorted.slice(0, terminals.length - maxTerminals + 1)
	return candidates.filter((terminal) => !terminal.isHot)
}

/**
 * Decides whether a stuck terminal's busy flag should be auto-released after
 * the busy timeout. A terminal that is still producing output ("hot") keeps
 * its busy flag — it is a healthy long-running process, not a stuck one.
 */
export function shouldAutoReleaseBusy(
	busy: boolean,
	elapsedMs: number,
	isHot: boolean,
	timeoutMs: number = BUSY_TIMEOUT_MS,
): boolean {
	return busy && elapsedMs >= timeoutMs && !isHot
}
