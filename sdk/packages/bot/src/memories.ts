/**
 * File-backed memory discovery (Gateway RFC, Phase 2).
 *
 * Memories live under a bot's `memories/` directory as Markdown files.
 * The domain discovers them through a `MemorySource` port — it never
 * touches a filesystem itself.
 */

import type { MemorySource } from "./ports";

export const MEMORIES_DIR = "memories/";

export interface BotMemory {
	/** Memory name: the file path under `memories/` without the extension. */
	readonly name: string;
	/** Path relative to the bot directory, e.g. `memories/style.md`. */
	readonly path: string;
	readonly content: string;
}

export function discoverMemories(source: MemorySource): BotMemory[] {
	const memories: BotMemory[] = [];
	for (const entry of source.list()) {
		const normalized = entry.path.replaceAll("\\", "/");
		if (!normalized.startsWith(MEMORIES_DIR)) {
			continue;
		}
		if (!normalized.endsWith(".md")) {
			continue;
		}
		const relative = normalized.slice(MEMORIES_DIR.length);
		memories.push({
			name: relative.slice(0, -".md".length),
			path: normalized,
			content: entry.content,
		});
	}
	memories.sort((a, b) => a.path.localeCompare(b.path));
	return memories;
}
