import {
	ApiConfiguration as DomainApiConfiguration,
	AnthropicConfig,
	OpenAIConfig,
	OpenRouterConfig,
	OllamaConfig,
	LMStudioConfig,
	LiteLLMConfig,
	RequestyConfig,
	AwsConfig,
	FireworksConfig,
	TogetherConfig,
	QwenConfig,
	GeminiConfig,
	DeepSeekConfig,
	AskSageConfig,
	CerebrasConfig,
	VSCodeLMConfig,
	VertexConfig,
	XAIConfig,
	NebiusConfig,
	SambanovaConfig,
	DoubaoConfig,
	MistralConfig,
} from "../../api"
import { ChatSettings as DomainChatSettings, OpenAIReasoningEffort } from "../../ChatSettings"
import { TelemetrySetting as DomainTelemetrySetting } from "../../TelemetrySetting"
import { ApiConfiguration, ChatSettings, PlanActMode, TelemetrySetting } from "../../proto/state"

/**
 * Converts proto ApiConfiguration to domain ApiConfiguration
 */
export function convertProtoApiConfigurationToDomainApiConfiguration(protoConfig: ApiConfiguration): DomainApiConfiguration {
	console.log("[DEBUG] Converting proto API configuration to domain API configuration:", {
		provider: protoConfig.apiProvider,
		modelId: protoConfig.apiModelId,
		hasAnthropicApiKey: protoConfig.anthropic ? (protoConfig.anthropic as any).apiKey : undefined,
	})

	// Create base configuration without legacy properties
	const domainConfig: Omit<DomainApiConfiguration, "apiKey"> = {
		apiProvider: protoConfig.apiProvider as any,
		apiModelId: protoConfig.apiModelId,
		reasoningEffort: protoConfig.reasoningEffort,
		thinkingBudgetTokens: protoConfig.thinkingBudgetTokens,

		// Map nested configurations from proto to domain
		anthropic: protoConfig.anthropic
			? ({
					apiKey: (protoConfig.anthropic as any).apiKey,
					baseUrl: (protoConfig.anthropic as any).baseUrl,
				} as AnthropicConfig)
			: undefined,

		openai: protoConfig.openai
			? ({
					apiKey: protoConfig.openai.apiKey,
					modelId: protoConfig.openai.modelId,
					baseUrl: protoConfig.openai.baseUrl,
					headers: protoConfig.openai.headers ? JSON.parse(protoConfig.openai.headers) : undefined,
					modelInfo: protoConfig.openai.modelInfo ? JSON.parse(protoConfig.openai.modelInfo) : undefined,
				} as OpenAIConfig)
			: undefined,

		openaiNative: protoConfig.openaiNative
			? {
					apiKey: protoConfig.openaiNative.apiKey,
				}
			: undefined,

		azure: protoConfig.azure
			? {
					apiVersion: protoConfig.azure.apiVersion,
				}
			: undefined,

		openrouter: protoConfig.openrouter
			? ({
					apiKey: protoConfig.openrouter.apiKey,
					modelId: protoConfig.openrouter.modelId,
					modelInfo: protoConfig.openrouter.modelInfo ? JSON.parse(protoConfig.openrouter.modelInfo) : undefined,
					providerSorting: protoConfig.openrouter.providerSorting,
				} as OpenRouterConfig)
			: undefined,

		ollama: protoConfig.ollama
			? ({
					modelId: protoConfig.ollama.modelId,
					baseUrl: protoConfig.ollama.baseUrl,
					apiOptionsCtxNum: protoConfig.ollama.apiOptionsCtxNum,
				} as OllamaConfig)
			: undefined,

		lmstudio: protoConfig.lmStudio
			? ({
					modelId: protoConfig.lmStudio.modelId,
					baseUrl: protoConfig.lmStudio.baseUrl,
				} as LMStudioConfig)
			: undefined,

		litellm: protoConfig.litellm
			? ({
					modelId: protoConfig.litellm.modelId,
					baseUrl: protoConfig.litellm.baseUrl,
					apiKey: protoConfig.litellm.apiKey,
					usePromptCache: protoConfig.litellm.usePromptCache,
					modelInfo: protoConfig.litellm.modelInfo ? JSON.parse(protoConfig.litellm.modelInfo) : undefined,
				} as LiteLLMConfig)
			: undefined,

		requesty: protoConfig.requesty
			? ({
					modelId: protoConfig.requesty.modelId,
					apiKey: protoConfig.requesty.apiKey,
					modelInfo: protoConfig.requesty.modelInfo ? JSON.parse(protoConfig.requesty.modelInfo) : undefined,
				} as RequestyConfig)
			: undefined,

		aws: protoConfig.aws
			? ({
					bedrockCustomSelected: protoConfig.aws.bedrockCustomSelected,
					bedrockCustomModelBaseId: protoConfig.aws.bedrockCustomModelBaseId as any,
					region: protoConfig.aws.region,
					useCrossRegionInference: protoConfig.aws.useCrossRegionInference,
					bedrockUsePromptCache: protoConfig.aws.bedrockUsePromptCache,
					bedrockEndpoint: protoConfig.aws.bedrockEndpoint,
					profile: protoConfig.aws.profile,
					useProfile: protoConfig.aws.useProfile,
					accessKey: protoConfig.aws.accessKey,
					secretKey: protoConfig.aws.secretKey,
					sessionToken: protoConfig.aws.sessionToken,
				} as AwsConfig)
			: undefined,

		fireworks: protoConfig.fireworks
			? ({
					modelId: protoConfig.fireworks.modelId,
					modelMaxCompletionTokens: protoConfig.fireworks.modelMaxCompletionTokens,
					modelMaxTokens: protoConfig.fireworks.modelMaxTokens,
				} as FireworksConfig)
			: undefined,

		together: protoConfig.together
			? ({
					modelId: protoConfig.together.modelId,
					apiKey: protoConfig.together.apiKey,
				} as TogetherConfig)
			: undefined,

		qwen: protoConfig.qwen
			? ({
					apiLine: protoConfig.qwen.apiLine,
					apiKey: protoConfig.qwen.apiKey,
				} as QwenConfig)
			: undefined,

		doubao: protoConfig.doubao
			? ({
					apiKey: protoConfig.doubao.apiKey,
				} as DoubaoConfig)
			: undefined,

		mistral: protoConfig.mistral
			? ({
					apiKey: protoConfig.mistral.apiKey,
				} as MistralConfig)
			: undefined,

		vertex: protoConfig.vertex
			? ({
					projectId: protoConfig.vertex.projectId,
					region: protoConfig.vertex.region,
				} as VertexConfig)
			: undefined,

		gemini: protoConfig.gemini
			? ({
					apiKey: protoConfig.gemini.apiKey,
					baseUrl: protoConfig.gemini.baseUrl,
				} as GeminiConfig)
			: undefined,

		deepseek: protoConfig.deepseek
			? ({
					apiKey: protoConfig.deepseek.apiKey,
				} as DeepSeekConfig)
			: undefined,

		asksage: protoConfig.asksage
			? ({
					apiUrl: protoConfig.asksage.apiUrl,
					apiKey: protoConfig.asksage.apiKey,
				} as AskSageConfig)
			: undefined,

		xai: protoConfig.xai
			? ({
					apiKey: protoConfig.xai.apiKey,
				} as XAIConfig)
			: undefined,

		nebius: protoConfig.nebius
			? ({
					apiKey: protoConfig.nebius.apiKey,
				} as NebiusConfig)
			: undefined,

		sambanova: protoConfig.sambanova
			? ({
					apiKey: protoConfig.sambanova.apiKey,
				} as SambanovaConfig)
			: undefined,

		cerebras: protoConfig.cerebras
			? ({
					apiKey: protoConfig.cerebras.apiKey,
				} as CerebrasConfig)
			: undefined,

		vscodelm: protoConfig.vscode
			? ({
					modelSelector: protoConfig.vscode.modelSelector ? JSON.parse(protoConfig.vscode.modelSelector) : undefined,
				} as VSCodeLMConfig)
			: undefined,

		cline: protoConfig.cline
			? {
					apiKey: protoConfig.cline.apiKey,
				}
			: undefined,
	}

	// Add legacy apiKey for backward compatibility
	const finalConfig = domainConfig as DomainApiConfiguration

	// Use dynamic property access to add the legacy apiKey field
	if (protoConfig.anthropic && typeof protoConfig.anthropic === "object") {
		// Bypass TypeScript type checking by using index notation
		;(finalConfig as any)["apiKey"] = (protoConfig.anthropic as any).apiKey
	}

	// Filter out empty configurations
	Object.keys(domainConfig).forEach((key) => {
		const config = domainConfig[key as keyof DomainApiConfiguration]
		if (config && typeof config === "object" && Object.keys(config).length === 0) {
			delete domainConfig[key as keyof DomainApiConfiguration]
		}
	})

	return domainConfig
}

