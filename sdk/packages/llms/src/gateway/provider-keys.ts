const ENTRIES: ReadonlyArray<{
	modelsDevKey: string;
	generatedProviderId?: string;
	runtimeProviderId?: string;
}> = [
	{
		modelsDevKey: "openai",
		generatedProviderId: "openai",
		runtimeProviderId: "openai-native",
	},
	{
		modelsDevKey: "openai",
		generatedProviderId: "openai",
		runtimeProviderId: "openai-codex",
	},
	{ modelsDevKey: "anthropic", generatedProviderId: "anthropic" },
	{
		modelsDevKey: "anthropic",
		generatedProviderId: "anthropic",
		runtimeProviderId: "claude-code",
	},
	{ modelsDevKey: "google", generatedProviderId: "gemini" },
	{ modelsDevKey: "deepseek", generatedProviderId: "deepseek" },
	{ modelsDevKey: "xai", generatedProviderId: "xai" },
	{
		modelsDevKey: "togetherai",
		generatedProviderId: "together",
		runtimeProviderId: "together",
	},
	{
		modelsDevKey: "sap-ai-core",
		generatedProviderId: "sapaicore",
		runtimeProviderId: "sapaicore",
	},
	{
		modelsDevKey: "fireworks-ai",
		generatedProviderId: "fireworks",
		runtimeProviderId: "fireworks",
	},
	{
		modelsDevKey: "groq",
		generatedProviderId: "groq",
		runtimeProviderId: "groq",
	},
	{
		modelsDevKey: "cerebras",
		generatedProviderId: "cerebras",
		runtimeProviderId: "cerebras",
	},
	{
		modelsDevKey: "sambanova",
		generatedProviderId: "sambanova",
		runtimeProviderId: "sambanova",
	},
	{
		modelsDevKey: "nebius",
		generatedProviderId: "nebius",
		runtimeProviderId: "nebius",
	},
	{
		modelsDevKey: "huggingface",
		generatedProviderId: "huggingface",
		runtimeProviderId: "huggingface",
	},
	{
		modelsDevKey: "openrouter",
		generatedProviderId: "openrouter",
	},
	{ modelsDevKey: "ollama-cloud", generatedProviderId: "ollama" },
	{
		modelsDevKey: "vercel",
		generatedProviderId: "vercel-ai-gateway",
		runtimeProviderId: "dify",
	},
	{
		modelsDevKey: "openrouter",
		generatedProviderId: "openrouter",
		runtimeProviderId: "cline",
	},
	{
		modelsDevKey: "aihubmix",
		generatedProviderId: "aihubmix",
		runtimeProviderId: "aihubmix",
	},
	{ modelsDevKey: "hicap", runtimeProviderId: "hicap" },
	{ modelsDevKey: "nous-research", runtimeProviderId: "nousResearch" },
	{ modelsDevKey: "huawei-cloud-maas", runtimeProviderId: "huawei-cloud-maas" },
	{
		modelsDevKey: "baseten",
		generatedProviderId: "baseten",
		runtimeProviderId: "baseten",
	},
	{ modelsDevKey: "google-vertex-anthropic", generatedProviderId: "vertex" },
	{ modelsDevKey: "lmstudio", generatedProviderId: "lmstudio" },
	{ modelsDevKey: "zai", generatedProviderId: "zai" },
	{ modelsDevKey: "requesty", generatedProviderId: "requesty" },
	{ modelsDevKey: "amazon-bedrock", generatedProviderId: "bedrock" },
	{ modelsDevKey: "moonshotai", generatedProviderId: "moonshot" },
	{ modelsDevKey: "minimax", generatedProviderId: "minimax" },
	{ modelsDevKey: "wandb", generatedProviderId: "wandb" },
	{ modelsDevKey: "kilo", generatedProviderId: "kilo" },
	{ modelsDevKey: "xiaomi", generatedProviderId: "xiaomi" },
];

function dedupe(values: readonly string[]): string[] {
	return [...new Set(values)];
}

export const MODELS_DEV_PROVIDER_KEY_MAP = Object.fromEntries(
	ENTRIES.flatMap((entry) =>
		entry.generatedProviderId
			? [[entry.modelsDevKey, entry.generatedProviderId]]
			: [],
	),
);

export function resolveProviderModelCatalogKeys(providerId: string): string[] {
	const mapped = ENTRIES.flatMap((entry) => {
		if (!entry.generatedProviderId) {
			return [];
		}
		if (
			entry.generatedProviderId === providerId ||
			entry.runtimeProviderId === providerId
		) {
			return [entry.generatedProviderId];
		}
		return [];
	});

	if (providerId === "nousResearch") {
		return dedupe([...mapped, "nousresearch", providerId]);
	}

	return dedupe([...mapped, providerId]);
}
