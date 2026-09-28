export const APP_LOCALE_STORAGE_KEY = "cline.code.locale.v1";
export const APP_LOCALE_CHANGE_EVENT = "cline-app-locale-change";

/**
 * `label` is the language's own name, never the host language's word for it: a
 * reader who cannot read the current interface is exactly the reader choosing a
 * language, so every option has to be recognisable in its own script.
 */
export interface AppLocaleInfo {
	code: string;
	label: string;
	/** Present in the interface's own language so the row explains itself. */
	englishLabel: string;
}

export const APP_LOCALES = [
	{ code: "en", label: "English", englishLabel: "English" },
	{ code: "zh-CN", label: "简体中文", englishLabel: "Chinese (Simplified)" },
	{ code: "zh-TW", label: "繁體中文", englishLabel: "Chinese (Traditional)" },
	{ code: "ja", label: "日本語", englishLabel: "Japanese" },
	{ code: "ko", label: "한국어", englishLabel: "Korean" },
	{ code: "vi", label: "Tiếng Việt", englishLabel: "Vietnamese" },
] as const satisfies readonly AppLocaleInfo[];

export type AppLocaleCode = (typeof APP_LOCALES)[number]["code"];

export const DEFAULT_APP_LOCALE: AppLocaleCode = "en";

export function isAppLocale(value: unknown): value is AppLocaleCode {
	return (
		typeof value === "string" &&
		APP_LOCALES.some((locale) => locale.code === value)
	);
}

export function appLocaleInfo(code: string): AppLocaleInfo {
	return (
		APP_LOCALES.find((locale) => locale.code === code) ??
		APP_LOCALES.find((locale) => locale.code === DEFAULT_APP_LOCALE) ??
		APP_LOCALES[0]
	);
}

/**
 * Runs from the document head before the webview paints, so a non-English user
 * never sees an English flash on startup. Keep it self-contained: the browser
 * executes it before the client bundle loads.
 */
export const APP_LOCALE_BOOTSTRAP_SCRIPT = `(() => {
	try {
		const stored = window.localStorage.getItem(${JSON.stringify(APP_LOCALE_STORAGE_KEY)});
		const known = ${JSON.stringify(APP_LOCALES.map((locale) => locale.code))};
		const locale = stored && known.includes(stored) ? stored : ${JSON.stringify(DEFAULT_APP_LOCALE)};
		document.documentElement.lang = locale;
		document.documentElement.dataset.clineLocale = locale;
	} catch {}
})();`;

export function readStoredAppLocale(): AppLocaleCode {
	try {
		const stored = window.localStorage.getItem(APP_LOCALE_STORAGE_KEY);
		return isAppLocale(stored) ? stored : DEFAULT_APP_LOCALE;
	} catch {
		return DEFAULT_APP_LOCALE;
	}
}

export function applyAppLocale(locale: AppLocaleCode): AppLocaleCode {
	document.documentElement.lang = locale;
	document.documentElement.dataset.clineLocale = locale;
	window.dispatchEvent(
		new CustomEvent<AppLocaleCode>(APP_LOCALE_CHANGE_EVENT, { detail: locale }),
	);
	return locale;
}

export function setStoredAppLocale(locale: AppLocaleCode): AppLocaleCode {
	try {
		window.localStorage.setItem(APP_LOCALE_STORAGE_KEY, locale);
	} catch {
		// Applying still works for this session when persistence is unavailable.
	}
	return applyAppLocale(locale);
}

/** Cross-window sync: the hub and the desktop webview share localStorage. */
export function subscribeToAppLocale(
	listener: (locale: AppLocaleCode) => void,
): () => void {
	const onCustom = (event: Event) => {
		const detail = (event as CustomEvent<AppLocaleCode>).detail;
		if (isAppLocale(detail)) {
			listener(detail);
		}
	};
	const onStorage = (event: StorageEvent) => {
		if (event.key !== null && event.key !== APP_LOCALE_STORAGE_KEY) {
			return;
		}
		listener(readStoredAppLocale());
	};
	window.addEventListener(APP_LOCALE_CHANGE_EVENT, onCustom);
	window.addEventListener("storage", onStorage);
	return () => {
		window.removeEventListener(APP_LOCALE_CHANGE_EVENT, onCustom);
		window.removeEventListener("storage", onStorage);
	};
}
