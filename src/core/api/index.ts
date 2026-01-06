import { ApiConfiguration, ModelInfo, QwenApiRegions } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { ClineStorageMessage } from "@/shared/messages/content"
import { ClineTool } from "@/shared/tools"
import { AIhubmixHandler } from "./providers/aihubmix"
import { AnthropicHandler } from "./providers/anthropic"
import { AskSageHandler } from "./providers/asksage"
import { BasetenHandler } from "./providers/baseten"
import { AwsBedrockHandler } from "./providers/bedrock"
import { CerebrasHandler } from "./providers/cerebras"
import { ClaudeCodeHandler } from "./providers/claude-code"
import { ClineHandler } from "./providers/cline"
import { DeepSeekHandler } from "./providers/deepseek"
import { DifyHandler } from "./providers/dify"
import { DoubaoHandler } from "./providers/doubao"
import { FireworksHandler } from "./providers/fireworks"
import { GeminiHandler } from "./providers/gemini"
import { GroqHandler } from "./providers/groq"
import { HicapHandler } from "./providers/hicap"
import { HuaweiCloudMaaSHandler } from "./providers/huawei-cloud-maas"
import { HuggingFaceHandler } from "./providers/huggingface"
import { LiteLlmHandler } from "./providers/litellm"
import { LmStudioHandler } from "./providers/lmstudio"
import { MinimaxHandler } from "./providers/minimax"
import { MistralHandler } from "./providers/mistral"
import { MoonshotHandler } from "./providers/moonshot"
import { NebiusHandler } from "./providers/nebius"
import { NousResearchHandler } from "./providers/nousresearch"
import { OcaHandler } from "./providers/oca"
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

export type CommonApiHandlerOptions = {
	onRetryAttempt?: ApiConfiguration["onRetryAttempt"]
}
export interface ApiHandler {
	createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: ClineTool[], useResponseApi?: boolean): ApiStream
	getModel(): ApiHandlerModel
	getApiStreamUsage?(): Promise<ApiStreamUsageChunk | undefined>
	abort?(): void
}

export interface ApiHandlerModel {
	id: string
	info: ModelInfo
}

export interface ApiProviderInfo {
	providerId: string
	model: ApiHandlerModel
	mode: Mode
	customPrompt?: string // "compact"
	autoCondenseThreshold?: number // 0-1 range
}

export interface SingleCompletionHandler {
	completePrompt(prompt: string): Promise<string>
}

