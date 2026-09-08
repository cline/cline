/**
 * Browser-safe slash-command helpers shared by every chat surface (VS Code /
 * JetBrains webview, CLI TUI, desktop webview, hub dashboard).
 *
 * Core mints the command tokens (see `normalizeRuntimeCommandName` in
 * `@cline/core`'s runtime-commands): a surface never renames a command, it only
 * detects where the user is typing one, merges the lists it knows about into
 * one catalog, and filters that catalog by the typed prefix. Keeping those
 * three steps here means a skill or workflow shows up — and is spelled the same
 * way — on every surface the moment core knows about it.
 */

export type SlashCommandKind =
	| "builtin"
	| "skill"
	| "workflow"
	| "mcp-prompt"
	| "plugin";

/**
 * The shape a surface's slash-command catalog entry should carry. Surfaces
 * may extend it with presentation fields (section, cliCompatible, ...); the
 * helpers below are generic over anything with a `name`.
 */
export interface SlashCommandCatalogEntry {
	/** Command token without the leading slash, exactly as the surface should insert it. */
	name: string;
	description?: string;
	kind: SlashCommandKind;
	/** Stable identifier from the source (runtime command id, MCP server + prompt), when known. */
	id?: string;
}

/**
 * Character class of a slash-command token (the part after `/`).
 *
 * A superset of every surface's historical alphabet and of the tokens core's
 * normalizer produces: Unicode letters and digits (so `/发布` works), `_ . -`,
 * and `: @` for MCP prompt commands (`/mcp:server:prompt`). Requires the `u`
 * regex flag.
 */
export const SLASH_COMMAND_TOKEN_CHARS = String.raw`[\p{L}\p{N}_.:@-]`;

/**
 * Regex source matching a slash-command token that is at the start of the
 * text or preceded by whitespace, and followed by whitespace or end-of-text.
 * The `/` must be preceded by whitespace so URL paths (`http://x.com/foo`) and
 * file paths never read as commands.
 *
 * Capture groups: `[1]` the leading whitespace (or empty), `[2]` the token
 * including its slash.
 */
export const SLASH_COMMAND_TOKEN_PATTERN = String.raw`(^|\s)(\/${SLASH_COMMAND_TOKEN_CHARS}+)(?=\s|$)`;

/**
 * Build a fresh regex for {@link SLASH_COMMAND_TOKEN_PATTERN}. Always returns
 * a new instance so callers using the `g` flag never share `lastIndex` state.
 * The `u` flag is added when missing because the token class uses `\p{…}`.
 */
export function createSlashCommandTokenRegex(flags = ""): RegExp {
	return new RegExp(
		SLASH_COMMAND_TOKEN_PATTERN,
		flags.includes("u") ? flags : `${flags}u`,
	);
}

/** Matches a completed slash command (token followed by whitespace) anywhere in the text. */
const COMPLETED_SLASH_COMMAND_REGEX = new RegExp(
	String.raw`(^|\s)\/${SLASH_COMMAND_TOKEN_CHARS}+\s`,
	"u",
);

export interface SlashQuery {
	/** Index of the `/` that opens the command being typed. */
	slashIndex: number;
	/** Text typed after the slash, up to the cursor. */
	query: string;
}

/**
 * Detect whether the cursor sits inside a slash command the user is still
 * typing, and if so which prefix they have typed.
 *
 * Rules, shared by every surface's autocomplete:
 * - the nearest `/` before the cursor must be at the start of the text or
 *   preceded by whitespace (so paths and URLs never open the menu);
 * - there must be no whitespace between that `/` and the cursor (the command
 *   is still being typed);
 * - no completed slash command may appear earlier in the text — only the first
 *   command in a message is processed, so later ones get no suggestions.
 *
 * Returns `null` when the cursor is not inside a slash command.
 */
export function detectSlashQuery(
	text: string,
	cursor: number = text.length,
): SlashQuery | null {
	const beforeCursor = text.slice(0, cursor);
	const slashIndex = beforeCursor.lastIndexOf("/");
	if (slashIndex === -1) {
		return null;
	}
	if (slashIndex > 0 && !/\s/u.test(beforeCursor[slashIndex - 1] ?? "")) {
		return null;
	}
	const query = beforeCursor.slice(slashIndex + 1);
	if (/\s/u.test(query)) {
		return null;
	}
	if (COMPLETED_SLASH_COMMAND_REGEX.test(text.slice(0, slashIndex))) {
		return null;
	}
	return { slashIndex, query };
}

/**
 * Comparison key for a command token: trimmed, leading slashes removed,
 * lower-cased. Deliberately light — the token itself is never rewritten here,
 * since core owns the spelling users type.
 */
export function slashCommandKey(name: string): string {
	return name.trim().replace(/^\/+/u, "").toLowerCase();
}

/**
 * Merge several command lists into one catalog.
 *
 * Lists are given in precedence order: when two entries share a
 * {@link slashCommandKey}, the entry from the earlier list wins and later ones
 * are dropped, so a surface's builtins can never be shadowed by a user
 * command and a skill can never be shadowed by an MCP prompt. Entries with an
 * empty name are dropped; descriptions have their whitespace collapsed. Order
 * within a list is preserved.
 */
export function buildSlashCommandCatalog<
	T extends { name: string; description?: string },
>(lists: ReadonlyArray<ReadonlyArray<T>>): T[] {
	const byKey = new Map<string, T>();
	for (const list of lists) {
		for (const entry of list) {
			const key = slashCommandKey(entry.name);
			if (!key || byKey.has(key)) {
				continue;
			}
			const description = entry.description?.replace(/\s+/gu, " ").trim();
			byKey.set(
				key,
				description === entry.description
					? entry
					: { ...entry, description: description || undefined },
			);
		}
	}
	return [...byKey.values()];
}

/**
 * Filter a catalog to the entries whose token starts with the typed query
 * (case-insensitive). An empty query returns the whole catalog.
 */
export function matchSlashCommands<T extends { name: string }>(
	catalog: ReadonlyArray<T>,
	query: string,
): T[] {
	const prefix = slashCommandKey(query);
	if (!prefix) {
		return [...catalog];
	}
	return catalog.filter((entry) =>
		slashCommandKey(entry.name).startsWith(prefix),
	);
}

/** Find the catalog entry whose token equals the typed name (case-insensitive). */
export function findSlashCommand<T extends { name: string }>(
	catalog: ReadonlyArray<T>,
	typedName: string,
): T | undefined {
	const key = slashCommandKey(typedName);
	if (!key) {
		return undefined;
	}
	return catalog.find((entry) => slashCommandKey(entry.name) === key);
}

export type SlashCommandValidation = "full" | "partial" | null;

/**
 * Classify typed text against a catalog: `"full"` when it names a command
 * exactly, `"partial"` when it is a prefix of at least one command, `null`
 * otherwise. Surfaces use this to highlight a typed command as recognized.
 */
export function validateSlashCommandInput<T extends { name: string }>(
	catalog: ReadonlyArray<T>,
	typedName: string,
): SlashCommandValidation {
	if (!slashCommandKey(typedName)) {
		return null;
	}
	if (findSlashCommand(catalog, typedName)) {
		return "full";
	}
	return matchSlashCommands(catalog, typedName).length > 0 ? "partial" : null;
}
