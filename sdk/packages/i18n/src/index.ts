import { makeFormatters } from "./formats.js";
import { interpolate } from "./interpolate.js";
import { DEFAULT_LOCALE } from "./normalize.js";
import { renderPlural } from "./plural.js";
import type {
	LocaleCode,
	MessageParams,
	Messages,
	MissingKeyBehavior,
	Translator,
} from "./types.js";

export { extractPlaceholders, interpolate } from "./interpolate.js";
export {
	DEFAULT_LOCALE,
	normalizeTag,
	resolveLocale,
} from "./normalize.js";
export { isPluralTemplate } from "./plural.js";
export type {
	LocaleCode,
	LocalePreference,
	MessageParams,
	Messages,
	MissingKeyBehavior,
	Translator,
} from "./types.js";

export interface CreateTranslatorInput {
	locale: LocaleCode;
	/** Catalog for `locale`. */
	messages: Messages;
	/** English (or default) catalog used as fallback for missing keys. */
	fallbackMessages?: Messages;
	/**
	 * What to do when a key is missing:
	 * - `"warn"`   → `console.warn` once per key (development default)
	 * - `"throw"`  → throw (tests / CI, so a missing translation is a failure)
	 * - `"silent"` → fall back quietly (production)
	 */
	missing?: MissingKeyBehavior;
	/** Optional display-name overrides, keyed by locale. */
	localeNames?: Partial<Record<LocaleCode, string>>;
}

const warnedKeys = new Set<string>();

function makeLocaleDisplayName(locale: LocaleCode): string {
	try {
		const dn = new Intl.DisplayNames([locale], { type: "language" });
		return dn.of(locale) ?? locale;
	} catch {
		return locale;
	}
}

/**
 * Build a pure, IO-free translator. All catalog data is injected by the caller,
 * so the same runtime serves the webview, a TUI, codegen scripts, and tests.
 */
export function createTranslator(input: CreateTranslatorInput): Translator {
	const {
		locale,
		messages,
		fallbackMessages = {},
		missing = "warn",
		localeNames = {},
	} = input;
	const formatters = makeFormatters(locale);

	const reportMissing = (key: string) => {
		if (missing === "silent") {
			return;
		}
		if (missing === "throw") {
			throw new Error(
				`[i18n] missing translation for key "${key}" (${locale})`,
			);
		}
		if (!warnedKeys.has(key)) {
			warnedKeys.add(key);
			// biome-ignore lint/suspicious/noConsole: one-shot dev warning for missing keys
			console.warn(`[i18n] missing translation for key "${key}" (${locale})`);
		}
	};

	const lookup = (key: string): string | undefined => {
		if (Object.hasOwn(messages, key)) {
			return messages[key];
		}
		if (Object.hasOwn(fallbackMessages, key)) {
			return fallbackMessages[key];
		}
		return undefined;
	};

	const t = (key: string, params?: MessageParams): string => {
		const template = lookup(key);
		if (template === undefined) {
			reportMissing(key);
			return key;
		}
		return interpolate(template, params);
	};

	const plural = (
		key: string,
		count: number,
		params?: MessageParams,
	): string => {
		const template = lookup(key);
		if (template === undefined) {
			reportMissing(key);
			return key;
		}
		const rendered = renderPlural(template, locale, count, params);
		return rendered ?? interpolate(template, params);
	};

	return {
		locale,
		t,
		plural,
		formatNumber: formatters.formatNumber,
		formatDate: formatters.formatDate,
		formatRelativeTime: formatters.formatRelativeTime,
		formatCurrency: formatters.formatCurrency,
		localeDisplayName: (target: LocaleCode) =>
			localeNames[target] ?? makeLocaleDisplayName(target),
	};
}

/** Convenience: a ready-made English translator from a given en catalog. */
export function createEnglishTranslator(messages: Messages): Translator {
	return createTranslator({
		locale: DEFAULT_LOCALE,
		messages,
		missing: "silent",
	});
}
