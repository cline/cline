// UI-only presets for OpenAI-compatible providers.
// Used by the settings webview to offer vendor presets while keeping the underlying provider implementation generic and provider-agnostic.

type OpenAICompatiblePreset = {
	provider: "openai"
	defaults?: { openAiBaseUrl?: string }
}

const OPENAI_COMPATIBLE_PRESETS: Readonly<Record<string, OpenAICompatiblePreset>> = {
	portkey: { provider: "openai", defaults: { openAiBaseUrl: "https://api.portkey.ai/v1" } },
}

/**
 * Maps a dropdown option value to its corresponding provider and default configuration.
 * @param optionValue The value from the provider dropdown
 * @returns The actual provider to use and any default configuration
 */
export function mapOptionToProviderAndDefaults(optionValue: string): {
	provider: string
	defaults?: { openAiBaseUrl?: string }
} {
	const preset = OPENAI_COMPATIBLE_PRESETS[optionValue]
	if (preset) {
		return { provider: preset.provider, defaults: preset.defaults }
	}
	return { provider: optionValue }
}

/**
 * Maps the actual provider and current config back to a dropdown option.
 * For OpenAI-compatible presets, show the matching preset option (e.g., "portkey").
 */
export function mapProviderToOption(provider: string, openAiBaseUrl?: string): string {
	if (provider !== "openai") {
		return provider
	}

	const base = (openAiBaseUrl || "").trim()
	try {
		const input = new URL(base)
		const host = input.hostname.toLowerCase()
		// Any gateway under the Portkey domain should be treated as the Portkey preset
		if (host === "portkey.ai" || host.endsWith(".portkey.ai")) {
			return "portkey"
		}
	} catch {
		// ignore parse errors and fall back to preset loop below
	}

	// Fallback: attempt exact preset matching (useful if other presets are added later)
	for (const [option, preset] of Object.entries(OPENAI_COMPATIBLE_PRESETS)) {
		const presetUrl = preset.defaults?.openAiBaseUrl
		if (!presetUrl) {
			continue
		}
		try {
			const input = new URL(base)
			const presetParsed = new URL(presetUrl)
			const inputHost = input.hostname.toLowerCase()
			const presetHost = presetParsed.hostname.toLowerCase()
			const inputPath = input.pathname || "/"
			const presetPath = presetParsed.pathname || "/"

			const isSameHost = inputHost === presetHost
			const isSubdomain = inputHost.endsWith(`.${presetHost}`)
			const isPathCompatible = presetPath === "/" || inputPath.startsWith(presetPath)

			if ((isSameHost || isSubdomain) && isPathCompatible) {
				return option
			}
		} catch {
			// Fall through; if parsing fails we won't match this preset
		}
	}
	return provider
}
