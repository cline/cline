import { ApiConfiguration, ModelInfo, type OcaModelInfo, QwenApiRegions } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { type ModeConfigSettings } from "@shared/storage"
import { ClineStorageMessage } from "@/shared/messages/content"
import { Logger } from "@/shared/services/Logger"
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
import { OpenAiCodexHandler } from "./providers/openai-codex"
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
import { WandbHandler } from "./providers/wandb"
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
}

export interface SingleCompletionHandler {
	completePrompt(prompt: string): Promise<string>
}

function createHandlerForProvider(
	apiProvider: string | undefined,
	options: Omit<ApiConfiguration, "apiProvider">,
	mode: Mode,
): ApiHandler {
	const modeConfig = options[mode === "plan" ? "planConfig" : "actConfig"]

	switch (apiProvider) {
		case "anthropic":
			return new AnthropicHandler({
				onRetryAttempt: options.onRetryAttempt,
				apiKey: options.apiKey,
				anthropicBaseUrl: options.anthropicBaseUrl,
				apiModelId: modeConfig?.modelId,
				reasoningEffort: modeConfig?.reasoningEffort,
				thinkingBudgetTokens: modeConfig?.thinkingBudgetTokens,
			})
		case "openrouter":
			return new OpenRouterHandler({
				onRetryAttempt: options.onRetryAttempt,
				openRouterApiKey: options.openRouterApiKey,
				openRouterModelId: modeConfig?.modelId,
				openRouterModelInfo: modeConfig?.modelInfo,
				openRouterProviderSorting: options.openRouterProviderSorting,
				reasoningEffort: modeConfig?.reasoningEffort,
				thinkingBudgetTokens: modeConfig?.thinkingBudgetTokens,
				enableParallelToolCalling: options.enableParallelToolCalling,
			})
		case "bedrock":
			return new AwsBedrockHandler({
				onRetryAttempt: options.onRetryAttempt,
				apiModelId: modeConfig?.modelId,
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
				awsBedrockCustomSelected: modeConfig?.awsBedrockCustomSelected,
				awsBedrockCustomModelBaseId: modeConfig?.awsBedrockCustomModelBaseId,
				reasoningEffort: modeConfig?.reasoningEffort,
				thinkingBudgetTokens: modeConfig?.thinkingBudgetTokens,
			})
		case "vertex":
			return new VertexHandler({
				onRetryAttempt: options.onRetryAttempt,
				vertexProjectId: options.vertexProjectId,
				vertexRegion: options.vertexRegion,
				apiModelId: modeConfig?.modelId,
				thinkingBudgetTokens: modeConfig?.thinkingBudgetTokens,
				geminiApiKey: options.geminiApiKey,
				geminiBaseUrl: options.geminiBaseUrl,
				reasoningEffort: modeConfig?.reasoningEffort,
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
				openAiModelId: modeConfig?.modelId,
				openAiModelInfo: modeConfig?.modelInfo,
				reasoningEffort: modeConfig?.reasoningEffort,
			})
		case "ollama":
			return new OllamaHandler({
				onRetryAttempt: options.onRetryAttempt,
				ollamaBaseUrl: options.ollamaBaseUrl,
				ollamaApiKey: options.ollamaApiKey,
				ollamaModelId: modeConfig?.modelId,
				ollamaApiOptionsCtxNum: options.ollamaApiOptionsCtxNum,
				requestTimeoutMs: options.requestTimeoutMs,
			})
		case "lmstudio":
			return new LmStudioHandler({
				onRetryAttempt: options.onRetryAttempt,
				lmStudioBaseUrl: options.lmStudioBaseUrl,
				lmStudioModelId: modeConfig?.modelId,
				lmStudioMaxTokens: options.lmStudioMaxTokens,
			})
		case "gemini":
			return new GeminiHandler({
				onRetryAttempt: options.onRetryAttempt,
				vertexProjectId: options.vertexProjectId,
				vertexRegion: options.vertexRegion,
				geminiApiKey: options.geminiApiKey,
				geminiBaseUrl: options.geminiBaseUrl,
				thinkingBudgetTokens: modeConfig?.thinkingBudgetTokens,
				reasoningEffort: modeConfig?.reasoningEffort,
				apiModelId: modeConfig?.modelId,
				ulid: options.ulid,
			})
		case "openai-native":
			return new OpenAiNativeHandler({
				onRetryAttempt: options.onRetryAttempt,
				openAiNativeApiKey: options.openAiNativeApiKey,
				reasoningEffort: modeConfig?.reasoningEffort,
				apiModelId: modeConfig?.modelId,
				thinkingBudgetTokens: modeConfig?.thinkingBudgetTokens,
			})
		case "openai-codex":
			return new OpenAiCodexHandler({
				onRetryAttempt: options.onRetryAttempt,
				reasoningEffort: modeConfig?.reasoningEffort,
				apiModelId: modeConfig?.modelId,
			})
		case "deepseek":
			return new DeepSeekHandler({
				onRetryAttempt: options.onRetryAttempt,
				deepSeekApiKey: options.deepSeekApiKey,
				apiModelId: modeConfig?.modelId,
			})
		case "requesty":
			return new RequestyHandler({
				onRetryAttempt: options.onRetryAttempt,
				requestyBaseUrl: options.requestyBaseUrl,
				requestyApiKey: options.requestyApiKey,
				reasoningEffort: modeConfig?.reasoningEffort,
				thinkingBudgetTokens: modeConfig?.thinkingBudgetTokens,
				requestyModelId: modeConfig?.modelId,
				requestyModelInfo: modeConfig?.modelInfo,
			})
		case "fireworks":
			return new FireworksHandler({
				onRetryAttempt: options.onRetryAttempt,
				fireworksApiKey: options.fireworksApiKey,
				fireworksModelId: modeConfig?.modelId,
			})
		case "together":
			return new TogetherHandler({
				onRetryAttempt: options.onRetryAttempt,
				togetherApiKey: options.togetherApiKey,
				togetherModelId: modeConfig?.modelId,
			})
		case "qwen":
			return new QwenHandler({
				onRetryAttempt: options.onRetryAttempt,
				qwenApiKey: options.qwenApiKey,
				qwenApiLine:
					options.qwenApiLine === QwenApiRegions.INTERNATIONAL ? QwenApiRegions.INTERNATIONAL : QwenApiRegions.CHINA,
				apiModelId: modeConfig?.modelId,
				thinkingBudgetTokens: modeConfig?.thinkingBudgetTokens,
			})
		case "qwen-code":
			return new QwenCodeHandler({
				onRetryAttempt: options.onRetryAttempt,
				qwenCodeOauthPath: options.qwenCodeOauthPath,
				apiModelId: modeConfig?.modelId,
			})
		case "doubao":
			return new DoubaoHandler({
				onRetryAttempt: options.onRetryAttempt,
				doubaoApiKey: options.doubaoApiKey,
				apiModelId: modeConfig?.modelId,
			})
		case "mistral":
			return new MistralHandler({
				onRetryAttempt: options.onRetryAttempt,
				mistralApiKey: options.mistralApiKey,
				apiModelId: modeConfig?.modelId,
			})
		case "vscode-lm":
			return new VsCodeLmHandler({
				onRetryAttempt: options.onRetryAttempt,
				vsCodeLmModelSelector: modeConfig?.vsCodeLmModelSelector,
			})
		case "cline": {
			return new ClineHandler({
				onRetryAttempt: options.onRetryAttempt,
				clineAccountId: options.clineAccountId,
				clineApiKey: options.clineApiKey,
				ulid: options.ulid,
				reasoningEffort: modeConfig?.reasoningEffort,
				thinkingBudgetTokens: modeConfig?.thinkingBudgetTokens,
				openRouterProviderSorting: options.openRouterProviderSorting,
				openRouterModelId: modeConfig?.modelId,
				openRouterModelInfo: modeConfig?.modelInfo,
				enableParallelToolCalling: options.enableParallelToolCalling,
			})
		}
		case "litellm":
			return new LiteLlmHandler({
				onRetryAttempt: options.onRetryAttempt,
				liteLlmApiKey: options.liteLlmApiKey,
				liteLlmBaseUrl: options.liteLlmBaseUrl,
				liteLlmModelId: modeConfig?.modelId,
				liteLlmModelInfo: modeConfig?.modelInfo,
				reasoningEffort: modeConfig?.reasoningEffort,
				thinkingBudgetTokens: modeConfig?.thinkingBudgetTokens,
				liteLlmUsePromptCache: options.liteLlmUsePromptCache,
				ulid: options.ulid,
			})
		case "moonshot":
			return new MoonshotHandler({
				onRetryAttempt: options.onRetryAttempt,
				moonshotApiKey: options.moonshotApiKey,
				moonshotApiLine: options.moonshotApiLine,
				apiModelId: modeConfig?.modelId,
			})
		case "huggingface":
			return new HuggingFaceHandler({
				onRetryAttempt: options.onRetryAttempt,
				huggingFaceApiKey: options.huggingFaceApiKey,
				huggingFaceModelId: modeConfig?.modelId,
				huggingFaceModelInfo: modeConfig?.modelInfo,
			})
		case "nebius":
			return new NebiusHandler({
				onRetryAttempt: options.onRetryAttempt,
				nebiusApiKey: options.nebiusApiKey,
				apiModelId: modeConfig?.modelId,
			})
		case "asksage":
			return new AskSageHandler({
				onRetryAttempt: options.onRetryAttempt,
				asksageApiKey: options.asksageApiKey,
				asksageApiUrl: options.asksageApiUrl,
				apiModelId: modeConfig?.modelId,
			})
		case "xai":
			return new XAIHandler({
				onRetryAttempt: options.onRetryAttempt,
				xaiApiKey: options.xaiApiKey,
				reasoningEffort: modeConfig?.reasoningEffort,
				apiModelId: modeConfig?.modelId,
			})
		case "sambanova":
			return new SambanovaHandler({
				onRetryAttempt: options.onRetryAttempt,
				sambanovaApiKey: options.sambanovaApiKey,
				apiModelId: modeConfig?.modelId,
			})
		case "cerebras":
			return new CerebrasHandler({
				onRetryAttempt: options.onRetryAttempt,
				cerebrasApiKey: options.cerebrasApiKey,
				apiModelId: modeConfig?.modelId,
			})
		case "groq":
			return new GroqHandler({
				onRetryAttempt: options.onRetryAttempt,
				groqApiKey: options.groqApiKey,
				groqModelId: modeConfig?.modelId,
				groqModelInfo: modeConfig?.modelInfo,
				apiModelId: modeConfig?.modelId,
			})
		case "baseten":
			return new BasetenHandler({
				onRetryAttempt: options.onRetryAttempt,
				basetenApiKey: options.basetenApiKey,
				basetenModelId: modeConfig?.modelId,
				basetenModelInfo: modeConfig?.modelInfo,
				apiModelId: modeConfig?.modelId,
			})
		case "sapaicore":
			return new SapAiCoreHandler({
				onRetryAttempt: options.onRetryAttempt,
				sapAiCoreClientId: options.sapAiCoreClientId,
				sapAiCoreClientSecret: options.sapAiCoreClientSecret,
				sapAiCoreTokenUrl: options.sapAiCoreTokenUrl,
				sapAiResourceGroup: options.sapAiResourceGroup,
				sapAiCoreBaseUrl: options.sapAiCoreBaseUrl,
				apiModelId: modeConfig?.modelId,
				thinkingBudgetTokens: modeConfig?.thinkingBudgetTokens,
				reasoningEffort: modeConfig?.reasoningEffort,
				deploymentId: modeConfig?.sapAiCoreDeploymentId,
				sapAiCoreUseOrchestrationMode: options.sapAiCoreUseOrchestrationMode,
			})
		case "claude-code":
			return new ClaudeCodeHandler({
				onRetryAttempt: options.onRetryAttempt,
				claudeCodePath: options.claudeCodePath,
				apiModelId: modeConfig?.modelId,
				thinkingBudgetTokens: modeConfig?.thinkingBudgetTokens,
			})
		case "huawei-cloud-maas":
			return new HuaweiCloudMaaSHandler({
				onRetryAttempt: options.onRetryAttempt,
				huaweiCloudMaasApiKey: options.huaweiCloudMaasApiKey,
				huaweiCloudMaasModelId: modeConfig?.modelId,
				huaweiCloudMaasModelInfo: modeConfig?.modelInfo,
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
				openRouterModelId: modeConfig?.modelId,
				openRouterModelInfo: modeConfig?.modelInfo,
				reasoningEffort: modeConfig?.reasoningEffort,
				thinkingBudgetTokens: modeConfig?.thinkingBudgetTokens,
			})
		case "zai":
			return new ZAiHandler({
				onRetryAttempt: options.onRetryAttempt,
				zaiApiLine: options.zaiApiLine,
				zaiApiKey: options.zaiApiKey,
				apiModelId: modeConfig?.modelId,
			})
		case "oca":
			return new OcaHandler({
				ocaMode: options.ocaMode || "internal",
				ocaBaseUrl: options.ocaBaseUrl,
				ocaModelId: modeConfig?.modelId,
				ocaModelInfo: modeConfig?.modelInfo as OcaModelInfo | undefined,
				ocaReasoningEffort: modeConfig?.ocaReasoningEffort,
				thinkingBudgetTokens: modeConfig?.thinkingBudgetTokens,
				ocaUsePromptCache: modeConfig?.modelInfo?.supportsPromptCache,
				taskId: options.ulid,
			})
		case "aihubmix":
			return new AIhubmixHandler({
				onRetryAttempt: options.onRetryAttempt,
				apiKey: options.aihubmixApiKey,
				baseURL: options.aihubmixBaseUrl,
				appCode: options.aihubmixAppCode,
				modelId: modeConfig?.modelId,
				modelInfo: modeConfig?.modelInfo,
			})
		case "minimax":
			return new MinimaxHandler({
				onRetryAttempt: options.onRetryAttempt,
				minimaxApiKey: options.minimaxApiKey,
				minimaxApiLine: options.minimaxApiLine,
				apiModelId: modeConfig?.modelId,
				thinkingBudgetTokens: modeConfig?.thinkingBudgetTokens,
			})
		case "hicap":
			return new HicapHandler({
				onRetryAttempt: options.onRetryAttempt,
				hicapApiKey: options.hicapApiKey,
				hicapModelId: modeConfig?.modelId,
			})
		case "nousResearch":
			return new NousResearchHandler({
				onRetryAttempt: options.onRetryAttempt,
				nousResearchApiKey: options.nousResearchApiKey,
				apiModelId: modeConfig?.modelId,
			})
		case "wandb":
			return new WandbHandler({
				onRetryAttempt: options.onRetryAttempt,
				wandbApiKey: options.wandbApiKey,
				apiModelId: modeConfig?.modelId,
			})
		default:
			return new AnthropicHandler({
				onRetryAttempt: options.onRetryAttempt,
				apiKey: options.apiKey,
				anthropicBaseUrl: options.anthropicBaseUrl,
				apiModelId: modeConfig?.modelId,
				reasoningEffort: modeConfig?.reasoningEffort,
				thinkingBudgetTokens: modeConfig?.thinkingBudgetTokens,
			})
	}
}

