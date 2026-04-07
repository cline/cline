import { getGeneratedModelsForProvider } from "./generated-access";
import type {
	ModelCollection,
	ModelInfo,
	ProviderCapability,
	ProviderClient,
	ProviderProtocol,
} from "./types";

export const DEFAULT_INTERNAL_OCA_BASE_URL =
	"https://code-internal.aiservice.us-chicago-1.oci.oraclecloud.com/20250206/app/litellm";
export const DEFAULT_EXTERNAL_OCA_BASE_URL =
	"https://code.aiservice.us-chicago-1.oci.oraclecloud.com/20250206/app/litellm";

type ProviderSpec = {
	id: string;
	name: string;
	description: string;
	protocol: ProviderProtocol;
	client: ProviderClient;
	baseUrl?: string;
	defaultModelId?: string;
	capabilities?: ProviderCapability[];
	env?: string[];
	sourceProviderId?: string;
	modelsFactory?: () => Record<string, ModelInfo>;
};

function cloneModels(
	models: Record<string, ModelInfo>,
): Record<string, ModelInfo> {
	return Object.fromEntries(
		Object.entries(models).map(([id, info]) => [id, { ...info }]),
	);
}

function generatedModels(providerId: string): Record<string, ModelInfo> {
	return cloneModels(getGeneratedModelsForProvider(providerId));
}

function pickAnthropicModel(match: (id: string) => boolean): ModelInfo {
	const entry = Object.entries(generatedModels("anthropic")).find(([id]) =>
		match(id),
	);
	if (entry) {
		return entry[1];
	}
	return {
		id: "sonnet",
		name: "Claude Sonnet",
		capabilities: ["streaming", "reasoning"],
	};
}

function buildClaudeCodeModels(): Record<string, ModelInfo> {
	function toClaudeCodeModel(id: "opus" | "sonnet" | "haiku"): ModelInfo {
		const source =
			id === "opus"
				? pickAnthropicModel((modelId) => modelId.includes("opus"))
				: id === "haiku"
					? pickAnthropicModel((modelId) => modelId.includes("haiku"))
					: pickAnthropicModel((modelId) => modelId.includes("sonnet"));
		return {
			...source,
			id,
			name: `Claude ${id.charAt(0).toUpperCase()}${id.slice(1)}`,
		};
	}

	return {
		opus: toClaudeCodeModel("opus"),
		sonnet: toClaudeCodeModel("sonnet"),
		haiku: toClaudeCodeModel("haiku"),
	};
}

function removeToolsCapability(model: ModelInfo): ModelInfo {
	if (!model.capabilities?.includes("tools")) {
		return model;
	}
	return {
		...model,
		capabilities: model.capabilities.filter(
			(capability) => capability !== "tools",
		),
	};
}

function buildOpenAICodexModels(): Record<string, ModelInfo> {
	return Object.fromEntries(
		Object.entries(generatedModels("openai")).map(([modelId, model]) => [
			modelId,
			removeToolsCapability(model),
		]),
	);
}

