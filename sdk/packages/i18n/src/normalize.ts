import type { LocaleCode, LocalePreference } from "./types.js";

/** The default / ultimate fallback locale. */
export const DEFAULT_LOCALE: LocaleCode = "en";

/**
 * Normalize a raw BCP-47-ish tag ("zh-CN", "zh_TW", "ZH-hans", "en-US") to the
 * canonical tags this package uses ("zh-Hans", "zh-Hant", "en", …).
 */
export function normalizeTag(tag: string): string {
	const t = tag.trim().replace(/_/g, "-");
	if (!t) {
		return DEFAULT_LOCALE;
	}
	const lower = t.toLowerCase();
	// Chinese script variants collapse to the two catalogs we ship.
	if (lower.startsWith("zh")) {
		if (lower.includes("hant") || /-(tw|hk|mo)\b/.test(lower)) {
			return "zh-Hant";
		}
		return "zh-Hans";
	}
	if (lower.startsWith("en")) {
		return "en";
	}
	// Generic: keep language + region, drop the rest.
	const parts = lower.split("-");
	return parts.slice(0, 2).join("-");
}

/**
 * Resolve a user preference against the platform's candidate languages and the
 * catalogs actually available.
 *
 * Order: explicit preference → (when "system") each navigator candidate →
 * default. `zh-Hant` falls back to `zh-Hans` when no Traditional catalog ships.
 */
export function resolveLocale(
	preference: LocalePreference,
	candidates: readonly string[],
	available: readonly LocaleCode[],
): LocaleCode {
	const usable = (tag: string): LocaleCode | null => {
		const norm = normalizeTag(tag);
		if (available.includes(norm)) {
			return norm;
		}
		// Traditional Chinese falls back to Simplified when only that ships.
		if (norm === "zh-Hant" && available.includes("zh-Hans")) {
			return "zh-Hans";
		}
		// Regional variants fall back to their base language (e.g. "en-US" → "en").
		const base = norm.split("-")[0];
		if (base && available.includes(base)) {
			return base;
		}
		return null;
	};

	if (preference !== "system") {
		return usable(preference) ?? DEFAULT_LOCALE;
	}
	for (const candidate of candidates) {
		const resolved = usable(candidate);
		if (resolved) {
			return resolved;
		}
	}
	return DEFAULT_LOCALE;
}
