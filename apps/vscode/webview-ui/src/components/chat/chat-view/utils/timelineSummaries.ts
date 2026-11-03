import { summarizeTimelineText } from "./turnTimeline"

/**
 * Persistent cache for the timeline's one-line summaries.
 *
 * A summary is pure derivation from the message text, so caching it is an optimisation — but the
 * text of an answer grows while it streams, and a later reload must show the *same* label it
 * showed before. Entries are therefore keyed by the message timestamp and validated against a
 * hash of the source text: a changed text recomputes, an unchanged one is served from storage.
 *
 * Same trade-off as the typing durations: `localStorage` is per device and per VS Code profile.
 */

const STORAGE_KEY = "ccline.timelineSummaries.v1"
const MAX_ENTRIES = 1200

interface CacheEntry {
	/** FNV-1a hash of the source text, so a stale summary can never be reused. */
	h: number
	s: string
}

type Cache = Record<string, CacheEntry>

function hashText(text: string): number {
	let hash = 0x811c9dc5
	for (let index = 0; index < text.length; index++) {
		hash ^= text.charCodeAt(index)
		hash = Math.imul(hash, 0x01000193)
	}
	return hash | 0
}

function readCache(): Cache {
	try {
		const raw = localStorage.getItem(STORAGE_KEY)
		if (!raw) {
			return {}
		}
		const parsed: unknown = JSON.parse(raw)
		return parsed && typeof parsed === "object" ? (parsed as Cache) : {}
	} catch {
		return {}
	}
}

/**
 * Returns a `summarizeTimelineText` replacement that memoises through `localStorage`.
 * Silently degrades to plain recomputation when storage is unavailable.
 */
export function createCachedSummarizer(sessionKey: number | undefined): (text: string) => string {
	const cache = sessionKey === undefined ? undefined : readCache()
	// Entries written during this call, flushed once instead of per marker.
	const pending: Cache = {}

	return (text: string) => {
		const key = cache ? `${sessionKey}:${hashText(text)}` : undefined
		if (key && cache) {
			const hit = cache[key]
			// The key already contains the hash; storing it again guards against key collisions.
			if (hit && hit.h === hashText(text)) {
				return hit.s
			}
		}

		const summary = summarizeTimelineText(text)
		if (key && cache) {
			pending[key] = { h: hashText(text), s: summary }
			try {
				const merged = { ...readCache(), ...cache, ...pending }
				const keys = Object.keys(merged)
				// Insertion order tracks recency, so the leading keys are the ones to drop.
				const kept = keys.length > MAX_ENTRIES ? keys.slice(keys.length - MAX_ENTRIES) : keys
				localStorage.setItem(
					STORAGE_KEY,
					JSON.stringify(Object.fromEntries(kept.map((entryKey) => [entryKey, merged[entryKey]]))),
				)
			} catch {
				// Quota or access error: the summary is still returned, just not remembered.
			}
		}
		return summary
	}
}
