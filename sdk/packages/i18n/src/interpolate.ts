import type { MessageParams } from "./types.js";

const PLACEHOLDER = /\{([a-zA-Z0-9_]+)\}/g;

/**
 * Extract the set of `{name}` placeholders referenced by a template. Plural
 * markers (`{count, plural, ...}`) are handled separately by `plural.ts`; this
 * helper only reports simple `{name}` placeholders and is used by the catalog
 * checker to verify every locale interpolates the same variables.
 */
export function extractPlaceholders(template: string): string[] {
	const names = new Set<string>();
	// Strip plural blocks first so their inner `#` and branch text don't leak in.
	const stripped = template.replace(/\{[a-zA-Z0-9_]+,\s*plural\s*,/g, "{");
	for (const match of stripped.matchAll(PLACEHOLDER)) {
		names.add(match[1]);
	}
	return [...names];
}

/**
 * Interpolate `{name}` placeholders in a template.
 *
 * - Unknown params are left as-is (rendered literally) so a missing backend
 *   field degrades to readable text instead of crashing the view.
 * - `{{` and `}}` are literal braces.
 * - Values are inserted verbatim; callers must not embed HTML.
 */
export function interpolate(
	template: string,
	params: MessageParams | undefined,
): string {
	if (!params) {
		return template.replace(PLACEHOLDER, (raw) => raw);
	}
	return template.replace(PLACEHOLDER, (raw, name: string) => {
		if (Object.hasOwn(params, name)) {
			return String(params[name]);
		}
		return raw;
	});
}