function createHandlerForProvider(
	apiProvider: string | undefined,
	options: Omit<ApiConfiguration, "apiProvider">,
	mode: Mode,
): ApiHandler {
	switch (apiProvider) {
		case "anthropic":
			return new AnthropicHandler({
				onRetryAttempt: options.onRetryAttempt,
				apiKey: options.apiKey,
				anthropicBaseUrl: options.anthropicBaseUrl,
				apiModelId: mode === "plan" ? options.planModeApiModelId : options.actModeApiModelId,
				thinkingBudgetTokens:
					mode === "plan" ? options.planModeThinkingBudgetTokens : options.actModeThinkingBudgetTokens,
			})
		case "openrouter":
			return new OpenRouterHandler({
				onRetryAttempt: options.onRetryAttempt,
				openRouterApiKey: options.openRouterApiKey,
				openRouterModelId: mode === "plan" ? options.planModeOpenRouterModelId : options.actModeOpenRouterModelId,
				openRouterModelInfo: mode === "plan" ? options.planModeOpenRouterModelInfo : options.actModeOpenRouterModelInfo,
				openRouterProviderSorting: options.openRouterProviderSorting,
				reasoningEffort: mode === "plan" ? options.planModeReasoningEffort : options.actModeReasoningEffort,
				thinkingBudgetTokens:
					mode === "plan" ? options.planModeThinkingBudgetTokens : options.actModeThinkingBudgetTokens,
				geminiThinkingLevel: mode === "plan" ? options.geminiPlanModeThinkingLevel : options.geminiActModeThinkingLevel,
			})
		case "bedrock":
			return new AwsBedrockHandler({
				onRetryAttempt: options.onRetryAttempt,
				apiModelId: mode === "plan" ? options.planModeApiModelId : options.actModeApiModelId,
				awsAccessKey: options.awsAccessKey,
				awsSecretKey: options.awsSecretKey,
				awsSessionToken: options.awsSessionToken,
				awsRegion: options.awsRegion,
				awsAuthentication: options.awsAuthentication,
				awsBedrockApiKey: options.awsBedrockApiKey,
				awsUseCrossRegionInference: options.awsUseCrossRegionInference,
				awsUseGlobalInference: options.awsUseGlobalInference,
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
				onRetryAttempt: options.onRetryAttempt,
				vertexProjectId: options.vertexProjectId,
				vertexRegion: options.vertexRegion,
				apiModelId: mode === "plan" ? options.planModeApiModelId : options.actModeApiModelId,
				thinkingBudgetTokens:
					mode === "plan" ? options.planModeThinkingBudgetTokens : options.actModeThinkingBudgetTokens,
				geminiApiKey: options.geminiApiKey,
				geminiBaseUrl: options.geminiBaseUrl,
				thinkingLevel: mode === "plan" ? options.geminiPlanModeThinkingLevel : options.geminiActModeThinkingLevel,
				ulid: options.ulid,
			})
		case "openai":
			return new OpenAiHandler({
				onRetryAttempt: options.onRetryAttempt,
				openAiApiKey: options.openAiApiKey,
				openAiBaseUrl: options.openAiBaseUrl,
				azureApiVersion: options.azureApiVersion,
				azureIdentity: options.azureIdentity,
				openAiHeaders: options.openAiHeaders,
				openAiModelId: mode === "plan" ? options.planModeOpenAiModelId : options.actModeOpenAiModelId,
				openAiModelInfo: mode === "plan" ? options.planModeOpenAiModelInfo : options.actModeOpenAiModelInfo,
				reasoningEffort: mode === "plan" ? options.planModeReasoningEffort : options.actModeReasoningEffort,
			})
		case "ollama":
			return new OllamaHandler({
				onRetryAttempt: options.onRetryAttempt,
				ollamaBaseUrl: options.ollamaBaseUrl,
				ollamaApiKey: options.ollamaApiKey,
				ollamaModelId: mode === "plan" ? options.planModeOllamaModelId : options.actModeOllamaModelId,
				ollamaApiOptionsCtxNum: options.ollamaApiOptionsCtxNum,
				requestTimeoutMs: options.requestTimeoutMs,
			})
		case "lmstudio":
			return new LmStudioHandler({
				onRetryAttempt: options.onRetryAttempt,
				lmStudioBaseUrl: options.lmStudioBaseUrl,
				lmStudioModelId: mode === "plan" ? options.planModeLmStudioModelId : options.actModeLmStudioModelId,
				lmStudioMaxTokens: options.lmStudioMaxTokens,
			})
		case "gemini":
			return new GeminiHandler({
				onRetryAttempt: options.onRetryAttempt,
				vertexProjectId: options.vertexProjectId,
				vertexRegion: options.vertexRegion,
				geminiApiKey: options.geminiApiKey,
				geminiBaseUrl: options.geminiBaseUrl,
				thinkingBudgetTokens:
					mode === "plan" ? options.planModeThinkingBudgetTokens : options.actModeThinkingBudgetTokens,
				thinkingLevel: mode === "plan" ? options.geminiPlanModeThinkingLevel : options.geminiActModeThinkingLevel,
				apiModelId: mode === "plan" ? options.planModeApiModelId : options.actModeApiModelId,
				ulid: options.ulid,
			})
		case "openai-native":
			return new OpenAiNativeHandler({
				onRetryAttempt: options.onRetryAttempt,
				openAiNativeApiKey: options.openAiNativeApiKey,
				reasoningEffort: mode === "plan" ? options.planModeReasoningEffort : options.actModeReasoningEffort,
				apiModelId: mode === "plan" ? options.planModeApiModelId : options.actModeApiModelId,
				thinkingBudgetTokens:
					mode === "plan" ? options.planModeThinkingBudgetTokens : options.actModeThinkingBudgetTokens,
			})
		case "deepseek":
			return new DeepSeekHandler({
				onRetryAttempt: options.onRetryAttempt,
				deepSeekApiKey: options.deepSeekApiKey,
				apiModelId: mode === "plan" ? options.planModeApiModelId : options.actModeApiModelId,
			})
		case "requesty":
			return new RequestyHandler({
				onRetryAttempt: options.onRetryAttempt,
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
				onRetryAttempt: options.onRetryAttempt,
				fireworksApiKey: options.fireworksApiKey,
				fireworksModelId: mode === "plan" ? options.planModeFireworksModelId : options.actModeFireworksModelId,
			})
		case "together":
			return new TogetherHandler({
				onRetryAttempt: options.onRetryAttempt,
				togetherApiKey: options.togetherApiKey,
				togetherModelId: mode === "plan" ? options.planModeTogetherModelId : options.actModeTogetherModelId,
			})
		case "qwen":
			return new QwenHandler({
				onRetryAttempt: options.onRetryAttempt,
				qwenApiKey: options.qwenApiKey,
				qwenApiLine:
					options.qwenApiLine === QwenApiRegions.INTERNATIONAL ? QwenApiRegions.INTERNATIONAL : QwenApiRegions.CHINA,
				apiModelId: mode === "plan" ? options.planModeApiModelId : options.actModeApiModelId,
				thinkingBudgetTokens:
					mode === "plan" ? options.planModeThinkingBudgetTokens : options.actModeThinkingBudgetTokens,
			})
		case "qwen-code":
			return new QwenCodeHandler({
				onRetryAttempt: options.onRetryAttempt,
				qwenCodeOauthPath: options.qwenCodeOauthPath,
				apiModelId: mode === "plan" ? options.planModeApiModelId : options.actModeApiModelId,
			})
		case "doubao":
			return new DoubaoHandler({
				onRetryAttempt: options.onRetryAttempt,
				doubaoApiKey: options.doubaoApiKey,
				apiModelId: mode === "plan" ? options.planModeApiModelId : options.actModeApiModelId,
			})
		case "mistral":
			return new MistralHandler({
				onRetryAttempt: options.onRetryAttempt,
				mistralApiKey: options.mistralApiKey,
				apiModelId: mode === "plan" ? options.planModeApiModelId : options.actModeApiModelId,
			})
		case "vscode-lm":
			return new VsCodeLmHandler({
				onRetryAttempt: options.onRetryAttempt,
				vsCodeLmModelSelector:
					mode === "plan" ? options.planModeVsCodeLmModelSelector : options.actModeVsCodeLmModelSelector,
			})
		case "cline":
			return new ClineHandler({
				onRetryAttempt: options.onRetryAttempt,
				clineAccountId: options.clineAccountId,
				ulid: options.ulid,
				reasoningEffort: mode === "plan" ? options.planModeReasoningEffort : options.actModeReasoningEffort,
				thinkingBudgetTokens:
					mode === "plan" ? options.planModeThinkingBudgetTokens : options.actModeThinkingBudgetTokens,
				openRouterProviderSorting: options.openRouterProviderSorting,
				openRouterModelId: mode === "plan" ? options.planModeOpenRouterModelId : options.actModeOpenRouterModelId,
				openRouterModelInfo: mode === "plan" ? options.planModeOpenRouterModelInfo : options.actModeOpenRouterModelInfo,
				geminiThinkingLevel: mode === "plan" ? options.geminiPlanModeThinkingLevel : options.geminiActModeThinkingLevel,
			})
		case "litellm":
			return new LiteLlmHandler({
				onRetryAttempt: options.onRetryAttempt,
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
				onRetryAttempt: options.onRetryAttempt,
				moonshotApiKey: options.moonshotApiKey,
				moonshotApiLine: options.moonshotApiLine,
				apiModelId: mode === "plan" ? options.planModeApiModelId : options.actModeApiModelId,
			})
		case "huggingface":
			return new HuggingFaceHandler({
				onRetryAttempt: options.onRetryAttempt,
				huggingFaceApiKey: options.huggingFaceApiKey,
				huggingFaceModelId: mode === "plan" ? options.planModeHuggingFaceModelId : options.actModeHuggingFaceModelId,
				huggingFaceModelInfo:
					mode === "plan" ? options.planModeHuggingFaceModelInfo : options.actModeHuggingFaceModelInfo,
			})
		case "nebius":
			return new NebiusHandler({
				onRetryAttempt: options.onRetryAttempt,
				nebiusApiKey: options.nebiusApiKey,
				apiModelId: mode === "plan" ? options.planModeApiModelId : options.actModeApiModelId,
			})
		case "asksage":
			return new AskSageHandler({
				onRetryAttempt: options.onRetryAttempt,
				asksageApiKey: options.asksageApiKey,
				asksageApiUrl: options.asksageApiUrl,
				apiModelId: mode === "plan" ? options.planModeApiModelId : options.actModeApiModelId,
			})
		case "xai":
			return new XAIHandler({
				onRetryAttempt: options.onRetryAttempt,
				xaiApiKey: options.xaiApiKey,
				reasoningEffort: mode === "plan" ? options.planModeReasoningEffort : options.actModeReasoningEffort,
				apiModelId: mode === "plan" ? options.planModeApiModelId : options.actModeApiModelId,
			})
		case "sambanova":
			return new SambanovaHandler({
				onRetryAttempt: options.onRetryAttempt,
				sambanovaApiKey: options.sambanovaApiKey,
				apiModelId: mode === "plan" ? options.planModeApiModelId : options.actModeApiModelId,
			})
		case "cerebras":
			return new CerebrasHandler({
				onRetryAttempt: options.onRetryAttempt,
				cerebrasApiKey: options.cerebrasApiKey,
				apiModelId: mode === "plan" ? options.planModeApiModelId : options.actModeApiModelId,
			})
		case "groq":
			return new GroqHandler({
				onRetryAttempt: options.onRetryAttempt,
				groqApiKey: options.groqApiKey,
				groqModelId: mode === "plan" ? options.planModeGroqModelId : options.actModeGroqModelId,
				groqModelInfo: mode === "plan" ? options.planModeGroqModelInfo : options.actModeGroqModelInfo,
				apiModelId: mode === "plan" ? options.planModeApiModelId : options.actModeApiModelId,
			})
		case "baseten":
			return new BasetenHandler({
				onRetryAttempt: options.onRetryAttempt,
				basetenApiKey: options.basetenApiKey,
				basetenModelId: mode === "plan" ? options.planModeBasetenModelId : options.actModeBasetenModelId,
				basetenModelInfo: mode === "plan" ? options.planModeBasetenModelInfo : options.actModeBasetenModelInfo,
				apiModelId: mode === "plan" ? options.planModeApiModelId : options.actModeApiModelId,
			})
		case "sapaicore":
			return new SapAiCoreHandler({
				onRetryAttempt: options.onRetryAttempt,
				sapAiCoreClientId: options.sapAiCoreClientId,
				sapAiCoreClientSecret: options.sapAiCoreClientSecret,
				sapAiCoreTokenUrl: options.sapAiCoreTokenUrl,
				sapAiResourceGroup: options.sapAiResourceGroup,
				sapAiCoreBaseUrl: options.sapAiCoreBaseUrl,
				apiModelId: mode === "plan" ? options.planModeApiModelId : options.actModeApiModelId,
				thinkingBudgetTokens:
					mode === "plan" ? options.planModeThinkingBudgetTokens : options.actModeThinkingBudgetTokens,
				reasoningEffort: mode === "plan" ? options.planModeReasoningEffort : options.actModeReasoningEffort,
				deploymentId: mode === "plan" ? options.planModeSapAiCoreDeploymentId : options.actModeSapAiCoreDeploymentId,
				sapAiCoreUseOrchestrationMode: options.sapAiCoreUseOrchestrationMode,
			})
		case "claude-code":
			return new ClaudeCodeHandler({
				onRetryAttempt: options.onRetryAttempt,
				claudeCodePath: options.claudeCodePath,
				apiModelId: mode === "plan" ? options.planModeApiModelId : options.actModeApiModelId,
				thinkingBudgetTokens:
					mode === "plan" ? options.planModeThinkingBudgetTokens : options.actModeThinkingBudgetTokens,
			})
		case "huawei-cloud-maas":
			return new HuaweiCloudMaaSHandler({
				onRetryAttempt: options.onRetryAttempt,
				huaweiCloudMaasApiKey: options.huaweiCloudMaasApiKey,
				huaweiCloudMaasModelId:
					mode === "plan" ? options.planModeHuaweiCloudMaasModelId : options.actModeHuaweiCloudMaasModelId,
				huaweiCloudMaasModelInfo:
					mode === "plan" ? options.planModeHuaweiCloudMaasModelInfo : options.actModeHuaweiCloudMaasModelInfo,
			})
		case "dify": // Add Dify.ai handler
			return new DifyHandler({
				difyApiKey: options.difyApiKey,
				difyBaseUrl: options.difyBaseUrl,
			})
		case "vercel-ai-gateway":
			return new VercelAIGatewayHandler({
				onRetryAttempt: options.onRetryAttempt,
				vercelAiGatewayApiKey: options.vercelAiGatewayApiKey,
				openRouterModelId: mode === "plan" ? options.planModeOpenRouterModelId : options.actModeOpenRouterModelId,
				openRouterModelInfo: mode === "plan" ? options.planModeOpenRouterModelInfo : options.actModeOpenRouterModelInfo,
				thinkingBudgetTokens:
					mode === "plan" ? options.planModeThinkingBudgetTokens : options.actModeThinkingBudgetTokens,
			})
		case "zai":
			return new ZAiHandler({
				onRetryAttempt: options.onRetryAttempt,
				zaiApiLine: options.zaiApiLine,
				zaiApiKey: options.zaiApiKey,
				apiModelId: mode === "plan" ? options.planModeApiModelId : options.actModeApiModelId,
			})
		case "oca":
			return new OcaHandler({
				ocaMode: options.ocaMode || "internal",
				ocaBaseUrl: options.ocaBaseUrl,
				ocaModelId: mode === "plan" ? options.planModeOcaModelId : options.actModeOcaModelId,
				ocaModelInfo: mode === "plan" ? options.planModeOcaModelInfo : options.actModeOcaModelInfo,
				thinkingBudgetTokens:
					mode === "plan" ? options.planModeThinkingBudgetTokens : options.actModeThinkingBudgetTokens,
				ocaUsePromptCache:
					mode === "plan"
						? options.planModeOcaModelInfo?.supportsPromptCache
						: options.actModeOcaModelInfo?.supportsPromptCache,
				taskId: options.ulid,
			})
		case "aihubmix":
			return new AIhubmixHandler({
				onRetryAttempt: options.onRetryAttempt,
				apiKey: options.aihubmixApiKey,
				baseURL: options.aihubmixBaseUrl,
				appCode: options.aihubmixAppCode,
				modelId: mode === "plan" ? (options as any).planModeAihubmixModelId : (options as any).actModeAihubmixModelId,
				modelInfo:
					mode === "plan" ? (options as any).planModeAihubmixModelInfo : (options as any).actModeAihubmixModelInfo,
			})
		case "minimax":
			return new MinimaxHandler({
				onRetryAttempt: options.onRetryAttempt,
				minimaxApiKey: options.minimaxApiKey,
				minimaxApiLine: options.minimaxApiLine,
				apiModelId: mode === "plan" ? options.planModeApiModelId : options.actModeApiModelId,
			})
		case "hicap":
			return new HicapHandler({
				onRetryAttempt: options.onRetryAttempt,
				hicapApiKey: options.hicapApiKey,
				hicapModelId: mode === "plan" ? options.planModeHicapModelId : options.actModeHicapModelId,
			})
		case "nousResearch":
			return new NousResearchHandler({
				onRetryAttempt: options.onRetryAttempt,
				nousResearchApiKey: options.nousResearchApiKey,
				apiModelId: mode === "plan" ? options.planModeNousResearchModelId : options.actModeNousResearchModelId,
			})
		default:
			return new AnthropicHandler({
				onRetryAttempt: options.onRetryAttempt,
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
			if (modelInfo?.maxTokens && modelInfo.maxTokens > 0 && thinkingBudgetTokens > modelInfo.maxTokens) {
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
