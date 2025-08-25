// UI-only presets for OpenAI-compatible providers.
// Used by the settings webview to offer vendor presets while keeping the underlying provider implementation generic and provider-agnostic.
export const OPENAI_COMPATIBLE_PRESETS: Readonly<Record<string, { provider: "openai"; defaults?: { openAiBaseUrl?: string } }>> =
	{
		portkey: { provider: "openai", defaults: { openAiBaseUrl: "https://api.portkey.ai/v1" } },
	}
