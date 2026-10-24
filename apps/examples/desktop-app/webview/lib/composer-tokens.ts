import { useSyncExternalStore } from "react";

export type TokenRange = { start: number; end: number };

const MENTION_TRAILING_PUNCTUATION = new Set("),.:;!?`'\"");

/**
 * Drops trailing punctuation like the runtime's mention parser. A backwards
 * scan rather than an anchored regex, which backtracks quadratically on long
 * punctuation runs.
 */
export function stripMentionTrailingPunctuation(token: string): string {
	let end = token.length;
	while (end > 0 && MENTION_TRAILING_PUNCTUATION.has(token.charAt(end - 1))) {
		end -= 1;
	}
	return token.slice(0, end);
}

/** Collapses `./`, `..` and backslashes so `@./src/a.ts` compares as `src/a.ts`. */
export function normalizeMentionPath(path: string): string {
	const segments: string[] = [];
	for (const segment of path.replace(/\\/g, "/").split("/")) {
		if (segment === "" || segment === ".") continue;
		if (segment === ".." && segments.length > 0 && segments.at(-1) !== "..") {
			segments.pop();
		} else {
			segments.push(segment);
		}
	}
	return `${path.startsWith("/") ? "/" : ""}${segments.join("/")}`;
}

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
		const path = stripMentionTrailingPunctuation(match[2]);
		if (!path || !isKnownMentionPath(normalizeMentionPath(path))) continue;
		const start = match.index + match[1].length;
		highlights.push({ start, end: start + 1 + path.length });
	}
	return highlights;
}

type KnownComposerTokens = {
	/** Lower-cased slash command names. */
	commandNames: ReadonlySet<string>;
	/** Workspace-relative paths seen in mention search results, normalized. */
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
	const normalized = paths.map(normalizeMentionPath);
	if (normalized.every((path) => known.mentionPaths.has(path))) return;
	update({
		...known,
		mentionPaths: new Set([...known.mentionPaths, ...normalized]),
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
