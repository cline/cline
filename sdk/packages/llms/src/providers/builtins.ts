import type {
	GatewayModelCapability,
	GatewayModelDefinition,
	GatewayProviderManifest,
	GatewayProviderMetadata,
	GatewayProviderSettings,
	JsonValue,
	ProviderCapability,
} from "@clinebot/shared";
import { getGeneratedModelsForProvider } from "../catalog/catalog.generated-access";
import type {
	ModelCollection,
	ModelInfo,
	ProviderClient,
	ProviderProtocol,
} from "../catalog/types";

export const DEFAULT_INTERNAL_OCA_BASE_URL =
	"https://code-internal.aiservice.us-chicago-1.oci.oraclecloud.com/20250206/app/litellm";
export const DEFAULT_EXTERNAL_OCA_BASE_URL =
	"https://code.aiservice.us-chicago-1.oci.oraclecloud.com/20250206/app/litellm";

export type ProviderFamily =
	| "openai"
	| "openai-compatible"
	| "anthropic"
	| "google"
	| "vertex"
	| "bedrock"
	| "mistral"
	| "claude-code"
	| "openai-codex"
	| "opencode"
	| "dify";

export interface BuiltinSpec {
	id: string;
	name: string;
	description: string;
	family: ProviderFamily;
	protocol?: ProviderProtocol;
	client?: ProviderClient;
	capabilities?: ProviderCapability[];
	modelsProviderId?: string;
	defaultModelId?: string;
	modelsFactory?: () => Record<string, ModelInfo>;
	env?: readonly ("browser" | "node")[];
	apiKeyEnv?: readonly string[];
	docsUrl?: string;
	defaults?: GatewayProviderSettings;
	metadata?: GatewayProviderMetadata;
}

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

function modelInfoToGateway(
	providerId: string,
	info: ModelInfo,
): GatewayModelDefinition {
	const capabilities = new Set<GatewayModelCapability>(["text"]);
	for (const cap of info.capabilities ?? []) {
		switch (cap) {
			case "tools":
				capabilities.add("tools");
				break;
			case "reasoning":
				capabilities.add("reasoning");
				break;
			case "images":
				capabilities.add("images");
				break;
			case "structured_output":
				capabilities.add("structured-output");
				break;
		}
	}
	const metadata: Record<string, JsonValue | undefined> = {};
	if (info.family) {
		metadata.family = info.family;
	}
	if (info.pricing) {
		metadata.pricing = info.pricing;
	}
	if (info.status) {
		metadata.status = info.status;
	}
	if (info.releaseDate) {
		metadata.releaseDate = info.releaseDate;
	}
	return {
		id: info.id,
		name: info.name ?? info.id,
		providerId,
		description: info.description,
		contextWindow: info.contextWindow,
		maxOutputTokens: info.maxTokens,
		capabilities: [...capabilities],
		metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
	};
}

function inferProtocol(spec: BuiltinSpec): ProviderProtocol {
	if (spec.client === "openai") {
		return "openai-responses";
	}
	switch (spec.family) {
		case "openai":
			return "openai-responses";
		case "anthropic":
		case "bedrock":
			return "anthropic";
		case "google":
		case "vertex":
			return "gemini";
		default:
			return "openai-chat";
	}
}

function inferClient(spec: BuiltinSpec): ProviderClient {
	if (spec.protocol === "openai-responses") {
		return "openai";
	}
	switch (spec.family) {
		case "openai":
			return "openai";
		case "anthropic":
			return "anthropic";
		case "google":
			return "gemini";
		case "vertex":
			return "vertex";
		case "bedrock":
			return "bedrock";
		case "mistral":
		case "claude-code":
		case "openai-codex":
		case "opencode":
		case "dify":
			return "ai-sdk-community";
		default:
			return "openai-compatible";
	}
}

