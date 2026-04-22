/**
 * Built-in provider IDs
 *
 * Single source of truth for all built-in provider identifiers.
 * Use BUILT_IN_PROVIDER_IDS for runtime operations (validation, iteration)
 * Use BuiltInProviderId type for compile-time type safety
 */
export enum BUILT_IN_PROVIDER {
	// First-party
	ANTHROPIC = "anthropic",
	CLAUDE_CODE = "claude-code",
	CLINE = "cline",
	// OpenAI variants
	// OPENAI = "openai", // OpenAi Completions (deprecated - not a built-in pre-configured provider)
	OPENAI_NATIVE = "openai-native",
	OPENAI_CODEX = "openai-codex",
	// CLI / Subscription-based providers
	OPENCODE = "opencode",
	// Cloud providers
	BEDROCK = "bedrock",
	VERTEX = "vertex",
	GEMINI = "gemini",
	// Local/self-hosted
	OLLAMA = "ollama",
	LMSTUDIO = "lmstudio",
	// OpenAI-compatible
	DEEPSEEK = "deepseek",
	XAI = "xai",
	TOGETHER = "together",
	FIREWORKS = "fireworks",
	GROQ = "groq",
	CEREBRAS = "cerebras",
	SAMBANOVA = "sambanova",
	NEBIUS = "nebius",
	BASETEN = "baseten",
	REQUESTY = "requesty",
	LITELLM = "litellm",
	HUGGINGFACE = "huggingface",
	VERCEL_AI_GATEWAY = "vercel-ai-gateway",
	AIHUBMIX = "aihubmix",
	HICAP = "hicap",
	NOUS_RESEARCH = "nousResearch",
	HUAWEI_CLOUD_MAAS = "huawei-cloud-maas",
	WANDB = "wandb",
	XIAOMI = "xiaomi",
	KILO = "kilo",
	ZAI = "zai",
	ZAI_CODING_PLAN = "zai-coding-plan",
	// Regional/specialized
	QWEN = "qwen",
	QWEN_CODE = "qwen-code",
	DOUBAO = "doubao",
	MISTRAL = "mistral",
	MOONSHOT = "moonshot",
	ASKSAGE = "asksage",
	MINIMAX = "minimax",
	DIFY = "dify",
	OCA = "oca",
	SAPAICORE = "sapaicore",
	// Aggregators
	OPENROUTER = "openrouter",
}

/**
 * Provider ID aliases normalized to canonical built-in IDs.
 *
 * Keep this map as the single source of truth for alias handling.
 */
export const PROVIDER_ID_ALIASES: Record<string, BUILT_IN_PROVIDER> = {
	openai: BUILT_IN_PROVIDER.OPENAI_NATIVE,
	togetherai: BUILT_IN_PROVIDER.TOGETHER,
	"sap-ai-core": BUILT_IN_PROVIDER.SAPAICORE,
};

export const BUILT_IN_PROVIDER_IDS = Object.values(BUILT_IN_PROVIDER) as [
	BUILT_IN_PROVIDER,
	...BUILT_IN_PROVIDER[],
];

/** Type derived from the array - use for type annotations */
export type BuiltInProviderId = (typeof BUILT_IN_PROVIDER_IDS)[number];

/** Check if a string is a valid built-in provider ID */
export function isBuiltInProviderId(id: string): id is BuiltInProviderId {
	return BUILT_IN_PROVIDER_IDS.includes(id as BuiltInProviderId);
}

/** Normalize provider aliases to canonical IDs */
export function normalizeProviderId(providerId: string): string {
	const normalized = providerId.trim();
	return PROVIDER_ID_ALIASES[normalized] ?? normalized;
}