/**
 * Converts proto TelemetrySetting to domain TelemetrySetting
 */
export function convertProtoTelemetrySettingToDomainTelemetrySetting(protoSetting: TelemetrySetting): DomainTelemetrySetting {
	return protoSetting === TelemetrySetting.ENABLED ? "enabled" : "disabled"
}

/**
 * Converts proto ChatSettings to domain ChatSettings
 */
export function convertProtoChatSettingsToDomainChatSettings(protoSettings: ChatSettings): DomainChatSettings {
	return {
		mode: protoSettings.mode === PlanActMode.PLAN ? "plan" : "act",
		preferredLanguage: protoSettings.preferredLanguage,
		openAIReasoningEffort: protoSettings.openAiReasoningEffort as OpenAIReasoningEffort,
	}
}

/**
 * Converts domain ApiConfiguration to proto ApiConfiguration
 */
export function convertDomainApiConfigurationToProtoApiConfiguration(domainConfig: DomainApiConfiguration): ApiConfiguration {
	// We're using the ApiConfiguration.create factory function from the generated protobuf code
	const protoConfig: Record<string, any> = {
		apiProvider: domainConfig.apiProvider,
		apiModelId: domainConfig.apiModelId,
		reasoningEffort: domainConfig.reasoningEffort,
		thinkingBudgetTokens: domainConfig.thinkingBudgetTokens,
		favoriteModelIds: domainConfig.favoritedModelIds,
	}

	// Create nested configurations

	// Anthropic
	if (domainConfig.anthropic) {
		protoConfig.anthropic = {
			apiKey: domainConfig.anthropic.apiKey || (domainConfig as any).apiKey, // Support legacy apiKey
			baseUrl: domainConfig.anthropic.baseUrl,
		}
	}

	// OpenAI
	if (domainConfig.openai) {
		protoConfig.openai = {
			apiKey: domainConfig.openai.apiKey,
			modelId: domainConfig.openai.modelId,
			baseUrl: domainConfig.openai.baseUrl,
			headers: domainConfig.openai.headers ? JSON.stringify(domainConfig.openai.headers) : undefined,
			modelInfo: domainConfig.openai.modelInfo ? JSON.stringify(domainConfig.openai.modelInfo) : undefined,
		}
	}

	// OpenAI Native
	if (domainConfig.openaiNative) {
		protoConfig.openaiNative = {
			apiKey: domainConfig.openaiNative.apiKey,
		}
	}

	// Azure
	if (domainConfig.azure) {
		protoConfig.azure = {
			apiVersion: domainConfig.azure.apiVersion,
		}
	}

	// OpenRouter
	if (domainConfig.openrouter) {
		protoConfig.openrouter = {
			apiKey: domainConfig.openrouter.apiKey,
			modelId: domainConfig.openrouter.modelId,
			modelInfo: domainConfig.openrouter.modelInfo ? JSON.stringify(domainConfig.openrouter.modelInfo) : undefined,
			providerSorting: domainConfig.openrouter.providerSorting,
		}
	}

	// Ollama
	if (domainConfig.ollama) {
		protoConfig.ollama = {
			modelId: domainConfig.ollama.modelId,
			baseUrl: domainConfig.ollama.baseUrl,
			apiOptionsCtxNum: domainConfig.ollama.apiOptionsCtxNum,
		}
	}

	// LM Studio
	if (domainConfig.lmstudio) {
		protoConfig.lmStudio = {
			modelId: domainConfig.lmstudio.modelId,
			baseUrl: domainConfig.lmstudio.baseUrl,
		}
	}

	// LiteLLM
	if (domainConfig.litellm) {
		protoConfig.litellm = {
			modelId: domainConfig.litellm.modelId,
			baseUrl: domainConfig.litellm.baseUrl,
			apiKey: domainConfig.litellm.apiKey,
			usePromptCache: domainConfig.litellm.usePromptCache,
			modelInfo: domainConfig.litellm.modelInfo ? JSON.stringify(domainConfig.litellm.modelInfo) : undefined,
		}
	}

	// Requesty
	if (domainConfig.requesty) {
		protoConfig.requesty = {
			modelId: domainConfig.requesty.modelId,
			apiKey: domainConfig.requesty.apiKey,
			modelInfo: domainConfig.requesty.modelInfo ? JSON.stringify(domainConfig.requesty.modelInfo) : undefined,
		}
	}

	// AWS
	if (domainConfig.aws) {
		protoConfig.aws = {
			accessKey: domainConfig.aws.accessKey,
			secretKey: domainConfig.aws.secretKey,
			sessionToken: domainConfig.aws.sessionToken,
			region: domainConfig.aws.region,
			useCrossRegionInference: domainConfig.aws.useCrossRegionInference,
			bedrockUsePromptCache: domainConfig.aws.bedrockUsePromptCache,
			bedrockEndpoint: domainConfig.aws.bedrockEndpoint,
			profile: domainConfig.aws.profile,
			useProfile: domainConfig.aws.useProfile,
			bedrockCustomSelected: domainConfig.aws.bedrockCustomSelected,
			bedrockCustomModelBaseId: domainConfig.aws.bedrockCustomModelBaseId as string,
		}
	}

	// Fireworks
	if (domainConfig.fireworks) {
		protoConfig.fireworks = {
			modelId: domainConfig.fireworks.modelId,
			modelMaxCompletionTokens: domainConfig.fireworks.modelMaxCompletionTokens,
			modelMaxTokens: domainConfig.fireworks.modelMaxTokens,
		}
	}

	// Together
	if (domainConfig.together) {
		protoConfig.together = {
			modelId: domainConfig.together.modelId,
			apiKey: domainConfig.together.apiKey,
		}
	}

	// Qwen
	if (domainConfig.qwen) {
		protoConfig.qwen = {
			apiKey: domainConfig.qwen.apiKey,
			apiLine: domainConfig.qwen.apiLine,
		}
	}

	// Doubao
	if (domainConfig.doubao) {
		protoConfig.doubao = {
			apiKey: domainConfig.doubao.apiKey,
		}
	}

	// Mistral
	if (domainConfig.mistral) {
		protoConfig.mistral = {
			apiKey: domainConfig.mistral.apiKey,
		}
	}

	// Vertex
	if (domainConfig.vertex) {
		protoConfig.vertex = {
			projectId: domainConfig.vertex.projectId,
			region: domainConfig.vertex.region,
		}
	}

	// Gemini
	if (domainConfig.gemini) {
		protoConfig.gemini = {
			apiKey: domainConfig.gemini.apiKey,
			baseUrl: domainConfig.gemini.baseUrl,
		}
	}

	// DeepSeek
	if (domainConfig.deepseek) {
		protoConfig.deepseek = {
			apiKey: domainConfig.deepseek.apiKey,
		}
	}

	// AskSage
	if (domainConfig.asksage) {
		protoConfig.asksage = {
			apiKey: domainConfig.asksage.apiKey,
			apiUrl: domainConfig.asksage.apiUrl,
		}
	}

	// XAI
	if (domainConfig.xai) {
		protoConfig.xai = {
			apiKey: domainConfig.xai.apiKey,
		}
	}

	// Nebius
	if (domainConfig.nebius) {
		protoConfig.nebius = {
			apiKey: domainConfig.nebius.apiKey,
		}
	}

	// SambaNova
	if (domainConfig.sambanova) {
		protoConfig.sambanova = {
			apiKey: domainConfig.sambanova.apiKey,
		}
	}

	// Cerebras
	if (domainConfig.cerebras) {
		protoConfig.cerebras = {
			apiKey: domainConfig.cerebras.apiKey,
		}
	}

	// VSCode
	if (domainConfig.vscodelm) {
		protoConfig.vscode = {
			modelSelector: domainConfig.vscodelm.modelSelector ? JSON.stringify(domainConfig.vscodelm.modelSelector) : undefined,
		}
	}

	// Cline
	if (domainConfig.cline) {
		protoConfig.cline = {
			apiKey: domainConfig.cline.apiKey,
		}
	}

	return ApiConfiguration.create(protoConfig as any)
}

/**
 * Converts domain TelemetrySetting to proto TelemetrySetting
 */
export function convertDomainTelemetrySettingToProtoTelemetrySetting(domainSetting: DomainTelemetrySetting): TelemetrySetting {
	return domainSetting === "enabled" ? TelemetrySetting.ENABLED : TelemetrySetting.DISABLED
}

/**
 * Converts domain ChatSettings to proto ChatSettings
 */
export function convertDomainChatSettingsToProtoChatSettings(domainSettings: DomainChatSettings): ChatSettings {
	return ChatSettings.create({
		mode: domainSettings.mode === "plan" ? PlanActMode.PLAN : PlanActMode.ACT,
		preferredLanguage: domainSettings.preferredLanguage,
		openAiReasoningEffort: domainSettings.openAIReasoningEffort,
	})
}
