export const OPENAI_COMPATIBLE_PRESETS: Readonly<Record<string, { provider: "openai"; defaults?: { openAiBaseUrl?: string } }>> =
	{
		portkey: { provider: "openai", defaults: { openAiBaseUrl: "https://api.portkey.ai/v1" } },
	}
