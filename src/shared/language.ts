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
