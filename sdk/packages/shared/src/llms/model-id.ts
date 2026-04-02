export const MODELS_DEV_PROVIDER_KEY_ENTRIES: ReadonlyArray<{
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
	{
		modelsDevKey: "anthropic",
		generatedProviderId: "anthropic",
	},
	{
		modelsDevKey: "anthropic",
		generatedProviderId: "anthropic",
		runtimeProviderId: "claude-code",
	},
	{
		modelsDevKey: "google",
		generatedProviderId: "gemini",
	},
	{
		modelsDevKey: "deepseek",
		generatedProviderId: "deepseek",
	},
	{ modelsDevKey: "xai", generatedProviderId: "xai" },
	{
		modelsDevKey: "togetherai",
		runtimeProviderId: "together",
		generatedProviderId: "together",
	},
	{
		modelsDevKey: "sap-ai-core",
		runtimeProviderId: "sapaicore",
		generatedProviderId: "sapaicore",
	},
	{
		modelsDevKey: "fireworks-ai",
		runtimeProviderId: "fireworks",
		generatedProviderId: "fireworks",
	},
	{
		modelsDevKey: "groq",
		runtimeProviderId: "groq",
		generatedProviderId: "groq",
	},
	{
		modelsDevKey: "cerebras",
		runtimeProviderId: "cerebras",
		generatedProviderId: "cerebras",
	},
	{
		modelsDevKey: "sambanova",
		runtimeProviderId: "sambanova",
		generatedProviderId: "sambanova",
	},
	{
		modelsDevKey: "nebius",
		runtimeProviderId: "nebius",
		generatedProviderId: "nebius",
	},
	{
		modelsDevKey: "huggingface",
		runtimeProviderId: "huggingface",
		generatedProviderId: "huggingface",
	},
	{
		modelsDevKey: "openrouter",
		runtimeProviderId: "cline",
		generatedProviderId: "openrouter",
	},
	{ modelsDevKey: "ollama", runtimeProviderId: "ollama-cloud" },
	{ modelsDevKey: "ollama-cloud", generatedProviderId: "ollama" },
	{
		modelsDevKey: "vercel",
		runtimeProviderId: "dify",
		generatedProviderId: "vercel-ai-gateway",
	},
	{
		modelsDevKey: "vercel",
		generatedProviderId: "vercel-ai-gateway",
	},
	{
		modelsDevKey: "aihubmix",
		runtimeProviderId: "aihubmix",
		generatedProviderId: "aihubmix",
	},
	{ modelsDevKey: "hicap", runtimeProviderId: "hicap" },
	{ modelsDevKey: "nous-research", runtimeProviderId: "nousResearch" },
	{ modelsDevKey: "huawei-cloud-maas", runtimeProviderId: "huawei-cloud-maas" },
	{
		modelsDevKey: "baseten",
		runtimeProviderId: "baseten",
		generatedProviderId: "baseten",
	},
	{
		modelsDevKey: "google-vertex-anthropic",
		generatedProviderId: "vertex",
	},
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

function buildProviderKeyMap(
	key: "modelsDevKey" | "generatedProviderId",
): Record<string, string> {
	return Object.fromEntries(
		MODELS_DEV_PROVIDER_KEY_ENTRIES.flatMap((entry) => {
			const providerId =
				key === "modelsDevKey" ? entry.modelsDevKey : entry.generatedProviderId;
			return providerId ? [[entry.modelsDevKey, providerId]] : [];
		}),
	);
}

export const MODELS_DEV_PROVIDER_KEY_MAP = buildProviderKeyMap(
	"generatedProviderId",
);

function dedupe(values: readonly string[]): string[] {
	return [...new Set(values)];
}

export function resolveProviderModelCatalogKeys(providerId: string): string[] {
	const mapped = MODELS_DEV_PROVIDER_KEY_ENTRIES.flatMap((entry) => {
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