const PROVIDER_SPECS: ProviderSpec[] = [
	{
		id: "aihubmix",
		name: "AI Hub Mix",
		description: "AI model aggregator",
		protocol: "openai-chat",
		client: "openai-compatible",
		baseUrl: "https://api.aihubmix.com/v1",
		defaultModelId: "gpt-4o",
		env: ["AIHUBMIX_API_KEY"],
		sourceProviderId: "aihubmix",
	},
	{
		id: "anthropic",
		name: "Anthropic",
		description: "Creator of Claude, the AI assistant",
		protocol: "anthropic",
		client: "anthropic",
		baseUrl: "https://api.anthropic.com",
		capabilities: ["reasoning", "prompt-cache"],
		defaultModelId: "claude-sonnet-4-6",
		env: ["ANTHROPIC_API_KEY"],
		sourceProviderId: "anthropic",
	},
	{
		id: "asksage",
		name: "AskSage",
		description: "AskSage platform",
		protocol: "openai-chat",
		client: "fetch",
		baseUrl: "https://api.asksage.ai/server",
		capabilities: ["tools"],
		defaultModelId: "gpt-4o",
		env: ["ASKSAGE_API_KEY"],
		modelsFactory: () => ({}),
	},
	{
		id: "baseten",
		name: "Baseten",
		description: "ML inference platform",
		protocol: "openai-chat",
		client: "openai-compatible",
		baseUrl: "https://model-api.baseten.co/v1",
		env: ["BASETEN_API_KEY"],
		sourceProviderId: "baseten",
	},
	{
		id: "bedrock",
		name: "AWS Bedrock",
		description: "Amazon Bedrock managed foundation models",
		protocol: "anthropic",
		client: "bedrock",
		capabilities: ["reasoning", "prompt-cache"],
		defaultModelId: "minimax.minimax-m2.5",
		env: [
			"AWS_REGION",
			"AWS_ACCESS_KEY_ID",
			"AWS_SECRET_ACCESS_KEY",
			"AWS_SESSION_TOKEN",
		],
		sourceProviderId: "bedrock",
	},
	{
		id: "cerebras",
		name: "Cerebras",
		description: "Fast inference on Cerebras wafer-scale chips",
		protocol: "openai-chat",
		client: "openai-compatible",
		baseUrl: "https://api.cerebras.ai/v1",
		defaultModelId: "zai-glm-4.7",
		env: ["CEREBRAS_API_KEY"],
		sourceProviderId: "cerebras",
	},
	{
		id: "claude-code",
		name: "Claude Code",
		description: "Use Claude Code SDK with Claude Pro/Max subscription",
		protocol: "openai-chat",
		client: "ai-sdk-community",
		baseUrl: "",
		capabilities: ["reasoning"],
		defaultModelId: "sonnet",
		modelsFactory: buildClaudeCodeModels,
	},
	{
		id: "cline",
		name: "Cline",
		description: "Cline API endpoint",
		protocol: "openai-chat",
		client: "openai-compatible",
		baseUrl: "https://api.cline.bot/api/v1",
		capabilities: ["reasoning", "prompt-cache", "tools", "oauth"],
		defaultModelId: "anthropic/claude-sonnet-4.6",
		env: ["CLINE_API_KEY"],
		sourceProviderId: "vercel-ai-gateway",
	},
	{
		id: "deepseek",
		name: "DeepSeek",
		description: "Advanced AI models with reasoning capabilities",
		protocol: "openai-chat",
		client: "openai-compatible",
		baseUrl: "https://api.deepseek.com/v1",
		capabilities: ["reasoning", "prompt-cache"],
		defaultModelId: "deepseek-chat",
		env: ["DEEPSEEK_API_KEY"],
		sourceProviderId: "deepseek",
	},
	{
		id: "dify",
		name: "Dify",
		description: "Dify workflow/application provider via AI SDK",
		protocol: "openai-chat",
		client: "ai-sdk-community",
		defaultModelId: "default",
		env: ["DIFY_API_KEY"],
		modelsFactory: () => ({}),
	},
	{
		id: "doubao",
		name: "Doubao 1.5 Pro 256k",
		description: "Volcengine Ark platform models",
		protocol: "openai-chat",
		client: "openai-compatible",
		baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
		capabilities: ["tools"],
		defaultModelId: "doubao-1-5-pro-256k-250115",
		env: ["DOUBAO_API_KEY"],
		sourceProviderId: "doubao",
	},
	{
		id: "fireworks",
		name: "Fireworks AI",
		description: "High-performance inference platform",
		protocol: "openai-chat",
		client: "openai-compatible",
		baseUrl: "https://api.fireworks.ai/inference/v1",
		defaultModelId: "accounts/fireworks/models/minimax-m2p5",
		env: ["FIREWORKS_API_KEY"],
		sourceProviderId: "fireworks",
	},
	{
		id: "gemini",
		name: "Google Gemini",
		description: "Google Gemini API",
		protocol: "gemini",
		client: "gemini",
		baseUrl: "https://generativelanguage.googleapis.com",
		capabilities: ["reasoning", "prompt-cache"],
		defaultModelId: "gemma-4-26b",
		env: ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"],
		sourceProviderId: "gemini",
	},
	{
		id: "groq",
		name: "Groq",
		description: "Ultra-fast LPU inference",
		protocol: "openai-chat",
		client: "openai-compatible",
		baseUrl: "https://api.groq.com/openai/v1",
		defaultModelId: "moonshotai/kimi-k2-instruct-0905",
		env: ["GROQ_API_KEY"],
		sourceProviderId: "groq",
	},
	{
		id: "hicap",
		name: "HiCap",
		description: "HiCap AI platform",
		protocol: "openai-chat",
		client: "openai-compatible",
		baseUrl: "https://api.hicap.ai/v1",
		defaultModelId: "hicap-pro",
		env: ["HICAP_API_KEY"],
	},
	{
		id: "huawei-cloud-maas",
		name: "Huawei Cloud MaaS",
		description: "Huawei's model-as-a-service platform",
		protocol: "openai-chat",
		client: "openai-compatible",
		baseUrl: "https://infer-modelarts.cn-southwest-2.myhuaweicloud.com/v1",
		defaultModelId: "DeepSeek-R1",
		env: ["HUAWEI_CLOUD_MAAS_API_KEY"],
	},
	{
		id: "huggingface",
		name: "Hugging Face",
		description: "Hugging Face inference API",
		protocol: "openai-chat",
		client: "openai-compatible",
		baseUrl: "https://api-inference.huggingface.co/v1",
		defaultModelId: "MiniMaxAI/MiniMax-M2.5",
		env: ["HF_TOKEN"],
		sourceProviderId: "huggingface",
	},
	{
		id: "kilo",
		name: "Kilo Gateway",
		description: "Kilo Gateway",
		protocol: "openai-responses",
		client: "openai-compatible",
		baseUrl: "https://api.kilo.ai/api/gateway",
		capabilities: ["prompt-cache", "reasoning", "tools"],
		defaultModelId: "gpt-4o",
		env: ["KILO_GATEWAY_API_KEY"],
		sourceProviderId: "kilo",
	},
	{
		id: "litellm",
		name: "LiteLLM",
		description: "Self-hosted LLM proxy",
		protocol: "openai-responses",
		client: "openai-compatible",
		baseUrl: "http://localhost:4000/v1",
		capabilities: ["prompt-cache"],
		defaultModelId: "gpt-5.4",
		env: ["LITELLM_API_KEY"],
	},
	{
		id: "lmstudio",
		name: "LM Studio",
		description: "Local model inference with LM Studio",
		protocol: "openai-chat",
		client: "openai-compatible",
		baseUrl: "http://localhost:1234/v1",
		defaultModelId: "openai/gpt-oss-20b",
		env: ["LMSTUDIO_API_KEY"],
		sourceProviderId: "lmstudio",
	},
	{
		id: "minimax",
		name: "MiniMax M2.5",
		description: "MiniMax models via Anthropic-compatible API",
		protocol: "anthropic",
		client: "anthropic",
		baseUrl: "https://api.minimax.io/anthropic",
		capabilities: ["tools", "reasoning", "prompt-cache"],
		defaultModelId: "MiniMax-M2.5",
		env: ["MINIMAX_API_KEY"],
		sourceProviderId: "minimax",
	},
	{
		id: "mistral",
		name: "Mistral",
		description: "Mistral AI models via AI SDK provider",
		protocol: "openai-chat",
		client: "ai-sdk-community",
		baseUrl: "https://api.mistral.ai/v1",
		capabilities: ["reasoning"],
		defaultModelId: "mistral-medium-latest",
		env: ["MISTRAL_API_KEY"],
		modelsFactory: () => ({}),
	},
	{
		id: "moonshot",
		name: "Kimi K2 Preview",
		description: "Moonshot AI Studio models",
		protocol: "openai-chat",
		client: "openai-compatible",
		baseUrl: "https://api.moonshot.ai/v1",
		capabilities: ["tools", "reasoning"],
		defaultModelId: "kimi-k2-0905-preview",
		env: ["MOONSHOT_API_KEY"],
		sourceProviderId: "moonshot",
	},
	{
		id: "nebius",
		name: "Nebius",
		description: "European cloud AI infrastructure",
		protocol: "openai-chat",
		client: "openai-compatible",
		baseUrl: "https://api.studio.nebius.ai/v1",
		defaultModelId: "nvidia/nemotron-3-super-120b-a12b",
		env: ["NEBIUS_API_KEY"],
		sourceProviderId: "nebius",
	},
	{
		id: "nousResearch",
		name: "Nous Research",
		description: "Open-source AI research lab",
		protocol: "openai-chat",
		client: "openai-compatible",
		baseUrl: "https://inference-api.nousresearch.com/v1",
		defaultModelId: "DeepHermes-3-Llama-3-3-70B-Preview",
		env: ["NOUS_RESEARCH_API_KEY", "NOUSRESEARCH_API_KEY"],
	},
	{
		id: "oca",
		name: "Oracle Code Assist",
		description: "Oracle Code Assist (OCA) LiteLLM gateway",
		protocol: "openai-chat",
		client: "openai-compatible",
		baseUrl: DEFAULT_EXTERNAL_OCA_BASE_URL,
		capabilities: ["reasoning", "prompt-cache", "tools"],
		defaultModelId: "anthropic/claude-3-7-sonnet-20250219",
		env: ["OCA_API_KEY"],
		sourceProviderId: "oca",
	},
	{
		id: "ollama",
		name: "Ollama",
		description: "Ollama Cloud and local LLM hosting",
		protocol: "openai-chat",
		client: "openai-compatible",
		baseUrl: "http://localhost:11434/v1",
		defaultModelId: "llama3.2",
		env: ["OLLAMA_API_KEY"],
	},
	{
		id: "openai-native",
		name: "OpenAI",
		description: "Creator of GPT and ChatGPT",
		protocol: "openai-responses",
		client: "openai",
		baseUrl: "https://api.openai.com/v1",
		capabilities: ["reasoning"],
		defaultModelId: "gpt-5.4-mini",
		env: ["OPENAI_API_KEY"],
		sourceProviderId: "openai",
	},
	{
		id: "openai-codex",
		name: "OpenAI Codex",
		description: "OpenAI Codex via the local Codex CLI provider",
		protocol: "openai-chat",
		client: "ai-sdk-community",
		baseUrl: "https://chatgpt.com/backend-api/codex",
		capabilities: ["reasoning", "oauth"],
		defaultModelId: "gpt-5.4-mini",
		modelsFactory: buildOpenAICodexModels,
	},
	{
		id: "opencode",
		name: "OpenCode",
		description: "OpenCode SDK multi-provider runtime",
		protocol: "openai-chat",
		client: "ai-sdk-community",
		baseUrl: "",
		capabilities: ["reasoning", "oauth"],
		defaultModelId: "openai/gpt-5.3-codex",
		sourceProviderId: "opencode",
	},
	{
		id: "openrouter",
		name: "OpenRouter",
		description: "OpenRouter AI platform",
		protocol: "openai-chat",
		client: "openai-compatible",
		baseUrl: "https://openrouter.ai/api/v1",
		capabilities: ["reasoning", "prompt-cache"],
		defaultModelId: "anthropic/claude-sonnet-4.6",
		env: ["OPENROUTER_API_KEY"],
		sourceProviderId: "openrouter",
	},
	{
		id: "qwen",
		name: "Qwen Plus Latest",
		description: "Alibaba Qwen platform models",
		protocol: "openai-chat",
		client: "openai-compatible",
		baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
		capabilities: ["tools", "reasoning"],
		defaultModelId: "qwen-plus-latest",
		env: ["QWEN_API_KEY"],
		sourceProviderId: "qwen",
	},
	{
		id: "qwen-code",
		name: "Qwen3 Coder Plus",
		description: "Qwen OAuth coding models",
		protocol: "openai-chat",
		client: "openai-compatible",
		baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
		capabilities: ["tools", "reasoning"],
		defaultModelId: "qwen3-coder-plus",
		sourceProviderId: "qwen-code",
	},
	{
		id: "requesty",
		name: "Requesty",
		description: "AI router with multiple provider support",
		protocol: "openai-chat",
		client: "openai-compatible",
		baseUrl: "https://router.requesty.ai/v1",
		capabilities: ["reasoning"],
		defaultModelId: "openai/gpt-5.4",
		env: ["REQUESTY_API_KEY"],
		sourceProviderId: "requesty",
	},
	{
		id: "sambanova",
		name: "SambaNova",
		description: "High-performance AI inference",
		protocol: "openai-chat",
		client: "openai-compatible",
		baseUrl: "https://api.sambanova.ai/v1",
		env: ["SAMBANOVA_API_KEY"],
		sourceProviderId: "sambanova",
	},
	{
		id: "sapaicore",
		name: "Claude 3.5 Sonnet (SAP AI Core)",
		description: "SAP AI Core inference and orchestration platform",
		protocol: "openai-chat",
		client: "ai-sdk-community",
		baseUrl: "",
		capabilities: ["tools", "reasoning", "prompt-cache"],
		defaultModelId: "anthropic--claude-3.5-sonnet",
		env: ["AICORE_SERVICE_KEY", "VCAP_SERVICES"],
		sourceProviderId: "sapaicore",
	},
	{
		id: "together",
		name: "Together AI",
		description: "Fast inference for open-source models",
		protocol: "openai-chat",
		client: "openai-compatible",
		baseUrl: "https://api.together.xyz/v1",
		capabilities: ["reasoning"],
		defaultModelId: "Qwen/Qwen3.5-397B-A17B",
		env: ["TOGETHER_API_KEY"],
		sourceProviderId: "together",
	},
	{
		id: "vercel-ai-gateway",
		name: "Vercel AI Gateway",
		description: "Vercel's AI gateway service",
		protocol: "openai-chat",
		client: "openai-compatible",
		baseUrl: "https://ai-gateway.vercel.sh/v1",
		capabilities: ["reasoning"],
		defaultModelId: "alibaba/qwen3.6-plus",
		env: ["AI_GATEWAY_API_KEY", "VERCEL_API_KEY"],
		sourceProviderId: "vercel-ai-gateway",
	},
	{
		id: "vertex",
		name: "Google Vertex AI",
		description: "Google Cloud Vertex AI (Gemini and partner models)",
		protocol: "gemini",
		client: "vertex",
		capabilities: ["reasoning", "prompt-cache"],
		defaultModelId: "claude-sonnet-4-6@default",
		env: [
			"GCP_PROJECT_ID",
			"GOOGLE_CLOUD_PROJECT",
			"GOOGLE_APPLICATION_CREDENTIALS",
			"GEMINI_API_KEY",
			"GOOGLE_API_KEY",
		],
		sourceProviderId: "vertex",
	},
	{
		id: "wandb",
		name: "W&B by CoreWeave",
		description: "Weights & Biases",
		protocol: "openai-chat",
		client: "openai-compatible",
		baseUrl: "https://api.inference.wandb.ai/v1",
		capabilities: ["reasoning", "prompt-cache", "tools"],
		defaultModelId: "nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-FP8",
		env: ["WANDB_API_KEY"],
		sourceProviderId: "wandb",
	},
	{
		id: "xai",
		name: "xAI",
		description: "Creator of Grok AI assistant",
		protocol: "openai-chat",
		client: "openai-compatible",
		baseUrl: "https://api.x.ai/v1",
		capabilities: ["reasoning"],
		defaultModelId: "grok-4.20-0309-non-reasoning",
		env: ["XAI_API_KEY"],
		sourceProviderId: "xai",
	},
	{
		id: "xiaomi",
		name: "Xiaomi",
		description: "Xiaomi",
		protocol: "openai-responses",
		client: "openai-compatible",
		baseUrl: "https://api.xiaomimimo.com/v1",
		capabilities: ["prompt-cache", "tools", "reasoning"],
		defaultModelId: "mimo-v2-omni",
		env: ["XIAOMI_API_KEY"],
		sourceProviderId: "xiaomi",
	},
	{
		id: "zai",
		name: "Z.AI",
		description: "Z.AI's family of LLMs",
		protocol: "openai-chat",
		client: "openai-compatible",
		baseUrl: "https://api.z.ai/api/paas/v4",
		capabilities: ["reasoning"],
		defaultModelId: "glm-5v-turbo",
		env: ["ZHIPU_API_KEY"],
		sourceProviderId: "zai",
	},
];

function createCollection(spec: ProviderSpec): ModelCollection {
	const models = spec.modelsFactory
		? spec.modelsFactory()
		: spec.sourceProviderId
			? generatedModels(spec.sourceProviderId)
			: {};
	const modelIds = Object.keys(models);
	const defaultModelId = spec.defaultModelId || modelIds[0] || "default";

	return {
		provider: {
			id: spec.id,
			name: spec.name,
			description: spec.description,
			protocol: spec.protocol,
			baseUrl: spec.baseUrl,
			defaultModelId,
			capabilities: spec.capabilities,
			env: spec.env,
			client: spec.client,
		},
		models,
	};
}

export const MODEL_COLLECTIONS_BY_PROVIDER_ID: Record<string, ModelCollection> =
	Object.fromEntries(
		PROVIDER_SPECS.map((spec) => [spec.id, createCollection(spec)]),
	);

export const MODEL_COLLECTION_LIST = Object.values(
	MODEL_COLLECTIONS_BY_PROVIDER_ID,
);

export const OPENAI_CODEX_PROVIDER = MODEL_COLLECTIONS_BY_PROVIDER_ID[
	"openai-codex"
] as ModelCollection;
