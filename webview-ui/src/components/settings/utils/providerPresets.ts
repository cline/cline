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
	const url = (openAiBaseUrl || "").toLowerCase()
	for (const [option, preset] of Object.entries(OPENAI_COMPATIBLE_PRESETS)) {
		const presetUrl = preset.defaults?.openAiBaseUrl?.toLowerCase()
		if (!presetUrl) {
			continue
		}
		try {
			const presetHost = new URL(presetUrl).host
			if (url.startsWith(presetUrl) || (presetHost && url.includes(presetHost))) {
				return option
			}
		} catch {
			// ignore URL parsing errors
		}
	}
	return provider
}
