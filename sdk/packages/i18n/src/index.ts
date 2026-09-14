import { createInstance, type i18n } from "i18next";
import { resources } from "./resources";

export {
	LOCALE_DISPLAY_NAMES,
	NAMESPACES,
	type Namespace,
	resources,
} from "./resources";

export const SUPPORTED_LOCALES = Object.keys(resources) as SupportedLocale[];
export type SupportedLocale = keyof typeof resources;

export const DEFAULT_LOCALE: SupportedLocale = "en";

/** Sentinel value for the uiLanguage setting meaning "follow the host editor's display language". */
export const AUTO_LOCALE = "auto";

/**
 * Maps an arbitrary BCP-47 tag (e.g. VS Code's `env.language`: "zh-cn",
 * "es-419", "ru") onto a supported locale. Falls back to the base language,
 * then to any supported locale sharing that base (so "zh-tw" renders zh-CN
 * until a zh-TW catalog exists), then to English.
 */
export function resolveLocale(
	candidate: string | null | undefined,
): SupportedLocale {
	if (!candidate || candidate === AUTO_LOCALE) {
		return DEFAULT_LOCALE;
	}
	const normalized = candidate.trim().toLowerCase();
	const exact = SUPPORTED_LOCALES.find(
		(locale) => locale.toLowerCase() === normalized,
	);
	if (exact) {
		return exact;
	}
	const base = normalized.split("-")[0];
	const baseMatch = SUPPORTED_LOCALES.find(
		(locale) => locale.toLowerCase().split("-")[0] === base,
	);
	return baseMatch ?? DEFAULT_LOCALE;
}

/**
 * Creates an isolated, synchronously-initialized i18next instance with all
 * Cline catalogs loaded. Hosts (webview, extension host, CLI) each create
 * their own instance and switch languages via `instance.changeLanguage()`.
 */
export function createI18nInstance(locale?: string | null): i18n {
	const instance = createInstance({
		defaultNS: "common",
		fallbackLng: DEFAULT_LOCALE,
		interpolation: { escapeValue: false },
		lng: resolveLocale(locale),
		ns: [...Object.keys(resources.en)],
		resources,
		returnEmptyString: false,
	});
	// Synchronous: all resources are bundled, no backend plugins involved.
	instance.init();
	return instance;
}
