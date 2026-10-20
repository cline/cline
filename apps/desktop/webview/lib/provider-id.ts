const PROVIDER_ID_ALIASES: Record<string, string> = {
	openai: "openai-native",
	google: "gemini",
};

export function normalizeProviderId(providerId: string): string {
	const trimmed = providerId.trim();
	if (!trimmed) {
		return "";
	}
	return PROVIDER_ID_ALIASES[trimmed] ?? trimmed;
}
