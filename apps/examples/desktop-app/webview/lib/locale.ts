"use client";

/**
 * Locale preference for the desktop app. Mirrors `app-font-size.ts` / `theme.ts`
 * (localStorage + head bootstrap script + change event) so the language
 * resolves before the first paint and switches without a restart.
 *
 * Storage layers (see .design/desktop-i18n-design.md):
 * - `localStorage["cline.locale.v1"]` — render mirror, read synchronously by
 *   the head script (Rust cannot read it, so it is not authoritative).
 * - `~/.cline/data/settings/code-settings.json` (`language` field) — the
 *   authority, written by the sidecar and read by Rust at startup.
 */
export const APP_LOCALE_STORAGE_KEY = "cline.locale.v1";
export const APP_LOCALE_CHANGE_EVENT = "cline-app-locale-change";

/** Locales with shipped catalogs (en is the source of truth for keys). */
export const APP_LOCALES = ["en", "zh-Hans"] as const;

export type AppLocale = (typeof APP_LOCALES)[number];

export type AppLocalePreference = "system" | AppLocale;

export const DEFAULT_APP_LOCALE: AppLocale = "en";
export const DEFAULT_LOCALE_PREFERENCE: AppLocalePreference = "system";

declare global {
	interface Window {
		/** Set by `I18N_BOOTSTRAP_SCRIPT` before the first paint. */
		__CLINE_LOCALE__?: string;
	}
}

export function isAppLocale(value: unknown): value is AppLocale {
	return (
		typeof value === "string" &&
		(APP_LOCALES as readonly string[]).includes(value)
	);
}

export function isAppLocalePreference(
	value: unknown,
): value is AppLocalePreference {
	return value === "system" || isAppLocale(value);
}

/**
 * Resolve a raw BCP-47-ish tag to an available app locale. Mirrors
 * `@cline/i18n`'s `normalizeTag` inline because the bootstrap script cannot
 * import modules (it must run before the client bundle loads).
 */
function resolveTagToAvailableLocale(tag: string): AppLocale | null {
	const t = tag.trim().replace(/_/g, "-").toLowerCase();
	if (!t) {
		return null;
	}
	if (t.startsWith("zh")) {
		// No Traditional catalog ships yet: zh-Hant falls back to zh-Hans.
		return "zh-Hans";
	}
	if (t.startsWith("en")) {
		return "en";
	}
	return null;
}

/**
 * Resolve a stored preference ("system" | locale) against the platform's
 * language candidates. Shared by the bootstrap script and the runtime so both
 * pick the same locale for the same inputs.
 */
export function resolveAppLocale(
	preference: AppLocalePreference,
	candidates: readonly string[],
): AppLocale {
	const usable = (tag: string): AppLocale | null => {
		const resolved = resolveTagToAvailableLocale(tag);
		return resolved;
	};
	if (preference !== "system") {
		return usable(preference) ?? DEFAULT_APP_LOCALE;
	}
	for (const candidate of candidates) {
		const resolved = usable(candidate);
		if (resolved) {
			return resolved;
		}
	}
	return DEFAULT_APP_LOCALE;
}

/**
 * Runs from the document head before the webview paints. Keep this
 * self-contained: the browser executes it before the client bundle loads.
 */
export const I18N_BOOTSTRAP_SCRIPT = `(() => {
	const root = document.documentElement;
	let locale = ${JSON.stringify(DEFAULT_APP_LOCALE)};
	try {
		const stored = window.localStorage.getItem(${JSON.stringify(APP_LOCALE_STORAGE_KEY)});
		const preference =
			stored && stored !== "system" ? stored : "system";
		const candidates =
			typeof navigator !== "undefined" && Array.isArray(navigator.languages)
				? navigator.languages
				: [];
		const list = preference === "system" ? candidates : [preference];
		for (const tag of list) {
			const t = String(tag).trim().replace(/_/g, "-").toLowerCase();
			let resolved = null;
			if (t.startsWith("zh")) {
				resolved = "zh-Hans";
			} else if (t.startsWith("en")) {
				resolved = "en";
			}
			if (resolved) {
				locale = resolved;
				break;
			}
		}
	} catch {}
	root.lang = locale;
	root.dataset.clineLocale = locale;
	window.__CLINE_LOCALE__ = locale;
})();`;

/** Locale resolved by the bootstrap script (falls back to the default). */
export function readInitialLocale(): AppLocale {
	try {
		const value = window.__CLINE_LOCALE__;
		return isAppLocale(value) ? value : DEFAULT_APP_LOCALE;
	} catch {
		return DEFAULT_APP_LOCALE;
	}
}

export function readStoredLocalePreference(): AppLocalePreference {
	try {
		const stored = window.localStorage.getItem(APP_LOCALE_STORAGE_KEY);
		return isAppLocalePreference(stored) ? stored : DEFAULT_LOCALE_PREFERENCE;
	} catch {
		return DEFAULT_LOCALE_PREFERENCE;
	}
}

function applyLocaleDocumentAttributes(locale: AppLocale): void {
	document.documentElement.lang = locale;
	document.documentElement.dataset.clineLocale = locale;
	window.__CLINE_LOCALE__ = locale;
}

/**
 * Persist + apply a locale locally (render mirror + document attributes).
 * Callers still need to persist the authoritative copy via the sidecar
 * (`set_language`) and rebuild native menus (`set_app_language`).
 */
export function setStoredLocale(locale: AppLocale): AppLocale {
	try {
		window.localStorage.setItem(APP_LOCALE_STORAGE_KEY, locale);
	} catch {
		// Applying still works for this session when persistence is unavailable.
	}
	applyLocaleDocumentAttributes(locale);
	window.dispatchEvent(
		new CustomEvent<AppLocale>(APP_LOCALE_CHANGE_EVENT, { detail: locale }),
	);
	return locale;
}

export function subscribeToLocale(
	onChange: (locale: AppLocale) => void,
): () => void {
	const handleChange = (event: Event) => {
		if (event instanceof CustomEvent && isAppLocale(event.detail)) {
			onChange(event.detail);
		}
	};
	window.addEventListener(APP_LOCALE_CHANGE_EVENT, handleChange);
	return () =>
		window.removeEventListener(APP_LOCALE_CHANGE_EVENT, handleChange);
}
