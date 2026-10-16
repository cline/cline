import { useSyncExternalStore } from "react";

export type TokenRange = { start: number; end: number };

// Mirrors the sidecar's mention parsing, which drops trailing punctuation.
const MENTION_TRAILING_PUNCTUATION = /[),.:;!?`'"]+$/;

/**
 * Ranges of `input` that the sidecar acts on: a leading `/command` (it only
 * runs a command that starts the trimmed prompt) and `@path` mentions of real
 * workspace files (it only attaches mentions that resolve).
 */
export function getComposerHighlights(
	input: string,
	commandNames: ReadonlySet<string>,
	isKnownMentionPath: (path: string) => boolean,
): TokenRange[] {
	const highlights: TokenRange[] = [];
	const command = /^(\s*)\/(\S+)(?=\s|$)/.exec(input);
	if (command && commandNames.has(command[2].toLowerCase())) {
		highlights.push({ start: command[1].length, end: command[0].length });
	}
	for (const match of input.matchAll(/(^|\s)@(\S+)/g)) {
		const path = match[2].replace(MENTION_TRAILING_PUNCTUATION, "");
		if (!isKnownMentionPath(path)) continue;
		const start = match.index + match[1].length;
		highlights.push({ start, end: start + 1 + path.length });
	}
	return highlights;
}

type KnownComposerTokens = {
	/** Lower-cased slash command names. */
	commandNames: ReadonlySet<string>;
	/** Workspace-relative paths seen in mention search results. */
	mentionPaths: ReadonlySet<string>;
};

// Module-level so sent messages in the transcript can chip the same tokens the
// composer recognized, without threading them through every message.
let known: KnownComposerTokens = {
	commandNames: new Set(),
	mentionPaths: new Set(),
};
const listeners = new Set<() => void>();

function update(next: KnownComposerTokens) {
	known = next;
	for (const listener of listeners) listener();
}

export function setKnownSlashCommands(names: string[]) {
	const commandNames = new Set(names.map((name) => name.toLowerCase()));
	if (
		commandNames.size === known.commandNames.size &&
		[...commandNames].every((name) => known.commandNames.has(name))
	) {
		return;
	}
	update({ ...known, commandNames });
}

export function addKnownMentionPaths(paths: string[]) {
	if (paths.every((path) => known.mentionPaths.has(path))) return;
	update({
		...known,
		mentionPaths: new Set([...known.mentionPaths, ...paths]),
	});
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function useKnownComposerTokens(): KnownComposerTokens {
	return useSyncExternalStore(
		subscribe,
		() => known,
		() => known,
	);
}