export function buildApiHandler(configuration: ApiConfiguration, mode: Mode): ApiHandler {
	const apiProvider = configuration[mode === "plan" ? "planConfig" : "actConfig"]?.apiProvider

	// Validate thinking budget tokens against model's maxTokens to prevent API errors
	// wrapped in a try-catch for safety, but this should never throw
	try {
		const config = configuration[mode === "plan" ? "planConfig" : "actConfig"]
		const thinkingBudgetTokens = config?.thinkingBudgetTokens
		if (thinkingBudgetTokens && thinkingBudgetTokens > 0) {
			const handler = createHandlerForProvider(apiProvider, configuration, mode)

			const modelInfo = handler.getModel().info
			if (modelInfo?.maxTokens && modelInfo.maxTokens > 0 && thinkingBudgetTokens > modelInfo.maxTokens) {
				const clippedValue = modelInfo.maxTokens - 1
				if (mode === "plan") {
					configuration.planConfig = { ...configuration.planConfig, thinkingBudgetTokens: clippedValue } as ModeConfigSettings
				} else {
					configuration.actConfig = { ...configuration.actConfig, thinkingBudgetTokens: clippedValue } as ModeConfigSettings
				}
			} else {
				return handler // don't rebuild unless its necessary
			}
		}
	} catch (error) {
		Logger.error("buildApiHandler error:", error)
	}

	return createHandlerForProvider(apiProvider, configuration, mode)
}
