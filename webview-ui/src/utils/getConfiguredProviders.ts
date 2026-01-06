import { ApiConfiguration, ApiProvider } from "@shared/api"
import PROVIDERS from "@shared/providers/providers.json"

/**
 * Returns a list of API providers that are configured (have required credentials/settings)
 * Based on validation logic from validate.ts
 */
export function getConfiguredProviders(apiConfiguration: ApiConfiguration | undefined): ApiProvider[] {
	const configured: ApiProvider[] = []

	if (!apiConfiguration) {
		return ["cline"] // Cline is always available
	}

	// Cline - always available (uses account-based auth)
	configured.push("cline")

	// Anthropic - requires API key
	if (apiConfiguration.apiKey) {
		configured.push("anthropic")
	}

	// OpenRouter - requires API key
	if (apiConfiguration.openRouterApiKey) {
		configured.push("openrouter")
	}

	// Bedrock - requires region
	if (apiConfiguration.awsRegion) {
		configured.push("bedrock")
	}

	// Vertex - requires project ID and region
	if (apiConfiguration.vertexProjectId && apiConfiguration.vertexRegion) {
		configured.push("vertex")
	}

	// Gemini - requires API key
	if (apiConfiguration.geminiApiKey) {
		configured.push("gemini")
	}

	// OpenAI Native - requires API key
	if (apiConfiguration.openAiNativeApiKey) {
		configured.push("openai-native")
	}

	// DeepSeek - requires API key
	if (apiConfiguration.deepSeekApiKey) {
		configured.push("deepseek")
	}

	// xAI - requires API key
	if (apiConfiguration.xaiApiKey) {
		configured.push("xai")
	}

	// Qwen - requires API key
	if (apiConfiguration.qwenApiKey) {
		configured.push("qwen")
	}

	// Doubao - requires API key
	if (apiConfiguration.doubaoApiKey) {
		configured.push("doubao")
	}

	// Mistral - requires API key
	if (apiConfiguration.mistralApiKey) {
		configured.push("mistral")
	}

	// Requesty - requires API key
	if (apiConfiguration.requestyApiKey) {
		configured.push("requesty")
	}

	// Fireworks - requires API key
	if (apiConfiguration.fireworksApiKey) {
		configured.push("fireworks")
	}

	// Together - requires API key
	if (apiConfiguration.togetherApiKey) {
		configured.push("together")
	}

	// Moonshot - requires API key
	if (apiConfiguration.moonshotApiKey) {
		configured.push("moonshot")
	}

	// Nebius - requires API key
	if (apiConfiguration.nebiusApiKey) {
		configured.push("nebius")
	}

	// AskSage - requires API key
	if (apiConfiguration.asksageApiKey) {
		configured.push("asksage")
	}

	// SambaNova - requires API key
	if (apiConfiguration.sambanovaApiKey) {
		configured.push("sambanova")
	}

	// Cerebras - requires API key
	if (apiConfiguration.cerebrasApiKey) {
		configured.push("cerebras")
	}

	// SAP AI Core - requires base URL, client ID, client secret, and token URL
	if (
		apiConfiguration.sapAiCoreBaseUrl &&
		apiConfiguration.sapAiCoreClientId &&
		apiConfiguration.sapAiCoreClientSecret &&
		apiConfiguration.sapAiCoreTokenUrl
	) {
		configured.push("sapaicore")
	}

	// Z AI - requires API key
	if (apiConfiguration.zaiApiKey) {
		configured.push("zai")
	}

	// Groq - requires API key
	if (apiConfiguration.groqApiKey) {
		configured.push("groq")
	}

	// Hugging Face - requires API key
	if (apiConfiguration.huggingFaceApiKey) {
		configured.push("huggingface")
	}

	// Baseten - requires API key
	if (apiConfiguration.basetenApiKey) {
		configured.push("baseten")
	}

	// Dify - requires base URL and API key
	if (apiConfiguration.difyBaseUrl && apiConfiguration.difyApiKey) {
		configured.push("dify")
	}

	// Minimax - requires API key
	if (apiConfiguration.minimaxApiKey) {
		configured.push("minimax")
	}

	// Hicap - requires API key
	if (apiConfiguration.hicapApiKey) {
		configured.push("hicap")
	}

	// Huawei Cloud MaaS - requires API key
	if (apiConfiguration.huaweiCloudMaasApiKey) {
		configured.push("huawei-cloud-maas")
	}

	// Vercel AI Gateway - requires API key
	if (apiConfiguration.vercelAiGatewayApiKey) {
		configured.push("vercel-ai-gateway")
	}

	// AIHubMix - requires API key
	if (apiConfiguration.aihubmixApiKey) {
		configured.push("aihubmix")
	}

	// NousResearch - requires API key
	if (apiConfiguration.nousResearchApiKey) {
		configured.push("nousResearch")
	}

	// OpenAI Compatible - requires base URL and API key, OR has model configured
	if (
		(apiConfiguration.openAiBaseUrl && apiConfiguration.openAiApiKey) ||
		apiConfiguration.planModeOpenAiModelId ||
		apiConfiguration.actModeOpenAiModelId
	) {
		configured.push("openai")
	}

	// Ollama - local provider, check base URL OR model configured
	if (apiConfiguration.ollamaBaseUrl || apiConfiguration.planModeOllamaModelId || apiConfiguration.actModeOllamaModelId) {
		configured.push("ollama")
	}

	// LM Studio - local provider, check base URL OR model configured
	if (apiConfiguration.lmStudioBaseUrl || apiConfiguration.planModeLmStudioModelId || apiConfiguration.actModeLmStudioModelId) {
		configured.push("lmstudio")
	}

	// LiteLLM - check base URL OR model configured
	if (apiConfiguration.liteLlmBaseUrl || apiConfiguration.planModeLiteLlmModelId || apiConfiguration.actModeLiteLlmModelId) {
		configured.push("litellm")
	}

	// VSCode LM - always potentially available
	configured.push("vscode-lm")

	// Claude Code - requires path
	if (apiConfiguration.claudeCodePath) {
		configured.push("claude-code")
	}

	// Qwen Code - requires API key (same as Qwen)
	if (apiConfiguration.qwenApiKey) {
		configured.push("qwen-code")
	}

	// OCA - requires base URL
	if (apiConfiguration.ocaBaseUrl) {
		configured.push("oca")
	}

	return configured
}

/**
 * Get provider display label from provider value
 * Uses the canonical providers.json as source of truth
 */
export function getProviderLabel(provider: ApiProvider): string {
	const providerEntry = PROVIDERS.list.find((p) => p.value === provider)
	return providerEntry?.label || provider
}
