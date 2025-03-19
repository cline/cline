/**
 * Language name mapping from ISO codes to full language names
 */
export const LANGUAGES: Record<string, string> = {
	ca: "Català",
	de: "Deutsch",
	en: "English",
	es: "Español",
	fr: "Français",
	hi: "हिन्दी",
	it: "Italiano",
	ja: "日本語",
	ko: "한국어",
	pl: "Polski",
	"pt-BR": "Português",
	tr: "Türkçe",
	vi: "Tiếng Việt",
	"zh-CN": "简体中文",
	"zh-TW": "繁體中文",
}

/**
 * Formats a VSCode locale string to ensure the region code is uppercase.
 * For example, transforms "en-us" to "en-US" or "fr-ca" to "fr-CA".
 *
 * @param vscodeLocale - The VSCode locale string to format (e.g., "en-us", "fr-ca")
 * @returns The formatted locale string with uppercase region code
 */
export function formatLanguage(vscodeLocale: string): string {
	if (!vscodeLocale) {
		return "en" // Default to English if no locale is provided
	}

	return vscodeLocale.replace(/-(\w+)$/, (_, region) => `-${region.toUpperCase()}`)
}
