import { Anthropic } from "@anthropic-ai/sdk"
import { ApiConfiguration, ModelInfo } from "../shared/api"
import { AnthropicHandler } from "./providers/anthropic"
import { AwsBedrockHandler } from "./providers/bedrock"
import { OpenRouterHandler } from "./providers/openrouter"
import { VertexHandler } from "./providers/vertex"
import { OpenAiHandler } from "./providers/openai"
import { OllamaHandler } from "./providers/ollama"
import { LmStudioHandler } from "./providers/lmstudio"
import { GeminiHandler } from "./providers/gemini"
import { OpenAiNativeHandler } from "./providers/openai-native"
import { ApiStream, ApiStreamUsageChunk } from "./transform/stream"
import { DeepSeekHandler } from "./providers/deepseek"
import { RequestyHandler } from "./providers/requesty"
import { TogetherHandler } from "./providers/together"
import { NebiusHandler } from "./providers/nebius"
import { QwenHandler } from "./providers/qwen"
import { MistralHandler } from "./providers/mistral"
import { DoubaoHandler } from "./providers/doubao"
import { VsCodeLmHandler } from "./providers/vscode-lm"
import { ClineHandler } from "./providers/cline"
import { LiteLlmHandler } from "./providers/litellm"
import { FireworksHandler } from "./providers/fireworks"
import { AskSageHandler } from "./providers/asksage"
import { XAIHandler } from "./providers/xai"
import { SambanovaHandler } from "./providers/sambanova"
import { CerebrasHandler } from "./providers/cerebras"
import { SapAiCoreHandler } from "./providers/sapaicore"
import { ClaudeCodeHandler } from "./providers/claude-code"

export interface ApiHandler {
	createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream
	getModel(): { id: string; info: ModelInfo }
	getApiStreamUsage?(): Promise<ApiStreamUsageChunk | undefined>
}

export interface SingleCompletionHandler {
	completePrompt(prompt: string): Promise<string>
}

