const REMAPPED_OPENAI_COMPATIBLE_PROVIDER_IDS = new Set([
	"cline",
	"openrouter",
	"vercel-ai-gateway",
]);

export function isAnthropicModelId(modelId: string): boolean {
	return modelId.toLowerCase().startsWith("anthropic/");
}

export function isRemappedOpenAICompatibleProvider(
	providerId: string,
): boolean {
	return REMAPPED_OPENAI_COMPATIBLE_PROVIDER_IDS.has(providerId);
}

export function shouldUseAnthropicAutomaticPromptCache(options: {
	modelId: string;
	providerId: string;
	supportsPromptCache: boolean;
}): boolean {
	return (
		options.supportsPromptCache &&
		isAnthropicModelId(options.modelId) &&
		isRemappedOpenAICompatibleProvider(options.providerId)
	);
}
