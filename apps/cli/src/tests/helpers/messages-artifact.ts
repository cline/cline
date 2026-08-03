// ---------------------------------------------------------------------------
// Helpers for reading persisted session messages artifacts (`.messages.json`).
//
// The artifact is JSONL since V18: a `{"header": ...}` row followed by one
// `{"message": ...}` row per message. Older files (and the compaction mirror)
// are legacy pretty-printed JSON `{ messages: [...] }`. `readMessagesArtifact`
// auto-detects both formats.
// ---------------------------------------------------------------------------

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MESSAGES_JSONL_HEADER_KEY = "header";

export function findMessagesArtifacts(root: string): string[] {
	if (!existsSync(root)) return [];
	const out: string[] = [];
	const stack = [root];
	while (stack.length > 0) {
		const next = stack.pop();
		if (!next) continue;
		for (const entry of readdirSync(next, { withFileTypes: true })) {
			const fullPath = join(next, entry.name);
			if (entry.isDirectory()) {
				stack.push(fullPath);
				continue;
			}
			if (entry.isFile() && entry.name.endsWith(".messages.json")) {
				out.push(fullPath);
			}
		}
	}
	return out.sort();
}

export function readMessagesArtifact(
	path: string,
): { messages?: Array<Record<string, unknown>> } {
	const raw = readFileSync(path, "utf8");

	// Legacy pretty-printed JSON: `{ version, updated_at, ..., messages: [...] }`.
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			Array.isArray((parsed as { messages?: unknown }).messages)
		) {
			return parsed as { messages?: Array<Record<string, unknown>> };
		}
	} catch {
		// Fall through to JSONL parsing.
	}

	// JSONL: header row plus one `{"message": ...}` row per message.
	const messages: Array<Record<string, unknown>> = [];
	for (const rawLine of raw.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line) continue;
		try {
			const parsed = JSON.parse(line) as Record<string, unknown>;
			if (MESSAGES_JSONL_HEADER_KEY in parsed) continue;
			const message = parsed.message;
			if (message !== undefined) {
				messages.push(message as Record<string, unknown>);
			}
		} catch {
			// skip torn/corrupt rows
		}
	}
	return { messages };
}
