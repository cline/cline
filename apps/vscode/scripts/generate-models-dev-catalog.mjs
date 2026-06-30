import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");
const sdkCatalogPath = path.join(
	repoRoot,
	"sdk/packages/llms/src/catalog/catalog.generated.ts",
);
const outputPath = path.join(
	__dirname,
	"../src/shared/models/models-dev-catalog.generated.ts",
);

const { GENERATED_PROVIDER_MODELS } = await import(
	pathToFileURL(sdkCatalogPath).href
);

const providerLabels = Object.fromEntries([
	["anthropic", "Anthropic"],
	["bedrock", "Amazon Bedrock"],
	["vertex", "GCP Vertex AI"],
	["gemini", "Google Gemini"],
	["openai-native", "OpenAI"],
	["openai-codex", "ChatGPT Subscription"],
	["deepseek", "DeepSeek"],
	["xai", "xAI"],
	["together", "Together"],
	["sapaicore", "SAP AI Core"],
	["fireworks", "Fireworks AI"],
	["groq", "Groq"],
	["cerebras", "Cerebras"],
	["sambanova", "SambaNova"],
	["nebius", "Nebius AI Studio"],
	["huggingface", "Hugging Face"],
	["openrouter", "OpenRouter"],
	["vercel-ai-gateway", "Vercel AI Gateway"],
	["aihubmix", "AIhubmix"],
	["baseten", "Baseten"],
	["zai", "Z AI"],
	["lmstudio", "LM Studio"],
	["requesty", "Requesty"],
	["moonshot", "Moonshot"],
	["minimax", "MiniMax"],
	["wandb", "W&B Inference by CoreWeave"],
	["mistral", "Mistral"],
	["doubao", "Bytedance Doubao"],
	["qwen", "Alibaba Qwen"],
	["huawei-cloud-maas", "Huawei Cloud MaaS"],
	["hicap", "Hicap"],
	["nousResearch", "NousResearch"],
	["openai", "OpenAI Compatible"],
	["ollama", "Ollama"],
	["litellm", "LiteLLM"],
	["claude-code", "Claude Code"],
	["qwen-code", "Qwen Code"],
	["dify", "Dify.ai"],
	["oca", "Oracle Code Assist"],
	["vscode-lm", "GitHub Copilot"],
	["cline", "Cline"],
	["cline-pass", "ClinePass"],
	["asksage", "AskSage"],
]);

const providerOrder = [
	"cline",
	"cline-pass",
	"openai-codex",
	"gemini",
	"openai",
	"anthropic",
	"bedrock",
	"vscode-lm",
	"deepseek",
	"openai-native",
	"openrouter",
	"ollama",
	"vertex",
	"litellm",
	"claude-code",
	"sapaicore",
	"mistral",
	"zai",
	"groq",
	"cerebras",
	"vercel-ai-gateway",
	"baseten",
	"requesty",
	"fireworks",
	"together",
	"qwen",
	"qwen-code",
	"doubao",
	"lmstudio",
	"moonshot",
	"huggingface",
	"nebius",
	"asksage",
	"xai",
	"sambanova",
	"huawei-cloud-maas",
	"dify",
	"oca",
	"minimax",
	"hicap",
	"aihubmix",
	"nousResearch",
	"wandb",
];

function toLegacyModelInfo(model) {
	const capabilities = new Set(model.capabilities ?? []);
	const output = {
		name: model.name,
		maxTokens: model.maxTokens,
		contextWindow: model.contextWindow ?? model.maxInputTokens,
		supportsImages: capabilities.has("images"),
		supportsPromptCache: capabilities.has("prompt-cache"),
		supportsReasoning: capabilities.has("reasoning"),
		inputPrice: model.pricing?.input ?? 0,
		outputPrice: model.pricing?.output ?? 0,
		cacheWritesPrice: model.pricing?.cacheWrite ?? 0,
		cacheReadsPrice: model.pricing?.cacheRead ?? 0,
		supportsTools: capabilities.has("tools"),
	};

	for (const key of Object.keys(output)) {
		if (output[key] === undefined) {
			delete output[key];
		}
	}

	return output;
}

const providerModels = Object.fromEntries(
	Object.entries(GENERATED_PROVIDER_MODELS.providers).map(
		([providerId, models]) => [
			providerId,
			Object.fromEntries(
				Object.entries(models).map(([modelId, model]) => [
					modelId,
					toLegacyModelInfo(model),
				]),
			),
		],
	),
);

const providerOptions = providerOrder
	.filter((value) => providerLabels[value])
	.map((value) => ({ value, label: providerLabels[value] }));

const file = `/**
 * Auto-generated from @cline/llms models.dev catalog.
 *
 * Source: sdk/packages/llms/src/catalog/catalog.generated.ts
 * Do not edit by hand; run apps/vscode/scripts/generate-models-dev-catalog.mjs after updating the SDK model catalog.
 */

import type { ApiProvider, ModelInfo, OpenAiCompatibleModelInfo } from "../api"

export const modelsDevProviderModels = ${JSON.stringify(providerModels, null, "\t")} as const satisfies Record<string, Record<string, ModelInfo | OpenAiCompatibleModelInfo>>

export const modelsDevProviderOptions = ${JSON.stringify(providerOptions, null, "\t")} as const satisfies ReadonlyArray<{ value: ApiProvider; label: string }>

export function getModelsDevProviderModels(provider: ApiProvider | string): Record<string, ModelInfo> {
\treturn (modelsDevProviderModels[provider as keyof typeof modelsDevProviderModels] ?? {}) as Record<string, ModelInfo>
}

export const modelsDevAnthropicModels = getModelsDevProviderModels("anthropic")
export const modelsDevBedrockModels = getModelsDevProviderModels("bedrock")
export const modelsDevCerebrasModels = getModelsDevProviderModels("cerebras")
export const modelsDevDeepSeekModels = getModelsDevProviderModels("deepseek")
export const modelsDevDoubaoModels = getModelsDevProviderModels("doubao")
export const modelsDevFireworksModels = getModelsDevProviderModels("fireworks")
export const modelsDevGeminiModels = getModelsDevProviderModels("gemini")
export const modelsDevGroqModels = getModelsDevProviderModels("groq")
export const modelsDevHuggingFaceModels = getModelsDevProviderModels("huggingface")
export const modelsDevMinimaxModels = getModelsDevProviderModels("minimax")
export const modelsDevMistralModels = getModelsDevProviderModels("mistral")
export const modelsDevMoonshotModels = getModelsDevProviderModels("moonshot")
export const modelsDevNebiusModels = getModelsDevProviderModels("nebius")
export const modelsDevNousResearchModels = getModelsDevProviderModels("nousResearch")
export const modelsDevOpenAiCodexModels = getModelsDevProviderModels("openai-codex")
export const modelsDevOpenAiNativeModels = getModelsDevProviderModels("openai-native")
export const modelsDevSambanovaModels = getModelsDevProviderModels("sambanova")
export const modelsDevSapAiCoreModels = getModelsDevProviderModels("sapaicore")
export const modelsDevVertexModels = getModelsDevProviderModels("vertex")
export const modelsDevWandbModels = getModelsDevProviderModels("wandb")
export const modelsDevXaiModels = getModelsDevProviderModels("xai")
`;

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, file);
