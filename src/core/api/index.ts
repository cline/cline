import { Anthropic } from "@anthropic-ai/sdk"
import { ApiConfiguration, ModelInfo, QwenApiRegions } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { AnthropicHandler } from "./providers/anthropic"
import { AskSageHandler } from "./providers/asksage"
import { BasetenHandler } from "./providers/baseten"
import { AwsBedrockHandler } from "./providers/bedrock"
import { CerebrasHandler } from "./providers/cerebras"
import { ClaudeCodeHandler } from "./providers/claude-code"
import { ClineHandler } from "./providers/cline"
import { DeepSeekHandler } from "./providers/deepseek"
import { DoubaoHandler } from "./providers/doubao"
import { FireworksHandler } from "./providers/fireworks"
import { GeminiHandler } from "./providers/gemini"
import { GroqHandler } from "./providers/groq"
import { HuaweiCloudMaaSHandler } from "./providers/huawei-cloud-maas"
import { HuggingFaceHandler } from "./providers/huggingface"
import { LiteLlmHandler } from "./providers/litellm"
import { LmStudioHandler } from "./providers/lmstudio"
import { MistralHandler } from "./providers/mistral"
import { MoonshotHandler } from "./providers/moonshot"
import { NebiusHandler } from "./providers/nebius"
import { OllamaHandler } from "./providers/ollama"
import { OpenAiHandler } from "./providers/openai"
import { OpenAiNativeHandler } from "./providers/openai-native"
import { OpenRouterHandler } from "./providers/openrouter"
import { QwenHandler } from "./providers/qwen"
import { QwenCodeHandler } from "./providers/qwen-code"
import { RequestyHandler } from "./providers/requesty"
import { SambanovaHandler } from "./providers/sambanova"
import { SapAiCoreHandler } from "./providers/sapaicore"
import { TogetherHandler } from "./providers/together"
import { VercelAIGatewayHandler } from "./providers/vercel-ai-gateway"
import { VertexHandler } from "./providers/vertex"
import { VsCodeLmHandler } from "./providers/vscode-lm"
import { XAIHandler } from "./providers/xai"
import { ZAiHandler } from "./providers/zai"
import { ApiStream, ApiStreamUsageChunk } from "./transform/stream"

export interface ApiHandler {
	createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream
	getModel(): ApiHandlerModel
	getApiStreamUsage?(): Promise<ApiStreamUsageChunk | undefined>
}

export interface ApiHandlerModel {
	id: string
	info: ModelInfo
}

export interface ApiProviderInfo {
	modelId: string
	providerId: string
	customPrompt?: string
}

export interface SingleCompletionHandler {
	completePrompt(prompt: string): Promise<string>
}

