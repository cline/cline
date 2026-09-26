import en from "./strings/en";
import ja from "./strings/ja";
import ko from "./strings/ko";
import vi from "./strings/vi";
import zhCN from "./strings/zh-CN";
import zhTW from "./strings/zh-TW";

/**
 * Translation lookup for the desktop interface.
 *
 * The English source text *is* the key. That is deliberate:
 *
 * - Nothing to register. A component that has not been wired yet keeps rendering
 *   its own literal, so adoption is incremental and a missing entry degrades to
 *   English instead of to a blank label or a `settings.row.title` breadcrumb.
 * - Locale files stay diffable against the UI. `git grep` for a string on screen
 *   finds both the call site and every translation of it.
 * - A reviewer can tell whether a line is correct without opening a key registry.
 *
 * Lookup is exact-match on whitespace-normalised text, then `{name}`
 * interpolation. No plural engine and no message compiler: those are worth having
 * eventually, and are not worth the runtime dependency in the first iteration.
 */

export type TranslationParams = Record<string, string | number>;

const BUILTIN_STRINGS: Record<string, Record<string, string> | undefined> = {
	en,
	ja,
	ko,
	vi,
	"zh-CN": zhCN,
	"zh-TW": zhTW,
};

/** Locale code -> its string table. Populated by the app and by tests. */
const tables = new Map<string, Record<string, string>>(
	Object.entries(BUILTIN_STRINGS).filter(
		(entry): entry is [string, Record<string, string>] =>
			entry[1] !== undefined,
	),
);

export function normalizeSource(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

export function registerStrings(
	locale: string,
	strings: Record<string, string>,
): void {
	tables.set(locale, strings);
}

export function stringsFor(locale: string): Record<string, string> | undefined {
	return tables.get(locale);
}

export function interpolate(
	template: string,
	params?: TranslationParams,
): string {
	if (!params) {
		return template;
	}
	// Unsupplied placeholders are left as written: a half-filled sentence is
	// readable, silently dropping the word is not.
	return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
		Object.hasOwn(params, name) ? String(params[name]) : whole,
	);
}

/**
 * Translate `source` into `locale`, falling back to `source` itself.
 *
 * @param source the English text as it appears in the component
 * @param params values for `{placeholder}` slots
 */
export function translateWith(
	locale: string,
	source: string,
	params?: TranslationParams,
): string {
	const table = tables.get(locale);
	if (table) {
		const hit = table[source] ?? table[normalizeSource(source)];
		if (hit) {
			return interpolate(hit, params);
		}
	}
	const english = tables.get("en");
	const fallback = english?.[source] ?? english?.[normalizeSource(source)];
	return interpolate(fallback ?? source, params);
}
