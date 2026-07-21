/** Maps provider identifiers across Cline legacy provider ids, models.dev keys, and runtime provider ids. */
const PROVIDER_IDS_MAP: ReadonlyArray<{
	modelsDevKey: string;
	generatedProviderId?: string;
	runtimeProviderId?: string;
}> = [
	{
		modelsDevKey: "openai",
		generatedProviderId: "openai-native",
		runtimeProviderId: "openai-native",
	},
	{
		modelsDevKey: "openai",
		generatedProviderId: "openai-native",
		runtimeProviderId: "openai-codex-cli",
	},
	{
		modelsDevKey: "openai",
		generatedProviderId: "openai-native",
		runtimeProviderId: "openai-codex",
	},
	{ modelsDevKey: "anthropic", generatedProviderId: "anthropic" },
	{
		modelsDevKey: "anthropic",
		generatedProviderId: "anthropic",
		runtimeProviderId: "claude-code",
	},
	{ modelsDevKey: "google", generatedProviderId: "gemini" },
	{
		modelsDevKey: "deepseek",
		generatedProviderId: "deepseek",
		runtimeProviderId: "deepseek",
	},
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
	{ modelsDevKey: "ollama", runtimeProviderId: "ollama-cloud" },
	{ modelsDevKey: "ollama-cloud", generatedProviderId: "ollama" },
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
		modelsDevKey: "poolside",
		generatedProviderId: "poolside",
		runtimeProviderId: "poolside",
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
	{
		modelsDevKey: "vercel",
		generatedProviderId: "vercel-ai-gateway",
		runtimeProviderId: "dify",
	},
	{
		modelsDevKey: "vercel",
		generatedProviderId: "vercel-ai-gateway",
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
	{ modelsDevKey: "zai-coding-plan", generatedProviderId: "zai-coding-plan" },
	{ modelsDevKey: "google-vertex", generatedProviderId: "vertex" },
	{ modelsDevKey: "lmstudio", generatedProviderId: "lmstudio" },
	{ modelsDevKey: "zai", generatedProviderId: "zai" },
	{ modelsDevKey: "requesty", generatedProviderId: "requesty" },
	{ modelsDevKey: "amazon-bedrock", generatedProviderId: "bedrock" },
	{ modelsDevKey: "mistral", generatedProviderId: "mistral" },
	{ modelsDevKey: "moonshotai", generatedProviderId: "moonshot" },
	{ modelsDevKey: "minimax", generatedProviderId: "minimax" },
	{ modelsDevKey: "opencode", generatedProviderId: "opencode" },
	{ modelsDevKey: "wandb", generatedProviderId: "wandb" },
	{ modelsDevKey: "kilo", generatedProviderId: "kilo" },
	{ modelsDevKey: "xiaomi", generatedProviderId: "xiaomi" },
	{
		modelsDevKey: "tencent-tokenhub",
		generatedProviderId: "tencent-tokenhub",
	},
	{ modelsDevKey: "v0", generatedProviderId: "v0" },
];

function dedupe(values: readonly string[]): string[] {
	return [...new Set(values)];
}

export const MODELS_DEV_PROVIDER_KEY_MAP = Object.fromEntries(
	PROVIDER_IDS_MAP.flatMap((entry) =>
		entry.generatedProviderId
			? [[entry.modelsDevKey, entry.generatedProviderId]]
			: [],
	),
);

/**
 * Explicit allowlist for providers generated from models.dev.
 *
 * IDs use Cline's generated provider identifiers (after applying
 * MODELS_DEV_PROVIDER_KEY_MAP), so upstream additions remain excluded until
 * they are reviewed and added here.
 */
export const MODELS_DEV_ALLOWED_PROVIDER_IDS: ReadonlySet<string> = new Set([
	"302ai",
	"abacus",
	"abliteration-ai",
	"aihubmix",
	"alibaba",
	"alibaba-cn",
	"alibaba-coding-plan",
	"alibaba-coding-plan-cn",
	"alibaba-token-plan",
	"alibaba-token-plan-cn",
	"ambient",
	"anthropic",
	"anyapi",
	"atomic-chat",
	"auriko",
	"bailing",
	"baseten",
	"bedrock",
	"berget",
	"cerebras",
	"chutes",
	"clarifai",
	"claudinio",
	"cloudferro-sherlock",
	"cloudflare-workers-ai",
	"cortecs",
	"crof",
	"databricks",
	"deepseek",
	"digitalocean",
	"dinference",
	"drun",
	"evroc",
	"fastrouter",
	"fireworks",
	"friendli",
	"frogbot",
	"gemini",
	"github-copilot",
	"github-models",
	"gmicloud",
	"groq",
	"helicone",
	"hpc-ai",
	"huggingface",
	"iflowcn",
	"inception",
	"inceptron",
	"inference",
	"io-net",
	"jiekou",
	"kenari",
	"kilo",
	"kuae-cloud-coding-plan",
	"lilac",
	"llama",
	"llmgateway",
	"llmtr",
	"lmstudio",
	"longcat",
	"lucidquery",
	"meganova",
	"minimax",
	"mistral",
	"mixlayer",
	"moark",
	"modelscope",
	"moonshot",
	"moonshotai-cn",
	"morph",
	"nano-gpt",
	"nearai",
	"nebius",
	"neon",
	"neuralwatt",
	"nova",
	"novita-ai",
	"nvidia",
	"ollama",
	"openai-native",
	"opencode",
	"opencode-go",
	"openrouter",
	"orcarouter",
	"ovhcloud",
	"poe",
	"poolside",
	"privatemode-ai",
	"qihang-ai",
	"qiniu-ai",
	"regolo-ai",
	"requesty",
	"routing-run",
	"sakana",
	"sapaicore",
	"sarvam",
	"scaleway",
	"siliconflow",
	"siliconflow-cn",
	"snowflake-cortex",
	"stackit",
	"stepfun",
	"stepfun-ai",
	"submodel",
	"synthetic",
	"tencent-coding-plan",
	"tencent-token-plan",
	"tencent-tokenhub",
	"the-grid-ai",
	"tinfoil",
	"together",
	"trustedrouter",
	"umans-ai",
	"umans-ai-coding-plan",
	"upstage",
	"v0",
	"vercel-ai-gateway",
	"vertex",
	"vultr",
	"wafer.ai",
	"wandb",
	"xai",
	"xiaomi",
	"xiaomi-token-plan-ams",
	"xiaomi-token-plan-cn",
	"xiaomi-token-plan-sgp",
	"xpersona",
	"zai",
	"zai-coding-plan",
	"zeldoc",
	"zenifra",
	"zenmux",
	"zhipuai",
	"zhipuai-coding-plan",
]);

export const MODELS_DEV_CURRENT_BUILTIN_PROVIDER_KEYS = new Set(
	PROVIDER_IDS_MAP.map((entry) => entry.modelsDevKey),
);

export function resolveGeneratedProviderIdForModelsDevKey(
	modelsDevKey: string,
): string | undefined {
	return MODELS_DEV_PROVIDER_KEY_MAP[modelsDevKey];
}

export function resolveProviderModelCatalogKeys(providerId: string): string[] {
	const mapped = PROVIDER_IDS_MAP.flatMap((entry) => {
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