const OPENAI_COMPATIBLE_SPECS: BuiltinSpec[] = [
	{
		id: "cline",
		name: "Cline",
		description: "Cline API endpoint",
		family: "openai-compatible",
		capabilities: ["reasoning", "prompt-cache", "tools", "oauth"],
		modelsProviderId: "openrouter",
		defaultModelId: "anthropic/claude-sonnet-4.6",
		apiKeyEnv: ["CLINE_API_KEY"],
		defaults: { baseUrl: "https://api.cline.bot/api/v1" },
		metadata: { promptCacheStrategy: "anthropic-automatic" },
	},
	{
		id: "deepseek",
		name: "DeepSeek",
		description: "Advanced AI models with reasoning capabilities",
		family: "openai-compatible",
		capabilities: ["reasoning", "prompt-cache"],
		defaultModelId: "deepseek-chat",
		apiKeyEnv: ["DEEPSEEK_API_KEY"],
		defaults: { baseUrl: "https://api.deepseek.com/v1" },
	},
	{
		id: "xai",
		name: "xAI",
		description: "Creator of Grok AI assistant",
		family: "openai-compatible",
		capabilities: ["reasoning"],
		defaultModelId: "grok-4.20-0309-non-reasoning",
		apiKeyEnv: ["XAI_API_KEY"],
		defaults: { baseUrl: "https://api.x.ai/v1" },
	},
	{
		id: "together",
		name: "Together AI",
		description: "Fast inference for open-source models",
		family: "openai-compatible",
		capabilities: ["reasoning"],
		defaultModelId: "Qwen/Qwen3.5-397B-A17B",
		apiKeyEnv: ["TOGETHER_API_KEY"],
		defaults: { baseUrl: "https://api.together.xyz/v1" },
	},
	{
		id: "fireworks",
		name: "Fireworks AI",
		description: "High-performance inference platform",
		family: "openai-compatible",
		defaultModelId: "accounts/fireworks/models/minimax-m2p5",
		apiKeyEnv: ["FIREWORKS_API_KEY"],
		defaults: { baseUrl: "https://api.fireworks.ai/inference/v1" },
	},
	{
		id: "groq",
		name: "Groq",
		description: "Ultra-fast LPU inference",
		family: "openai-compatible",
		defaultModelId: "moonshotai/kimi-k2-instruct-0905",
		apiKeyEnv: ["GROQ_API_KEY"],
		defaults: { baseUrl: "https://api.groq.com/openai/v1" },
	},
	{
		id: "cerebras",
		name: "Cerebras",
		description: "Fast inference on Cerebras wafer-scale chips",
		family: "openai-compatible",
		defaultModelId: "zai-glm-4.7",
		apiKeyEnv: ["CEREBRAS_API_KEY"],
		defaults: { baseUrl: "https://api.cerebras.ai/v1" },
	},
	{
		id: "sambanova",
		name: "SambaNova",
		description: "High-performance AI inference",
		family: "openai-compatible",
		apiKeyEnv: ["SAMBANOVA_API_KEY"],
		modelsProviderId: "sambanova",
		defaults: { baseUrl: "https://api.sambanova.ai/v1" },
	},
	{
		id: "nebius",
		name: "Nebius",
		description: "European cloud AI infrastructure",
		family: "openai-compatible",
		defaultModelId: "nvidia/nemotron-3-super-120b-a12b",
		apiKeyEnv: ["NEBIUS_API_KEY"],
		defaults: { baseUrl: "https://api.studio.nebius.ai/v1" },
	},
	{
		id: "baseten",
		name: "Baseten",
		description: "ML inference platform",
		family: "openai-compatible",
		apiKeyEnv: ["BASETEN_API_KEY"],
		modelsProviderId: "baseten",
		defaults: { baseUrl: "https://model-api.baseten.co/v1" },
	},
	{
		id: "requesty",
		name: "Requesty",
		description: "AI router with multiple provider support",
		family: "openai-compatible",
		capabilities: ["reasoning"],
		defaultModelId: "openai/gpt-5.4",
		apiKeyEnv: ["REQUESTY_API_KEY"],
		modelsProviderId: "requesty",
		defaults: { baseUrl: "https://router.requesty.ai/v1" },
	},
	{
		id: "litellm",
		name: "LiteLLM",
		description: "Self-hosted LLM proxy",
		family: "openai-compatible",
		protocol: "openai-responses",
		capabilities: ["prompt-cache"],
		defaultModelId: "gpt-5.4",
		apiKeyEnv: ["LITELLM_API_KEY"],
		defaults: { baseUrl: "http://localhost:4000/v1" },
	},
	{
		id: "huggingface",
		name: "Hugging Face",
		description: "Hugging Face inference API",
		family: "openai-compatible",
		defaultModelId: "MiniMaxAI/MiniMax-M2.5",
		apiKeyEnv: ["HF_TOKEN"],
		modelsProviderId: "huggingface",
		defaults: { baseUrl: "https://api-inference.huggingface.co/v1" },
	},
	{
		id: "vercel-ai-gateway",
		name: "Vercel AI Gateway",
		description: "Vercel's AI gateway service",
		family: "openai-compatible",
		capabilities: ["reasoning"],
		defaultModelId: "alibaba/qwen3.6-plus",
		apiKeyEnv: ["AI_GATEWAY_API_KEY"],
		modelsProviderId: "vercel-ai-gateway",
		defaults: { baseUrl: "https://ai-gateway.vercel.sh/v1" },
		metadata: { promptCacheStrategy: "anthropic-automatic" },
	},
	{
		id: "v0",
		name: "Vercel V0",
		description:
			"The Vercel provider gives you access to the v0 API, designed for building modern web applications.",
		family: "openai-compatible",
		protocol: "openai-responses",
		capabilities: ["reasoning", "tools"],
		defaultModelId: "v0-1.5-md",
		apiKeyEnv: ["V0_API_KEY"],
		modelsProviderId: "v0",
		defaults: { baseUrl: "https://api.v0.dev/v1" },
	},
	{
		id: "aihubmix",
		name: "AI Hub Mix",
		description: "AI model aggregator",
		family: "openai-compatible",
		defaultModelId: "gpt-4o",
		apiKeyEnv: ["AIHUBMIX_API_KEY"],
		modelsProviderId: "aihubmix",
		defaults: { baseUrl: "https://api.aihubmix.com/v1" },
		metadata: { promptCacheStrategy: "anthropic-automatic" },
	},
	{
		id: "hicap",
		name: "HiCap",
		description: "HiCap AI platform",
		family: "openai-compatible",
		defaultModelId: "hicap-pro",
		apiKeyEnv: ["HICAP_API_KEY"],
		defaults: { baseUrl: "https://api.hicap.ai/v1" },
	},
	{
		id: "nousResearch",
		name: "Nous Research",
		description: "Open-source AI research lab",
		family: "openai-compatible",
		defaultModelId: "DeepHermes-3-Llama-3-3-70B-Preview",
		apiKeyEnv: ["NOUS_RESEARCH_API_KEY", "NOUSRESEARCH_API_KEY"],
		modelsProviderId: "nousResearch",
		defaults: { baseUrl: "https://inference-api.nousresearch.com/v1" },
	},
	{
		id: "huawei-cloud-maas",
		name: "Huawei Cloud MaaS",
		description: "Huawei's model-as-a-service platform",
		family: "openai-compatible",
		defaultModelId: "DeepSeek-R1",
		apiKeyEnv: ["HUAWEI_CLOUD_MAAS_API_KEY"],
		defaults: {
			baseUrl: "https://infer-modelarts.cn-southwest-2.myhuaweicloud.com/v1",
		},
	},
	{
		id: "qwen",
		name: "Qwen Plus Latest",
		description: "Alibaba Qwen platform models",
		family: "openai-compatible",
		capabilities: ["tools", "reasoning"],
		defaultModelId: "qwen-plus-latest",
		apiKeyEnv: ["QWEN_API_KEY"],
		modelsProviderId: "qwen",
		defaults: { baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
	},
	{
		id: "qwen-code",
		name: "Qwen3 Coder Plus",
		description: "Qwen OAuth coding models",
		family: "openai-compatible",
		capabilities: ["tools", "reasoning"],
		defaultModelId: "qwen3-coder-plus",
		modelsProviderId: "qwen-code",
		defaults: { baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
	},
	{
		id: "doubao",
		name: "Doubao",
		description: "Volcengine Ark platform models",
		family: "openai-compatible",
		capabilities: ["tools"],
		defaultModelId: "doubao-1-5-pro-256k-250115",
		apiKeyEnv: ["DOUBAO_API_KEY"],
		modelsProviderId: "doubao",
		defaults: { baseUrl: "https://ark.cn-beijing.volces.com/api/v3" },
	},
	{
		id: "zai",
		name: "Z.AI",
		description: "Z.AI's family of LLMs",
		family: "openai-compatible",
		capabilities: ["reasoning"],
		defaultModelId: "glm-5v-turbo",
		apiKeyEnv: ["ZHIPU_API_KEY"],
		modelsProviderId: "zai",
		defaults: { baseUrl: "https://api.z.ai/api/paas/v4" },
	},
	{
		id: "zai-coding-plan",
		name: "Z.AI Coding Plan",
		description: "Z.AI's coding-focused models",
		family: "openai-compatible",
		capabilities: ["reasoning", "tools"],
		defaultModelId: "glm-5v-turbo",
		apiKeyEnv: ["ZHIPU_API_KEY"],
		modelsProviderId: "zai-coding-plan",
		defaults: { baseUrl: "https://api.z.ai/api/coding/paas/v4" },
	},
	{
		id: "moonshot",
		name: "Moonshot",
		description: "Moonshot AI Studio models",
		family: "openai-compatible",
		capabilities: ["tools", "reasoning"],
		defaultModelId: "kimi-k2-0905-preview",
		apiKeyEnv: ["MOONSHOT_API_KEY"],
		modelsProviderId: "moonshot",
		defaults: { baseUrl: "https://api.moonshot.ai/v1" },
	},
	{
		id: "wandb",
		name: "W&B by CoreWeave",
		description: "Weights & Biases",
		family: "openai-compatible",
		capabilities: ["reasoning", "prompt-cache", "tools"],
		defaultModelId: "nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-FP8",
		apiKeyEnv: ["WANDB_API_KEY"],
		modelsProviderId: "wandb",
		defaults: { baseUrl: "https://api.inference.wandb.ai/v1" },
	},
	{
		id: "xiaomi",
		name: "Xiaomi",
		description: "Xiaomi",
		family: "openai-compatible",
		protocol: "openai-responses",
		capabilities: ["prompt-cache", "tools", "reasoning"],
		defaultModelId: "mimo-v2-omni",
		apiKeyEnv: ["XIAOMI_API_KEY"],
		modelsProviderId: "xiaomi",
		defaults: { baseUrl: "https://api.xiaomimimo.com/v1" },
	},
	{
		id: "kilo",
		name: "Kilo Gateway",
		description: "Kilo Gateway",
		family: "openai-compatible",
		protocol: "openai-responses",
		capabilities: ["prompt-cache", "reasoning", "tools"],
		defaultModelId: "gpt-4o",
		apiKeyEnv: ["KILO_GATEWAY_API_KEY"],
		modelsProviderId: "kilo",
		defaults: { baseUrl: "https://api.kilo.ai/api/gateway" },
	},
	{
		id: "openrouter",
		name: "OpenRouter",
		description: "OpenRouter AI platform",
		family: "openai-compatible",
		capabilities: ["reasoning", "prompt-cache"],
		defaultModelId: "anthropic/claude-sonnet-4.6",
		apiKeyEnv: ["OPENROUTER_API_KEY"],
		modelsProviderId: "openrouter",
		docsUrl: "https://openrouter.ai/models",
		defaults: { baseUrl: "https://openrouter.ai/api/v1" },
		metadata: { promptCacheStrategy: "anthropic-automatic" },
	},
	{
		id: "ollama",
		name: "Ollama",
		description: "Ollama Cloud and local LLM hosting",
		family: "openai-compatible",
		defaultModelId: "",
		apiKeyEnv: ["OLLAMA_API_KEY"],
		defaults: { baseUrl: "http://localhost:11434/v1" },
	},
	{
		id: "lmstudio",
		name: "LM Studio",
		description: "Local model inference with LM Studio",
		family: "openai-compatible",
		defaultModelId: "",
		apiKeyEnv: ["LMSTUDIO_API_KEY"],
		modelsProviderId: "lmstudio",
		defaults: { baseUrl: "http://localhost:1234/v1" },
	},
	{
		id: "oca",
		name: "Oracle Code Assist",
		description: "Oracle Code Assist (OCA) LiteLLM gateway",
		family: "openai-compatible",
		capabilities: ["reasoning", "prompt-cache", "tools"],
		defaultModelId: "anthropic/claude-3-7-sonnet-20250219",
		apiKeyEnv: ["OCA_API_KEY"],
		modelsProviderId: "oca",
		defaults: { baseUrl: DEFAULT_EXTERNAL_OCA_BASE_URL },
		metadata: { promptCacheStrategy: "anthropic-automatic" },
	},
	{
		id: "asksage",
		name: "AskSage",
		description: "AskSage platform",
		family: "openai-compatible",
		client: "fetch",
		capabilities: ["tools"],
		defaultModelId: "gpt-4o",
		apiKeyEnv: ["ASKSAGE_API_KEY"],
		modelsFactory: () => ({}),
		defaults: { baseUrl: "https://api.asksage.ai/server" },
	},
	{
		id: "sapaicore",
		name: "SAP AI Core",
		description: "SAP AI Core inference and orchestration platform",
		family: "openai-compatible",
		client: "ai-sdk-community",
		capabilities: ["tools", "reasoning", "prompt-cache"],
		defaultModelId: "anthropic--claude-3.5-sonnet",
		apiKeyEnv: ["AICORE_SERVICE_KEY", "VCAP_SERVICES"],
		modelsProviderId: "sapaicore",
		metadata: { promptCacheStrategy: "anthropic-automatic" },
	},
];

export const BUILTIN_SPECS: BuiltinSpec[] = [
	{
		id: "openai-native",
		name: "OpenAI",
		description: "Creator of GPT and ChatGPT",
		family: "openai",
		capabilities: ["reasoning"],
		modelsProviderId: "openai-native",
		defaultModelId: "gpt-5.4",
		apiKeyEnv: ["OPENAI_API_KEY"],
		defaults: { baseUrl: "https://api.openai.com/v1" },
	},
	{
		id: "openai-codex",
		name: "OpenAI ChatGPT Subscription",
		description:
			"OpenAI ChatGPT subscription access uses an OAuth device code flow.",
		family: "openai",
		capabilities: ["reasoning", "oauth", "provider-tools"],
		defaultModelId: "gpt-5.4",
		modelsProviderId: "openai",
		defaults: { baseUrl: "https://chatgpt.com/backend-api/codex" },
	},
	{
		id: "openai-codex-cli",
		name: "OpenAI Codex CLI",
		description: "OpenAI Codex via the local Codex CLI provider",
		family: "openai-codex",
		capabilities: ["reasoning", "provider-tools"],
		defaultModelId: "gpt-5.3-codex",
		modelsProviderId: "openai",
		defaults: { baseUrl: "https://chatgpt.com/backend-api/codex" },
	},
	{
		id: "anthropic",
		name: "Anthropic",
		description: "Creator of Claude, the AI assistant",
		family: "anthropic",
		capabilities: ["reasoning", "prompt-cache"],
		defaultModelId: "claude-sonnet-4-6",
		apiKeyEnv: ["ANTHROPIC_API_KEY"],
		modelsProviderId: "anthropic",
		defaults: { baseUrl: "https://api.anthropic.com/v1" },
		metadata: { promptCacheStrategy: "anthropic-automatic" },
	},
	{
		id: "claude-code",
		name: "Claude Code",
		description: "Use Claude Code SDK with Claude Pro/Max subscription",
		family: "claude-code",
		capabilities: ["reasoning"],
		defaultModelId: "sonnet",
		modelsFactory: buildClaudeCodeModels,
		defaults: { baseUrl: "" },
	},
	{
		id: "gemini",
		name: "Google Gemini",
		description: "Google Gemini API",
		family: "google",
		capabilities: ["reasoning", "prompt-cache"],
		defaultModelId: "gemma-4-26b",
		apiKeyEnv: ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"],
		modelsProviderId: "gemini",
		defaults: { baseUrl: "https://generativelanguage.googleapis.com/v1beta" },
	},
	{
		id: "vertex",
		name: "Google Vertex AI",
		description: "Google Cloud Vertex AI",
		family: "vertex",
		capabilities: ["reasoning", "prompt-cache"],
		defaultModelId: "claude-sonnet-4-6@default",
		apiKeyEnv: [
			"GCP_PROJECT_ID",
			"GOOGLE_CLOUD_PROJECT",
			"GOOGLE_APPLICATION_CREDENTIALS",
			"GEMINI_API_KEY",
			"GOOGLE_API_KEY",
		],
		modelsProviderId: "vertex",
		metadata: { promptCacheStrategy: "anthropic-automatic" },
	},
	{
		id: "bedrock",
		name: "AWS Bedrock",
		description: "Amazon Bedrock managed foundation models",
		family: "bedrock",
		capabilities: ["reasoning", "prompt-cache"],
		defaultModelId: "minimax.minimax-m2.5",
		apiKeyEnv: [
			"AWS_REGION",
			"AWS_ACCESS_KEY_ID",
			"AWS_SECRET_ACCESS_KEY",
			"AWS_SESSION_TOKEN",
		],
		modelsProviderId: "bedrock",
		metadata: { promptCacheStrategy: "anthropic-automatic" },
	},
	{
		id: "mistral",
		name: "Mistral",
		description: "Mistral AI models via AI SDK provider",
		family: "mistral",
		capabilities: ["reasoning"],
		defaultModelId: "mistral-medium-latest",
		apiKeyEnv: ["MISTRAL_API_KEY"],
		modelsFactory: () => ({}),
		defaults: { baseUrl: "https://api.mistral.ai/v1" },
	},
	{
		id: "minimax",
		name: "MiniMax",
		description: "MiniMax models via Anthropic-compatible API",
		family: "anthropic",
		capabilities: ["tools", "reasoning", "prompt-cache"],
		defaultModelId: "MiniMax-M2.5",
		apiKeyEnv: ["MINIMAX_API_KEY"],
		modelsProviderId: "minimax",
		defaults: { baseUrl: "https://api.minimax.io/anthropic" },
		metadata: { promptCacheStrategy: "anthropic-automatic" },
	},
	{
		id: "opencode",
		name: "OpenCode",
		description: "OpenCode SDK multi-provider runtime",
		family: "opencode",
		capabilities: ["reasoning", "oauth"],
		defaultModelId: "openai/gpt-5.4",
		modelsProviderId: "opencode",
		defaults: { baseUrl: "" },
	},
	{
		id: "dify",
		name: "Dify",
		description: "Dify workflow/application provider via AI SDK",
		family: "dify",
		defaultModelId: "default",
		apiKeyEnv: ["DIFY_API_KEY"],
		modelsFactory: () => ({}),
	},
	...OPENAI_COMPATIBLE_SPECS,
];

function getModels(spec: BuiltinSpec): Record<string, ModelInfo> {
	if (spec.modelsFactory) {
		return spec.modelsFactory();
	}
	if (spec.modelsProviderId) {
		return generatedModels(spec.modelsProviderId);
	}
	return {};
}

function toModelCollection(spec: BuiltinSpec): ModelCollection {
	const sourceModels = getModels(spec);
	const models =
		Object.keys(sourceModels).length > 0
			? sourceModels
			: spec.defaultModelId
				? {
						[spec.defaultModelId]: {
							id: spec.defaultModelId,
							name: spec.defaultModelId,
						},
					}
				: {};
	const modelIds = Object.keys(models);
	const defaultModelId = spec.defaultModelId || modelIds[0] || "default";

	return {
		provider: {
			id: spec.id,
			name: spec.name,
			description: spec.description,
			protocol: spec.protocol ?? inferProtocol(spec),
			baseUrl: spec.defaults?.baseUrl,
			defaultModelId,
			capabilities: spec.capabilities,
			env: spec.apiKeyEnv ? [...spec.apiKeyEnv] : undefined,
			client: spec.client ?? inferClient(spec),
			source: "system",
		},
		models,
	};
}

export function toManifest(spec: BuiltinSpec): GatewayProviderManifest {
	const collection = toModelCollection(spec);
	const models = Object.values(collection.models).map((info) =>
		modelInfoToGateway(spec.id, info),
	);
	const resolvedModels =
		models.length > 0
			? models
			: [
					{
						id: collection.provider.defaultModelId || "default",
						name: collection.provider.defaultModelId || "Default",
						providerId: spec.id,
						capabilities: ["text"] as GatewayModelCapability[],
					},
				];

	return {
		id: spec.id,
		name: spec.name,
		description: spec.description,
		defaultModelId:
			collection.provider.defaultModelId || resolvedModels[0]?.id || "default",
		models: resolvedModels,
		capabilities: spec.capabilities,
		env: spec.env ?? ["browser", "node"],
		api: spec.defaults?.baseUrl,
		apiKeyEnv: spec.apiKeyEnv,
		docsUrl: spec.docsUrl,
		metadata: spec.metadata,
	};
}

export const BUILTIN_PROVIDER_COLLECTION_LIST: ModelCollection[] =
	BUILTIN_SPECS.map(toModelCollection);

export const BUILTIN_PROVIDER_COLLECTIONS_BY_ID: Record<
	string,
	ModelCollection
> = Object.fromEntries(
	BUILTIN_PROVIDER_COLLECTION_LIST.map((collection) => [
		collection.provider.id,
		collection,
	]),
);