function createHandlerForProvider(
	apiProvider: string | undefined,
	options: Omit<ApiConfiguration, "apiProvider">,
	mode: Mode,
): ApiHandler {
	const commonOptions: Partial<typeof options> = {
		onRetryAttempt: options.onRetryAttempt,
	}

	switch (apiProvider) {
		case "anthropic":
			return new AnthropicHandler({
				...commonOptions,
				apiKey: options.apiKey,
				anthropicBaseUrl: options.anthropicBaseUrl,
				apiModelId: mode === "plan" ? options.planModeApiModelId : options.actModeApiModelId,
				thinkingBudgetTokens:
					mode === "plan" ? options.planModeThinkingBudgetTokens : options.actModeThinkingBudgetTokens,
			})
		case "openrouter":
			return new OpenRouterHandler({
				...commonOptions,
				openRouterApiKey: options.openRouterApiKey,
				openRouterModelId: mode === "plan" ? options.planModeOpenRouterModelId : options.actModeOpenRouterModelId,
				openRouterModelInfo: mode === "plan" ? options.planModeOpenRouterModelInfo : options.actModeOpenRouterModelInfo,
				openRouterProviderSorting: options.openRouterProviderSorting,
				reasoningEffort: mode === "plan" ? options.planModeReasoningEffort : options.actModeReasoningEffort,
				thinkingBudgetTokens:
					mode === "plan" ? options.planModeThinkingBudgetTokens : options.actModeThinkingBudgetTokens,
			})
		case "bedrock":
			return new AwsBedrockHandler({
				...commonOptions,
				apiModelId: mode === "plan" ? options.planModeApiModelId : options.actModeApiModelId,
				awsAccessKey: options.awsAccessKey,
				awsSecretKey: options.awsSecretKey,
				awsSessionToken: options.awsSessionToken,
				awsRegion: options.awsRegion,
				awsAuthentication: options.awsAuthentication,
				awsBedrockApiKey: options.awsBedrockApiKey,
				awsUseCrossRegionInference: options.awsUseCrossRegionInference,
				awsBedrockUsePromptCache: options.awsBedrockUsePromptCache,
				awsUseProfile: options.awsUseProfile,
				awsProfile: options.awsProfile,
				awsBedrockEndpoint: options.awsBedrockEndpoint,
				awsBedrockCustomSelected:
					mode === "plan" ? options.planModeAwsBedrockCustomSelected : options.actModeAwsBedrockCustomSelected,
				awsBedrockCustomModelBaseId:
					mode === "plan" ? options.planModeAwsBedrockCustomModelBaseId : options.actModeAwsBedrockCustomModelBaseId,
				thinkingBudgetTokens:
					mode === "plan" ? options.planModeThinkingBudgetTokens : options.actModeThinkingBudgetTokens,
			})
		case "vertex":
			return new VertexHandler({
				...commonOptions,
				vertexProjectId: options.vertexProjectId,
				vertexRegion: options.vertexRegion,
				apiModelId: mode === "plan" ? options.planModeApiModelId : options.actModeApiModelId,
				thinkingBudgetTokens:
					mode === "plan" ? options.planModeThinkingBudgetTokens : options.actModeThinkingBudgetTokens,
				geminiApiKey: options.geminiApiKey,
				geminiBaseUrl: options.geminiBaseUrl,
				ulid: options.ulid,
			})
		case "openai":
			return new OpenAiHandler({
				...commonOptions,
				openAiApiKey: options.openAiApiKey,
				openAiBaseUrl: options.openAiBaseUrl,
				azureApiVersion: options.azureApiVersion,
				openAiHeaders: options.openAiHeaders,
				openAiModelId: mode === "plan" ? options.planModeOpenAiModelId : options.actModeOpenAiModelId,
				openAiModelInfo: mode === "plan" ? options.planModeOpenAiModelInfo : options.actModeOpenAiModelInfo,
				reasoningEffort: mode === "plan" ? options.planModeReasoningEffort : options.actModeReasoningEffort,
			})
		case "ollama":
			return new OllamaHandler({
				...commonOptions,
				ollamaBaseUrl: options.ollamaBaseUrl,
				ollamaApiKey: options.ollamaApiKey,
				ollamaModelId: mode === "plan" ? options.planModeOllamaModelId : options.actModeOllamaModelId,
				ollamaApiOptionsCtxNum: options.ollamaApiOptionsCtxNum,
				requestTimeoutMs: options.requestTimeoutMs,
			})
		case "lmstudio":
			return new LmStudioHandler({
				...commonOptions,
				lmStudioBaseUrl: options.lmStudioBaseUrl,
				lmStudioModelId: mode === "plan" ? options.planModeLmStudioModelId : options.actModeLmStudioModelId,
				lmStudioMaxTokens: options.lmStudioMaxTokens,
			})
		case "gemini":
			return new GeminiHandler({
				...commonOptions,
				vertexProjectId: options.vertexProjectId,
				vertexRegion: options.vertexRegion,
				geminiApiKey: options.geminiApiKey,
				geminiBaseUrl: options.geminiBaseUrl,
				thinkingBudgetTokens:
					mode === "plan" ? options.planModeThinkingBudgetTokens : options.actModeThinkingBudgetTokens,
				apiModelId: mode === "plan" ? options.planModeApiModelId : options.actModeApiModelId,
				ulid: options.ulid,
			})
		case "openai-native":
			return new OpenAiNativeHandler({
				...commonOptions,
				openAiNativeApiKey: options.openAiNativeApiKey,
				reasoningEffort: mode === "plan" ? options.planModeReasoningEffort : options.actModeReasoningEffort,
				apiModelId: mode === "plan" ? options.planModeApiModelId : options.actModeApiModelId,
			})
		case "deepseek":
			return new DeepSeekHandler({
				...commonOptions,
				deepSeekApiKey: options.deepSeekApiKey,
				apiModelId: mode === "plan" ? options.planModeApiModelId : options.actModeApiModelId,
			})
		case "requesty":
			return new RequestyHandler({
				...commonOptions,
				requestyBaseUrl: options.requestyBaseUrl,
				requestyApiKey: options.requestyApiKey,
				reasoningEffort: mode === "plan" ? options.planModeReasoningEffort : options.actModeReasoningEffort,
				thinkingBudgetTokens:
					mode === "plan" ? options.planModeThinkingBudgetTokens : options.actModeThinkingBudgetTokens,
				requestyModelId: mode === "plan" ? options.planModeRequestyModelId : options.actModeRequestyModelId,
				requestyModelInfo: mode === "plan" ? options.planModeRequestyModelInfo : options.actModeRequestyModelInfo,
			})
		case "fireworks":
			return new FireworksHandler({
				...commonOptions,
				fireworksApiKey: options.fireworksApiKey,
				fireworksModelId: mode === "plan" ? options.planModeFireworksModelId : options.actModeFireworksModelId,
			})
		case "together":
			return new TogetherHandler({
				...commonOptions,
				togetherApiKey: options.togetherApiKey,
				togetherModelId: mode === "plan" ? options.planModeTogetherModelId : options.actModeTogetherModelId,
			})
		case "qwen":
			return new QwenHandler({
				...commonOptions,
				qwenApiKey: options.qwenApiKey,
				qwenApiLine:
					options.qwenApiLine === QwenApiRegions.INTERNATIONAL ? QwenApiRegions.INTERNATIONAL : QwenApiRegions.CHINA,
				apiModelId: mode === "plan" ? options.planModeApiModelId : options.actModeApiModelId,
				thinkingBudgetTokens:
					mode === "plan" ? options.planModeThinkingBudgetTokens : options.actModeThinkingBudgetTokens,
			})
		case "qwen-code":
			return new QwenCodeHandler({
				qwenCodeOauthPath: options.qwenCodeOauthPath,
				apiModelId: mode === "plan" ? options.planModeApiModelId : options.actModeApiModelId,
			})
		case "doubao":
			return new DoubaoHandler({
				...commonOptions,
				doubaoApiKey: options.doubaoApiKey,
				apiModelId: mode === "plan" ? options.planModeApiModelId : options.actModeApiModelId,
			})
		case "mistral":
			return new MistralHandler({
				...commonOptions,
				mistralApiKey: options.mistralApiKey,
				apiModelId: mode === "plan" ? options.planModeApiModelId : options.actModeApiModelId,
			})
		case "vscode-lm":
			return new VsCodeLmHandler({
				...commonOptions,
				vsCodeLmModelSelector:
					mode === "plan" ? options.planModeVsCodeLmModelSelector : options.actModeVsCodeLmModelSelector,
			})
		case "cline":
			return new ClineHandler({
				...commonOptions,
				clineAccountId: options.clineAccountId,
				ulid: options.ulid,
				reasoningEffort: mode === "plan" ? options.planModeReasoningEffort : options.actModeReasoningEffort,
				thinkingBudgetTokens:
					mode === "plan" ? options.planModeThinkingBudgetTokens : options.actModeThinkingBudgetTokens,
				openRouterProviderSorting: options.openRouterProviderSorting,
				openRouterModelId: mode === "plan" ? options.planModeOpenRouterModelId : options.actModeOpenRouterModelId,
				openRouterModelInfo: mode === "plan" ? options.planModeOpenRouterModelInfo : options.actModeOpenRouterModelInfo,
			})
		case "litellm":
			return new LiteLlmHandler({
				...commonOptions,
				liteLlmApiKey: options.liteLlmApiKey,
				liteLlmBaseUrl: options.liteLlmBaseUrl,
				liteLlmModelId: mode === "plan" ? options.planModeLiteLlmModelId : options.actModeLiteLlmModelId,
				liteLlmModelInfo: mode === "plan" ? options.planModeLiteLlmModelInfo : options.actModeLiteLlmModelInfo,
				thinkingBudgetTokens:
					mode === "plan" ? options.planModeThinkingBudgetTokens : options.actModeThinkingBudgetTokens,
				liteLlmUsePromptCache: options.liteLlmUsePromptCache,
				ulid: options.ulid,
			})
		case "moonshot":
			return new MoonshotHandler({
				...commonOptions,
				moonshotApiKey: options.moonshotApiKey,
				moonshotApiLine: options.moonshotApiLine,
				apiModelId: mode === "plan" ? options.planModeApiModelId : options.actModeApiModelId,
			})
		case "huggingface":
			return new HuggingFaceHandler({
				...commonOptions,
				huggingFaceApiKey: options.huggingFaceApiKey,
				huggingFaceModelId: mode === "plan" ? options.planModeHuggingFaceModelId : options.actModeHuggingFaceModelId,
				huggingFaceModelInfo:
					mode === "plan" ? options.planModeHuggingFaceModelInfo : options.actModeHuggingFaceModelInfo,
			})
		case "nebius":
			return new NebiusHandler({
				...commonOptions,
				nebiusApiKey: options.nebiusApiKey,
				apiModelId: mode === "plan" ? options.planModeApiModelId : options.actModeApiModelId,
			})
		case "asksage":
			return new AskSageHandler({
				...commonOptions,
				asksageApiKey: options.asksageApiKey,
				asksageApiUrl: options.asksageApiUrl,
				apiModelId: mode === "plan" ? options.planModeApiModelId : options.actModeApiModelId,
			})
		case "xai":
			return new XAIHandler({
				...commonOptions,
				xaiApiKey: options.xaiApiKey,
				reasoningEffort: mode === "plan" ? options.planModeReasoningEffort : options.actModeReasoningEffort,
				apiModelId: mode === "plan" ? options.planModeApiModelId : options.actModeApiModelId,
			})
		case "sambanova":
			return new SambanovaHandler({
				...commonOptions,
				sambanovaApiKey: options.sambanovaApiKey,
				apiModelId: mode === "plan" ? options.planModeApiModelId : options.actModeApiModelId,
			})
		case "cerebras":
			return new CerebrasHandler({
				...commonOptions,
				cerebrasApiKey: options.cerebrasApiKey,
				apiModelId: mode === "plan" ? options.planModeApiModelId : options.actModeApiModelId,
			})
		case "groq":
			return new GroqHandler({
				...commonOptions,
				groqApiKey: options.groqApiKey,
				groqModelId: mode === "plan" ? options.planModeGroqModelId : options.actModeGroqModelId,
				groqModelInfo: mode === "plan" ? options.planModeGroqModelInfo : options.actModeGroqModelInfo,
				apiModelId: mode === "plan" ? options.planModeApiModelId : options.actModeApiModelId,
			})
		case "baseten":
			return new BasetenHandler({
				basetenApiKey: options.basetenApiKey,
				basetenModelId: mode === "plan" ? options.planModeBasetenModelId : options.actModeBasetenModelId,
				basetenModelInfo: mode === "plan" ? options.planModeBasetenModelInfo : options.actModeBasetenModelInfo,
				apiModelId: mode === "plan" ? options.planModeApiModelId : options.actModeApiModelId,
			})
		case "sapaicore":
			return new SapAiCoreHandler({
				...commonOptions,
				sapAiCoreClientId: options.sapAiCoreClientId,
				sapAiCoreClientSecret: options.sapAiCoreClientSecret,
				sapAiCoreTokenUrl: options.sapAiCoreTokenUrl,
				sapAiResourceGroup: options.sapAiResourceGroup,
				sapAiCoreBaseUrl: options.sapAiCoreBaseUrl,
				apiModelId: mode === "plan" ? options.planModeApiModelId : options.actModeApiModelId,
				thinkingBudgetTokens:
					mode === "plan" ? options.planModeThinkingBudgetTokens : options.actModeThinkingBudgetTokens,
				reasoningEffort: mode === "plan" ? options.planModeReasoningEffort : options.actModeReasoningEffort,
			})
		case "claude-code":
			return new ClaudeCodeHandler({
				...commonOptions,
				claudeCodePath: options.claudeCodePath,
				apiModelId: mode === "plan" ? options.planModeApiModelId : options.actModeApiModelId,
				thinkingBudgetTokens:
					mode === "plan" ? options.planModeThinkingBudgetTokens : options.actModeThinkingBudgetTokens,
			})
		case "huawei-cloud-maas":
			return new HuaweiCloudMaaSHandler({
				huaweiCloudMaasApiKey: options.huaweiCloudMaasApiKey,
				huaweiCloudMaasModelId:
					mode === "plan" ? options.planModeHuaweiCloudMaasModelId : options.actModeHuaweiCloudMaasModelId,
				huaweiCloudMaasModelInfo:
					mode === "plan" ? options.planModeHuaweiCloudMaasModelInfo : options.actModeHuaweiCloudMaasModelInfo,
			})
		case "vercel-ai-gateway":
			return new VercelAIGatewayHandler({
				vercelAiGatewayApiKey: options.vercelAiGatewayApiKey,
				vercelAiGatewayModelId:
					mode === "plan" ? options.planModeVercelAiGatewayModelId : options.actModeVercelAiGatewayModelId,
				vercelAiGatewayModelInfo:
					mode === "plan" ? options.planModeVercelAiGatewayModelInfo : options.actModeVercelAiGatewayModelInfo,
			})
		case "zai":
			return new ZAiHandler({
				zaiApiLine: options.zaiApiLine,
				zaiApiKey: options.zaiApiKey,
				apiModelId: mode === "plan" ? options.planModeApiModelId : options.actModeApiModelId,
			})
		default:
			return new AnthropicHandler({
				...commonOptions,
				apiKey: options.apiKey,
				anthropicBaseUrl: options.anthropicBaseUrl,
				apiModelId: mode === "plan" ? options.planModeApiModelId : options.actModeApiModelId,
				thinkingBudgetTokens:
					mode === "plan" ? options.planModeThinkingBudgetTokens : options.actModeThinkingBudgetTokens,
			})
	}
}

export function buildApiHandler(configuration: ApiConfiguration, mode: Mode): ApiHandler {
	const { planModeApiProvider, actModeApiProvider, ...options } = configuration

	const apiProvider = mode === "plan" ? planModeApiProvider : actModeApiProvider

	// Validate thinking budget tokens against model's maxTokens to prevent API errors
	// wrapped in a try-catch for safety, but this should never throw
	try {
		const thinkingBudgetTokens = mode === "plan" ? options.planModeThinkingBudgetTokens : options.actModeThinkingBudgetTokens
		if (thinkingBudgetTokens && thinkingBudgetTokens > 0) {
			const handler = createHandlerForProvider(apiProvider, options, mode)

			const modelInfo = handler.getModel().info
			if (modelInfo.maxTokens && thinkingBudgetTokens > modelInfo.maxTokens) {
				const clippedValue = modelInfo.maxTokens - 1
				if (mode === "plan") {
					options.planModeThinkingBudgetTokens = clippedValue
				} else {
					options.actModeThinkingBudgetTokens = clippedValue
				}
			} else {
				return handler // don't rebuild unless its necessary
			}
		}
	} catch (error) {
		console.error("buildApiHandler error:", error)
	}

	return createHandlerForProvider(apiProvider, options, mode)
}
