import { interpolate } from "./interpolate.js";
import type { MessageParams } from "./types.js";

/**
 * A minimal plural form: `{count, plural, one {…} other {…}}`.
 *
 * This intentionally implements only what the desktop UI needs (a single
 * `count` with `one`/`other` branches) and defers the plural category decision
 * to `Intl.PluralRules`, so locales with richer rules keep working when added.
 */
const PLURAL_BLOCK = /\{([a-zA-Z0-9_]+),\s*plural\s*,\s*([\s\S]*)\}\s*$/;
const BRANCH = /(zero|one|two|few|many|other)\s*\{([^{}]*)\}/g;

function selectBranch(
	forms: string,
	category: Intl.LDMLPluralRule,
): string | null {
	BRANCH.lastIndex = 0;
	let fallback: string | null = null;
	for (const match of forms.matchAll(BRANCH)) {
		const [, kind, text] = match;
		if (kind === category) {
			return text;
		}
		if (kind === "other") {
			fallback = text;
		}
	}
	return fallback;
}

/**
 * Render a plural template for `count` under `locale`.
 * Returns `null` when the template is not a plural block (caller falls back to
 * plain interpolation).
 */
export function renderPlural(
	template: string,
	locale: string,
	count: number,
	params: MessageParams | undefined,
): string | null {
	const block = PLURAL_BLOCK.exec(template.trim());
	if (!block) {
		return null;
	}
	const forms = block[2];
	const category = new Intl.PluralRules(locale).select(count);
	let branch = selectBranch(forms, category);
	if (branch === null) {
		branch = forms;
	}
	// `#` renders the formatted count; named params come from `params`.
	const rendered = branch
		.split("#")
		.join(new Intl.NumberFormat(locale).format(count));
	return interpolate(rendered, params);
}

/** Whether a template is a plural block (used by the translator to route). */
export function isPluralTemplate(template: string): boolean {
	return PLURAL_BLOCK.test(template.trim());
}
