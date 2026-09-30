export const INPUT_HISTORY_STORAGE_KEY = "cline.code.user-input-history.v1";

// Same cap as the CLI's terminal history
// (apps/cli/src/utils/input-history.ts).
export const MAX_INPUT_HISTORY_ENTRIES = 20;

export function parseInputHistoryStorage(raw: string | null): string[] {
	if (!raw) {
		return [];
	}
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) {
			return [];
		}
		const entries: string[] = [];
		for (const item of parsed) {
			if (typeof item === "string" && item.trim()) {
				entries.push(item);
			}
		}
		// The Set keeps the first occurrence, and stored entries are
		// newest-first, so a duplicate keeps its newest position.
		return [...new Set(entries)].slice(0, MAX_INPUT_HISTORY_ENTRIES);
	} catch {
		return [];
	}
}

export function prependInputHistoryEntry(
	history: readonly string[],
	prompt: string,
	maxEntries = MAX_INPUT_HISTORY_ENTRIES,
): string[] {
	const trimmed = prompt.trim();
	if (!trimmed) {
		return [...history];
	}
	return [trimmed, ...history.filter((entry) => entry !== trimmed)].slice(
		0,
		maxEntries,
	);
}

export function readInputHistoryFromWindow(): string[] {
	if (typeof window === "undefined") {
		return [];
	}
	try {
		return parseInputHistoryStorage(
			window.localStorage.getItem(INPUT_HISTORY_STORAGE_KEY),
		);
	} catch {
		// Ignore localStorage availability failures; an empty history degrades
		// recall to session-only, and the send path must not abort on it.
		return [];
	}
}

export function writeInputHistoryToWindow(history: readonly string[]): void {
	if (typeof window === "undefined") {
		return;
	}
	try {
		window.localStorage.setItem(
			INPUT_HISTORY_STORAGE_KEY,
			JSON.stringify(history.slice(0, MAX_INPUT_HISTORY_ENTRIES)),
		);
	} catch {
		// Ignore localStorage persistence failures.
	}
}
