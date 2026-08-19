import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveClineDataDir } from "@cline/shared/storage";

const MAX_HISTORY = 20;

function resolveHistoryPath(): string {
	return join(resolveClineDataDir(), "cache", "user_input_history.jsonl");
}

function readEntries(path: string): string[] {
	if (!existsSync(path)) return [];
	try {
		const entries: string[] = [];
		for (const line of readFileSync(path, "utf8").split("\n")) {
			if (!line.trim()) continue;
			try {
				const parsed = JSON.parse(line) as { prompt?: unknown };
				if (typeof parsed.prompt === "string" && parsed.prompt.trim()) {
					entries.push(parsed.prompt);
				}
			} catch {
				// skip malformed lines
			}
		}
		return entries;
	} catch {
		return [];
	}
}

/** Returns up to MAX_HISTORY entries, most-recent-first, for up-arrow navigation. */
export function loadInputHistory(): string[] {
	return readEntries(resolveHistoryPath()).slice(-MAX_HISTORY).reverse();
}

export function prependInputHistoryEntry(
	history: readonly string[],
	prompt: string,
	maxHistory = MAX_HISTORY,
): string[] {
	const trimmed = prompt.trim();
	if (!trimmed) return [...history];
	return [trimmed, ...history.filter((p) => p !== trimmed)].slice(
		0,
		maxHistory,
	);
}

/**
 * Appends a prompt to the history file, removing any previous occurrence of
 * the same prompt so the list stays unique, then trims to MAX_HISTORY.
 */
export function appendInputHistory(prompt: string): void {
	const trimmed = prompt.trim();
	if (!trimmed) return;
	const path = resolveHistoryPath();
	try {
		mkdirSync(dirname(path), { recursive: true });
		const next = prependInputHistoryEntry(
			readEntries(path).reverse(),
			trimmed,
		).reverse();
		writeFileSync(
			path,
			`${next.map((p) => JSON.stringify({ prompt: p, ts: Date.now() })).join("\n")}\n`,
			"utf8",
		);
	} catch {
		// Non-fatal, best effort.
	}
}