function createHandlerForProvider(apiProvider: string | undefined, options: Omit<ApiConfiguration, "apiProvider">): ApiHandler {
	switch (apiProvider) {
		case "anthropic":
			return new AnthropicHandler({
				apiKey: options.apiKey,
				anthropicBaseUrl: options.anthropicBaseUrl,
				apiModelId: options.apiModelId,
				thinkingBudgetTokens: options.thinkingBudgetTokens,
			})
		case "openrouter":
			return new OpenRouterHandler({
				openRouterApiKey: options.openRouterApiKey,
				openRouterModelId: options.openRouterModelId,
				openRouterModelInfo: options.openRouterModelInfo,
				openRouterProviderSorting: options.openRouterProviderSorting,
				reasoningEffort: options.reasoningEffort,
				thinkingBudgetTokens: options.thinkingBudgetTokens,
			})
		case "bedrock":
			return new AwsBedrockHandler({
				apiModelId: options.apiModelId,
				awsAccessKey: options.awsAccessKey,
				awsSecretKey: options.awsSecretKey,
				awsSessionToken: options.awsSessionToken,
				awsRegion: options.awsRegion,
				awsUseCrossRegionInference: options.awsUseCrossRegionInference,
				awsBedrockUsePromptCache: options.awsBedrockUsePromptCache,
				awsUseProfile: options.awsUseProfile,
				awsProfile: options.awsProfile,
				awsBedrockEndpoint: options.awsBedrockEndpoint,
				awsBedrockCustomSelected: options.awsBedrockCustomSelected,
				awsBedrockCustomModelBaseId: options.awsBedrockCustomModelBaseId,
				thinkingBudgetTokens: options.thinkingBudgetTokens,
			})
		case "vertex":
			return new VertexHandler({
				vertexProjectId: options.vertexProjectId,
				vertexRegion: options.vertexRegion,
				apiModelId: options.apiModelId,
				thinkingBudgetTokens: options.thinkingBudgetTokens,
				geminiApiKey: options.geminiApiKey,
				geminiBaseUrl: options.geminiBaseUrl,
				taskId: options.taskId,
			})
		case "openai":
			return new OpenAiHandler({
				openAiApiKey: options.openAiApiKey,
				openAiBaseUrl: options.openAiBaseUrl,
				azureApiVersion: options.azureApiVersion,
				openAiHeaders: options.openAiHeaders,
				openAiModelId: options.openAiModelId,
				openAiModelInfo: options.openAiModelInfo,
				reasoningEffort: options.reasoningEffort,
			})
		case "ollama":
			return new OllamaHandler({
				ollamaBaseUrl: options.ollamaBaseUrl,
				ollamaModelId: options.ollamaModelId,
				ollamaApiOptionsCtxNum: options.ollamaApiOptionsCtxNum,
				requestTimeoutMs: options.requestTimeoutMs,
			})
		case "lmstudio":
			return new LmStudioHandler({
				lmStudioBaseUrl: options.lmStudioBaseUrl,
				lmStudioModelId: options.lmStudioModelId,
			})
		case "gemini":
			return new GeminiHandler({
				vertexProjectId: options.vertexProjectId,
				vertexRegion: options.vertexRegion,
				geminiApiKey: options.geminiApiKey,
				geminiBaseUrl: options.geminiBaseUrl,
				thinkingBudgetTokens: options.thinkingBudgetTokens,
				apiModelId: options.apiModelId,
				taskId: options.taskId,
			})
		case "openai-native":
			return new OpenAiNativeHandler({
				openAiNativeApiKey: options.openAiNativeApiKey,
				reasoningEffort: options.reasoningEffort,
				apiModelId: options.apiModelId,
			})
		case "deepseek":
			return new DeepSeekHandler({
				deepSeekApiKey: options.deepSeekApiKey,
				apiModelId: options.apiModelId,
			})
		case "requesty":
			return new RequestyHandler({
				requestyApiKey: options.requestyApiKey,
				reasoningEffort: options.reasoningEffort,
				thinkingBudgetTokens: options.thinkingBudgetTokens,
				requestyModelId: options.requestyModelId,
				requestyModelInfo: options.requestyModelInfo,
			})
		case "fireworks":
			return new FireworksHandler({
				fireworksApiKey: options.fireworksApiKey,
				fireworksModelId: options.fireworksModelId,
				fireworksModelMaxCompletionTokens: options.fireworksModelMaxCompletionTokens,
				fireworksModelMaxTokens: options.fireworksModelMaxTokens,
			})
		case "together":
			return new TogetherHandler({
				togetherApiKey: options.togetherApiKey,
				togetherModelId: options.togetherModelId,
			})
		case "qwen":
			return new QwenHandler({
				qwenApiKey: options.qwenApiKey,
				qwenApiLine: options.qwenApiLine,
				apiModelId: options.apiModelId,
				thinkingBudgetTokens: options.thinkingBudgetTokens,
			})
		case "doubao":
			return new DoubaoHandler({
				doubaoApiKey: options.doubaoApiKey,
				apiModelId: options.apiModelId,
			})
		case "mistral":
			return new MistralHandler({
				mistralApiKey: options.mistralApiKey,
				apiModelId: options.apiModelId,
			})
		case "vscode-lm":
			return new VsCodeLmHandler({
				vsCodeLmModelSelector: options.vsCodeLmModelSelector,
			})
		case "cline":
			return new ClineHandler({
				taskId: options.taskId,
				reasoningEffort: options.reasoningEffort,
				thinkingBudgetTokens: options.thinkingBudgetTokens,
				openRouterProviderSorting: options.openRouterProviderSorting,
				openRouterModelId: options.openRouterModelId,
				openRouterModelInfo: options.openRouterModelInfo,
			})
		case "litellm":
			return new LiteLlmHandler({
				liteLlmApiKey: options.liteLlmApiKey,
				liteLlmBaseUrl: options.liteLlmBaseUrl,
				liteLlmModelId: options.liteLlmModelId,
				liteLlmModelInfo: options.liteLlmModelInfo,
				thinkingBudgetTokens: options.thinkingBudgetTokens,
				liteLlmUsePromptCache: options.liteLlmUsePromptCache,
				taskId: options.taskId,
			})
		case "nebius":
			return new NebiusHandler({
				nebiusApiKey: options.nebiusApiKey,
				apiModelId: options.apiModelId,
			})
		case "asksage":
			return new AskSageHandler({
				asksageApiKey: options.asksageApiKey,
				asksageApiUrl: options.asksageApiUrl,
				apiModelId: options.apiModelId,
			})
		case "xai":
			return new XAIHandler({
				xaiApiKey: options.xaiApiKey,
				reasoningEffort: options.reasoningEffort,
				apiModelId: options.apiModelId,
			})
		case "sambanova":
			return new SambanovaHandler({
				sambanovaApiKey: options.sambanovaApiKey,
				apiModelId: options.apiModelId,
			})
		case "cerebras":
			return new CerebrasHandler({
				cerebrasApiKey: options.cerebrasApiKey,
				apiModelId: options.apiModelId,
			})
		case "sapaicore":
			return new SapAiCoreHandler({
				sapAiCoreClientId: options.sapAiCoreClientId,
				sapAiCoreClientSecret: options.sapAiCoreClientSecret,
				sapAiCoreTokenUrl: options.sapAiCoreTokenUrl,
				sapAiResourceGroup: options.sapAiResourceGroup,
				sapAiCoreBaseUrl: options.sapAiCoreBaseUrl,
				apiModelId: options.apiModelId,
			})
		case "claude-code":
			return new ClaudeCodeHandler({
				claudeCodePath: options.claudeCodePath,
				apiModelId: options.apiModelId,
				thinkingBudgetTokens: options.thinkingBudgetTokens,
			})
		default:
			return new AnthropicHandler({
				apiKey: options.apiKey,
				anthropicBaseUrl: options.anthropicBaseUrl,
				apiModelId: options.apiModelId,
				thinkingBudgetTokens: options.thinkingBudgetTokens,
			})
	}
}

export function buildApiHandler(configuration: ApiConfiguration): ApiHandler {
	const { apiProvider, ...options } = configuration

	// Validate thinking budget tokens against model's maxTokens to prevent API errors
	// wrapped in a try-catch for safety, but this should never throw
	try {
		if (options.thinkingBudgetTokens && options.thinkingBudgetTokens > 0) {
			const handler = createHandlerForProvider(apiProvider, options)

			const modelInfo = handler.getModel().info
			if (modelInfo.maxTokens && options.thinkingBudgetTokens > modelInfo.maxTokens) {
				const clippedValue = modelInfo.maxTokens - 1
				options.thinkingBudgetTokens = clippedValue
			} else {
				return handler // don't rebuild unless its necessary
			}
		}
	} catch (error) {
		console.error("buildApiHandler error:", error)
	}

	return createHandlerForProvider(apiProvider, options)
}
