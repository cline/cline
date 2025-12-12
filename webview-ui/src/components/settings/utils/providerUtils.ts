import {
	ApiConfiguration,
	ApiProvider,
	anthropicDefaultModelId,
	anthropicModels,
	askSageDefaultModelId,
	askSageModels,
	basetenDefaultModelId,
	basetenModels,
	bedrockDefaultModelId,
	bedrockModels,
	cerebrasDefaultModelId,
	cerebrasModels,
	claudeCodeDefaultModelId,
	claudeCodeModels,
	deepSeekDefaultModelId,
	deepSeekModels,
	doubaoDefaultModelId,
	doubaoModels,
	fireworksDefaultModelId,
	fireworksModels,
	geminiDefaultModelId,
	geminiModels,
	groqDefaultModelId,
	groqModels,
	hicapModelInfoSaneDefaults,
	huaweiCloudMaasDefaultModelId,
	huaweiCloudMaasModels,
	huggingFaceDefaultModelId,
	huggingFaceModels,
	internationalQwenDefaultModelId,
	internationalQwenModels,
	internationalZAiDefaultModelId,
	internationalZAiModels,
	liteLlmModelInfoSaneDefaults,
	ModelInfo,
	mainlandQwenDefaultModelId,
	mainlandQwenModels,
	mainlandZAiDefaultModelId,
	mainlandZAiModels,
	minimaxDefaultModelId,
	minimaxModels,
	mistralDefaultModelId,
	mistralModels,
	moonshotDefaultModelId,
	moonshotModels,
	nebiusDefaultModelId,
	nebiusModels,
	nousResearchDefaultModelId,
	nousResearchModels,
	openAiModelInfoSaneDefaults,
	openAiNativeDefaultModelId,
	openAiNativeModels,
	openRouterDefaultModelId,
	openRouterDefaultModelInfo,
	qwenCodeDefaultModelId,
	qwenCodeModels,
	requestyDefaultModelId,
	requestyDefaultModelInfo,
	sambanovaDefaultModelId,
	sambanovaModels,
	sapAiCoreDefaultModelId,
	sapAiCoreModels,
	vertexDefaultModelId,
	vertexModels,
	xaiDefaultModelId,
	xaiModels,
} from "@shared/api"
import { Mode } from "@shared/storage/types"

/**
 * Returns the static model list for a provider.
 * For providers with dynamic models (openrouter, cline, ollama, etc.), returns undefined.
 * Some providers depend on configuration (qwen, zai) for region-specific models.
 */
export function getModelsForProvider(
	provider: ApiProvider,
	apiConfiguration?: ApiConfiguration,
): Record<string, ModelInfo> | undefined {
	switch (provider) {
		case "anthropic":
			return anthropicModels
		case "claude-code":
			return claudeCodeModels
		case "bedrock":
			return bedrockModels
		case "vertex":
			return vertexModels
		case "gemini":
			return geminiModels
		case "openai-native":
			return openAiNativeModels
		case "deepseek":
			return deepSeekModels
		case "qwen":
			return apiConfiguration?.qwenApiLine === "china" ? mainlandQwenModels : internationalQwenModels
		case "qwen-code":
			return qwenCodeModels
		case "doubao":
			return doubaoModels
		case "mistral":
			return mistralModels
		case "asksage":
			return askSageModels
		case "xai":
			return xaiModels
		case "moonshot":
			return moonshotModels
		case "nebius":
			return nebiusModels
		case "sambanova":
			return sambanovaModels
		case "cerebras":
			return cerebrasModels
		case "groq":
			return groqModels
		case "baseten":
			return basetenModels
		case "sapaicore":
			return sapAiCoreModels
		case "huawei-cloud-maas":
			return huaweiCloudMaasModels
		case "zai":
			return apiConfiguration?.zaiApiLine === "china" ? mainlandZAiModels : internationalZAiModels
		case "fireworks":
			return fireworksModels
		case "minimax":
			return minimaxModels
		case "huggingface":
			return huggingFaceModels
		case "nousResearch":
			return nousResearchModels
		// Providers with dynamic models - return undefined
		case "openrouter":
		case "cline":
		case "openai":
		case "ollama":
		case "lmstudio":
		case "vscode-lm":
		case "litellm":
		case "requesty":
		case "hicap":
		case "dify":
		case "vercel-ai-gateway":
		case "oca":
		case "aihubmix":
		case "together":
		default:
			return undefined
	}
}

/**
 * Interface for normalized API configuration
 */
export interface NormalizedApiConfig {
	selectedProvider: ApiProvider
	selectedModelId: string
	selectedModelInfo: ModelInfo
}

/**
 * Normalizes API configuration to ensure consistent values
 */
export function normalizeApiConfiguration(
	apiConfiguration: ApiConfiguration | undefined,
	currentMode: Mode,
	liteLlmModels?: Record<string, ModelInfo>,
): NormalizedApiConfig {
	const provider =
		(currentMode === "plan" ? apiConfiguration?.planModeApiProvider : apiConfiguration?.actModeApiProvider) || "anthropic"

	const modelId = currentMode === "plan" ? apiConfiguration?.planModeApiModelId : apiConfiguration?.actModeApiModelId

	const getProviderData = (models: Record<string, ModelInfo>, defaultId: string) => {
		let selectedModelId: string
		let selectedModelInfo: ModelInfo
		if (modelId && modelId in models) {
			selectedModelId = modelId
			selectedModelInfo = models[modelId]
		} else {
			selectedModelId = defaultId
			selectedModelInfo = models[defaultId]
		}
		return {
			selectedProvider: provider,
			selectedModelId,
			selectedModelInfo,
		}
	}

	switch (provider) {
		case "anthropic":
			return getProviderData(anthropicModels, anthropicDefaultModelId)
		case "claude-code":
			return getProviderData(claudeCodeModels, claudeCodeDefaultModelId)
		case "bedrock":
			const awsBedrockCustomSelected =
				currentMode === "plan"
					? apiConfiguration?.planModeAwsBedrockCustomSelected
					: apiConfiguration?.actModeAwsBedrockCustomSelected
			if (awsBedrockCustomSelected) {
				const baseModelId =
					currentMode === "plan"
						? apiConfiguration?.planModeAwsBedrockCustomModelBaseId
						: apiConfiguration?.actModeAwsBedrockCustomModelBaseId

				return {
					selectedProvider: provider,
					selectedModelId: modelId || bedrockDefaultModelId,
					selectedModelInfo:
						(baseModelId && bedrockModels[baseModelId as keyof typeof bedrockModels]) ||
						bedrockModels[bedrockDefaultModelId],
				}
			}
			return getProviderData(bedrockModels, bedrockDefaultModelId)
		case "vertex":
			return getProviderData(vertexModels, vertexDefaultModelId)
		case "gemini":
			return getProviderData(geminiModels, geminiDefaultModelId)
		case "openai-native":
			return getProviderData(openAiNativeModels, openAiNativeDefaultModelId)
		case "deepseek":
			return getProviderData(deepSeekModels, deepSeekDefaultModelId)
		case "qwen":
			const qwenModels = apiConfiguration?.qwenApiLine === "china" ? mainlandQwenModels : internationalQwenModels
			const qwenDefaultId =
				apiConfiguration?.qwenApiLine === "china" ? mainlandQwenDefaultModelId : internationalQwenDefaultModelId
			return getProviderData(qwenModels, qwenDefaultId)
		case "qwen-code":
			return getProviderData(qwenCodeModels, qwenCodeDefaultModelId)
		case "doubao":
			return getProviderData(doubaoModels, doubaoDefaultModelId)
		case "mistral":
			return getProviderData(mistralModels, mistralDefaultModelId)
		case "asksage":
			return getProviderData(askSageModels, askSageDefaultModelId)
		case "openrouter":
			const openRouterModelId =
				currentMode === "plan" ? apiConfiguration?.planModeOpenRouterModelId : apiConfiguration?.actModeOpenRouterModelId
			const openRouterModelInfo =
				currentMode === "plan"
					? apiConfiguration?.planModeOpenRouterModelInfo
					: apiConfiguration?.actModeOpenRouterModelInfo
			return {
				selectedProvider: provider,
				selectedModelId: openRouterModelId || openRouterDefaultModelId,
				selectedModelInfo: openRouterModelInfo || openRouterDefaultModelInfo,
			}
		case "requesty":
			const requestyModelId =
				currentMode === "plan" ? apiConfiguration?.planModeRequestyModelId : apiConfiguration?.actModeRequestyModelId
			const requestyModelInfo =
				currentMode === "plan" ? apiConfiguration?.planModeRequestyModelInfo : apiConfiguration?.actModeRequestyModelInfo
			return {
				selectedProvider: provider,
				selectedModelId: requestyModelId || requestyDefaultModelId,
				selectedModelInfo: requestyModelInfo || requestyDefaultModelInfo,
			}
		case "cline":
			const clineOpenRouterModelId =
				(currentMode === "plan"
					? apiConfiguration?.planModeOpenRouterModelId
					: apiConfiguration?.actModeOpenRouterModelId) || openRouterDefaultModelId
			const clineOpenRouterModelInfo =
				(currentMode === "plan"
					? apiConfiguration?.planModeOpenRouterModelInfo
					: apiConfiguration?.actModeOpenRouterModelInfo) || openRouterDefaultModelInfo
			return {
				selectedProvider: provider,
				selectedModelId: clineOpenRouterModelId,
				selectedModelInfo: clineOpenRouterModelInfo,
			}
		case "openai":
			const openAiModelId =
				currentMode === "plan" ? apiConfiguration?.planModeOpenAiModelId : apiConfiguration?.actModeOpenAiModelId
			const openAiModelInfo =
				currentMode === "plan" ? apiConfiguration?.planModeOpenAiModelInfo : apiConfiguration?.actModeOpenAiModelInfo
			return {
				selectedProvider: provider,
				selectedModelId: openAiModelId || "",
				selectedModelInfo: openAiModelInfo || openAiModelInfoSaneDefaults,
			}
		case "hicap":
			const hicapModelId =
				currentMode === "plan" ? apiConfiguration?.planModeHicapModelId : apiConfiguration?.actModeHicapModelId
			return {
				selectedProvider: provider,
				selectedModelId: hicapModelId || "",
				selectedModelInfo: hicapModelInfoSaneDefaults,
			}
		case "ollama":
			const ollamaModelId =
				currentMode === "plan" ? apiConfiguration?.planModeOllamaModelId : apiConfiguration?.actModeOllamaModelId
			return {
				selectedProvider: provider,
				selectedModelId: ollamaModelId || "",
				selectedModelInfo: {
					...openAiModelInfoSaneDefaults,
					contextWindow: Number(apiConfiguration?.ollamaApiOptionsCtxNum ?? 32768),
				},
			}
		case "lmstudio":
			const lmStudioModelId =
				currentMode === "plan" ? apiConfiguration?.planModeLmStudioModelId : apiConfiguration?.actModeLmStudioModelId
			return {
				selectedProvider: provider,
				selectedModelId: lmStudioModelId || "",
				selectedModelInfo: {
					...openAiModelInfoSaneDefaults,
					contextWindow: Number(apiConfiguration?.lmStudioMaxTokens ?? 32768),
				},
			}
		case "vscode-lm":
			const vsCodeLmModelSelector =
				currentMode === "plan"
					? apiConfiguration?.planModeVsCodeLmModelSelector
					: apiConfiguration?.actModeVsCodeLmModelSelector
			return {
				selectedProvider: provider,
				selectedModelId: vsCodeLmModelSelector ? `${vsCodeLmModelSelector.vendor}/${vsCodeLmModelSelector.family}` : "",
				selectedModelInfo: {
					...openAiModelInfoSaneDefaults,
					supportsImages: false, // VSCode LM API currently doesn't support images
				},
			}
		case "litellm":
			const liteLlmModelId =
				currentMode === "plan" ? apiConfiguration?.planModeLiteLlmModelId : apiConfiguration?.actModeLiteLlmModelId
			// model info lookup
			const liteLlmModelInfo = liteLlmModels?.[liteLlmModelId || ""]
			return {
				selectedProvider: provider,
				selectedModelId: liteLlmModelId || "",
				selectedModelInfo: liteLlmModelInfo || ({} as ModelInfo),
			}
		case "xai":
			return getProviderData(xaiModels, xaiDefaultModelId)
		case "moonshot":
			return getProviderData(moonshotModels, moonshotDefaultModelId)
		case "huggingface":
			const huggingFaceModelId =
				currentMode === "plan"
					? apiConfiguration?.planModeHuggingFaceModelId
					: apiConfiguration?.actModeHuggingFaceModelId
			const huggingFaceModelInfo =
				currentMode === "plan"
					? apiConfiguration?.planModeHuggingFaceModelInfo
					: apiConfiguration?.actModeHuggingFaceModelInfo
			return {
				selectedProvider: provider,
				selectedModelId: huggingFaceModelId || huggingFaceDefaultModelId,
				selectedModelInfo: huggingFaceModelInfo || huggingFaceModels[huggingFaceDefaultModelId],
			}
		case "nebius":
			return getProviderData(nebiusModels, nebiusDefaultModelId)
		case "sambanova":
			return getProviderData(sambanovaModels, sambanovaDefaultModelId)
		case "cerebras":
			return getProviderData(cerebrasModels, cerebrasDefaultModelId)
		case "groq":
			const groqModelId =
				currentMode === "plan" ? apiConfiguration?.planModeGroqModelId : apiConfiguration?.actModeGroqModelId
			const groqModelInfo =
				currentMode === "plan" ? apiConfiguration?.planModeGroqModelInfo : apiConfiguration?.actModeGroqModelInfo
			return {
				selectedProvider: provider,
				selectedModelId: groqModelId || groqDefaultModelId,
				selectedModelInfo: groqModelInfo || groqModels[groqDefaultModelId],
			}
		case "baseten":
			const basetenModelId =
				currentMode === "plan" ? apiConfiguration?.planModeBasetenModelId : apiConfiguration?.actModeBasetenModelId
			const basetenModelInfo =
				currentMode === "plan" ? apiConfiguration?.planModeBasetenModelInfo : apiConfiguration?.actModeBasetenModelInfo
			const finalBasetenModelId = basetenModelId || basetenDefaultModelId
			return {
				selectedProvider: provider,
				selectedModelId: finalBasetenModelId,
				selectedModelInfo: basetenModelInfo ||
					basetenModels[finalBasetenModelId as keyof typeof basetenModels] ||
					basetenModels[basetenDefaultModelId] || {
						description: "Baseten model",
					},
			}
		case "sapaicore":
			return getProviderData(sapAiCoreModels, sapAiCoreDefaultModelId)
		case "huawei-cloud-maas":
			const huaweiCloudMaasModelId =
				currentMode === "plan"
					? apiConfiguration?.planModeHuaweiCloudMaasModelId
					: apiConfiguration?.actModeHuaweiCloudMaasModelId
			const huaweiCloudMaasModelInfo =
				currentMode === "plan"
					? apiConfiguration?.planModeHuaweiCloudMaasModelInfo
					: apiConfiguration?.actModeHuaweiCloudMaasModelInfo
			return {
				selectedProvider: provider,
				selectedModelId: huaweiCloudMaasModelId || huaweiCloudMaasDefaultModelId,
				selectedModelInfo: huaweiCloudMaasModelInfo || huaweiCloudMaasModels[huaweiCloudMaasDefaultModelId],
			}
		case "dify":
			return {
				selectedProvider: provider,
				selectedModelId: "dify-workflow",
				selectedModelInfo: {
					maxTokens: 8192,
					contextWindow: 128000,
					supportsImages: true,
					supportsPromptCache: false,
					inputPrice: 0,
					outputPrice: 0,
					description: "Dify workflow - model selection is configured in your Dify application",
				},
			}
		case "vercel-ai-gateway":
			// Vercel AI Gateway uses OpenRouter model fields
			const vercelModelId =
				currentMode === "plan" ? apiConfiguration?.planModeOpenRouterModelId : apiConfiguration?.actModeOpenRouterModelId
			const vercelModelInfo =
				currentMode === "plan"
					? apiConfiguration?.planModeOpenRouterModelInfo
					: apiConfiguration?.actModeOpenRouterModelInfo
			return {
				selectedProvider: provider,
				selectedModelId: vercelModelId || openRouterDefaultModelId,
				selectedModelInfo: vercelModelInfo || openRouterDefaultModelInfo,
			}
		case "zai":
			const zaiModels = apiConfiguration?.zaiApiLine === "china" ? mainlandZAiModels : internationalZAiModels
			const zaiDefaultId =
				apiConfiguration?.zaiApiLine === "china" ? mainlandZAiDefaultModelId : internationalZAiDefaultModelId
			return getProviderData(zaiModels, zaiDefaultId)
		case "fireworks":
			const fireworksModelId =
				currentMode === "plan" ? apiConfiguration?.planModeFireworksModelId : apiConfiguration?.actModeFireworksModelId
			return {
				selectedProvider: provider,
				selectedModelId: fireworksModelId || fireworksDefaultModelId,
				selectedModelInfo:
					fireworksModelId && fireworksModelId in fireworksModels
						? fireworksModels[fireworksModelId as keyof typeof fireworksModels]
						: fireworksModels[fireworksDefaultModelId],
			}
		case "oca":
			const ocaModelId = currentMode === "plan" ? apiConfiguration?.planModeOcaModelId : apiConfiguration?.actModeOcaModelId
			const ocaModelInfo =
				currentMode === "plan" ? apiConfiguration?.planModeOcaModelInfo : apiConfiguration?.actModeOcaModelInfo
			return {
				selectedProvider: provider,
				selectedModelId: ocaModelId || "",
				selectedModelInfo: ocaModelInfo || liteLlmModelInfoSaneDefaults,
			}
		case "aihubmix":
			const aihubmixModelId =
				currentMode === "plan" ? apiConfiguration?.planModeAihubmixModelId : apiConfiguration?.actModeAihubmixModelId
			const aihubmixModelInfo =
				currentMode === "plan" ? apiConfiguration?.planModeAihubmixModelInfo : apiConfiguration?.actModeAihubmixModelInfo
			return {
				selectedProvider: provider,
				selectedModelId: aihubmixModelId || "",
				selectedModelInfo: aihubmixModelInfo || openAiModelInfoSaneDefaults,
			}
		case "minimax":
			return getProviderData(minimaxModels, minimaxDefaultModelId)
		case "nousResearch":
			const nousResearchModelId =
				currentMode === "plan"
					? apiConfiguration?.planModeNousResearchModelId
					: apiConfiguration?.actModeNousResearchModelId
			return {
				selectedProvider: provider,
				selectedModelId: nousResearchModelId || nousResearchDefaultModelId,
				selectedModelInfo:
					nousResearchModelId && nousResearchModelId in nousResearchModels
						? nousResearchModels[nousResearchModelId as keyof typeof nousResearchModels]
						: nousResearchModels[nousResearchDefaultModelId],
			}
		default:
			return getProviderData(anthropicModels, anthropicDefaultModelId)
	}
}

/**
 * Gets mode-specific field values from API configuration
 * @param apiConfiguration The API configuration object
 * @param mode The current mode ("plan" or "act")
 * @returns Object containing mode-specific field values for clean destructuring
 */
export function getModeSpecificFields(apiConfiguration: ApiConfiguration | undefined, mode: Mode) {
	if (!apiConfiguration) {
		return {
			// Core fields
			apiProvider: undefined,
			apiModelId: undefined,

			// Provider-specific model IDs
			togetherModelId: undefined,
			fireworksModelId: undefined,
			lmStudioModelId: undefined,
			ollamaModelId: undefined,
			liteLlmModelId: undefined,
			requestyModelId: undefined,
			openAiModelId: undefined,
			openRouterModelId: undefined,
			groqModelId: undefined,
			basetenModelId: undefined,
			huggingFaceModelId: undefined,
			huaweiCloudMaasModelId: undefined,
			hicapModelId: undefined,
			aihubmixModelId: undefined,
			nousResearchModelId: undefined,

			// Model info objects
			openAiModelInfo: undefined,
			liteLlmModelInfo: undefined,
			openRouterModelInfo: undefined,
			requestyModelInfo: undefined,
			groqModelInfo: undefined,
			basetenModelInfo: undefined,
			huggingFaceModelInfo: undefined,
			vsCodeLmModelSelector: undefined,
			aihubmixModelInfo: undefined,

			// AWS Bedrock fields
			awsBedrockCustomSelected: undefined,
			awsBedrockCustomModelBaseId: undefined,

			// Huawei Cloud Maas Model Info
			huaweiCloudMaasModelInfo: undefined,

			// Other mode-specific fields
			thinkingBudgetTokens: undefined,
			reasoningEffort: undefined,
		}
	}

	return {
		// Core fields
		apiProvider: mode === "plan" ? apiConfiguration.planModeApiProvider : apiConfiguration.actModeApiProvider,
		apiModelId: mode === "plan" ? apiConfiguration.planModeApiModelId : apiConfiguration.actModeApiModelId,

		// Provider-specific model IDs
		togetherModelId: mode === "plan" ? apiConfiguration.planModeTogetherModelId : apiConfiguration.actModeTogetherModelId,
		fireworksModelId: mode === "plan" ? apiConfiguration.planModeFireworksModelId : apiConfiguration.actModeFireworksModelId,
		lmStudioModelId: mode === "plan" ? apiConfiguration.planModeLmStudioModelId : apiConfiguration.actModeLmStudioModelId,
		ollamaModelId: mode === "plan" ? apiConfiguration.planModeOllamaModelId : apiConfiguration.actModeOllamaModelId,
		liteLlmModelId: mode === "plan" ? apiConfiguration.planModeLiteLlmModelId : apiConfiguration.actModeLiteLlmModelId,
		requestyModelId: mode === "plan" ? apiConfiguration.planModeRequestyModelId : apiConfiguration.actModeRequestyModelId,
		openAiModelId: mode === "plan" ? apiConfiguration.planModeOpenAiModelId : apiConfiguration.actModeOpenAiModelId,
		openRouterModelId:
			mode === "plan" ? apiConfiguration.planModeOpenRouterModelId : apiConfiguration.actModeOpenRouterModelId,
		groqModelId: mode === "plan" ? apiConfiguration.planModeGroqModelId : apiConfiguration.actModeGroqModelId,
		basetenModelId: mode === "plan" ? apiConfiguration.planModeBasetenModelId : apiConfiguration.actModeBasetenModelId,
		huggingFaceModelId:
			mode === "plan" ? apiConfiguration.planModeHuggingFaceModelId : apiConfiguration.actModeHuggingFaceModelId,
		huaweiCloudMaasModelId:
			mode === "plan" ? apiConfiguration.planModeHuaweiCloudMaasModelId : apiConfiguration.actModeHuaweiCloudMaasModelId,
		ocaModelId: mode === "plan" ? apiConfiguration.planModeOcaModelId : apiConfiguration.actModeOcaModelId,
		hicapModelId: mode === "plan" ? apiConfiguration.planModeHicapModelId : apiConfiguration.actModeHicapModelId,
		aihubmixModelId: mode === "plan" ? apiConfiguration.planModeAihubmixModelId : apiConfiguration.actModeAihubmixModelId,
		nousResearchModelId:
			mode === "plan" ? apiConfiguration.planModeNousResearchModelId : apiConfiguration.actModeNousResearchModelId,

		// Model info objects
		openAiModelInfo: mode === "plan" ? apiConfiguration.planModeOpenAiModelInfo : apiConfiguration.actModeOpenAiModelInfo,
		liteLlmModelInfo: mode === "plan" ? apiConfiguration.planModeLiteLlmModelInfo : apiConfiguration.actModeLiteLlmModelInfo,
		openRouterModelInfo:
			mode === "plan" ? apiConfiguration.planModeOpenRouterModelInfo : apiConfiguration.actModeOpenRouterModelInfo,
		requestyModelInfo:
			mode === "plan" ? apiConfiguration.planModeRequestyModelInfo : apiConfiguration.actModeRequestyModelInfo,
		groqModelInfo: mode === "plan" ? apiConfiguration.planModeGroqModelInfo : apiConfiguration.actModeGroqModelInfo,
		basetenModelInfo: mode === "plan" ? apiConfiguration.planModeBasetenModelInfo : apiConfiguration.actModeBasetenModelInfo,
		huggingFaceModelInfo:
			mode === "plan" ? apiConfiguration.planModeHuggingFaceModelInfo : apiConfiguration.actModeHuggingFaceModelInfo,
		vsCodeLmModelSelector:
			mode === "plan" ? apiConfiguration.planModeVsCodeLmModelSelector : apiConfiguration.actModeVsCodeLmModelSelector,
		hicapModelInfo: mode === "plan" ? apiConfiguration.planModeHicapModelInfo : apiConfiguration.actModeHicapModelInfo,
		aihubmixModelInfo:
			mode === "plan" ? apiConfiguration.planModeAihubmixModelInfo : apiConfiguration.actModeAihubmixModelInfo,

		// AWS Bedrock fields
		awsBedrockCustomSelected:
			mode === "plan"
				? apiConfiguration.planModeAwsBedrockCustomSelected
				: apiConfiguration.actModeAwsBedrockCustomSelected,
		awsBedrockCustomModelBaseId:
			mode === "plan"
				? apiConfiguration.planModeAwsBedrockCustomModelBaseId
				: apiConfiguration.actModeAwsBedrockCustomModelBaseId,

		// Huawei Cloud Maas Model Info
		huaweiCloudMaasModelInfo:
			mode === "plan"
				? apiConfiguration.planModeHuaweiCloudMaasModelInfo
				: apiConfiguration.actModeHuaweiCloudMaasModelInfo,

		// Other mode-specific fields
		thinkingBudgetTokens:
			mode === "plan" ? apiConfiguration.planModeThinkingBudgetTokens : apiConfiguration.actModeThinkingBudgetTokens,
		reasoningEffort: mode === "plan" ? apiConfiguration.planModeReasoningEffort : apiConfiguration.actModeReasoningEffort,
		// Oracle Code Assist
		ocaModelInfo: mode === "plan" ? apiConfiguration.planModeOcaModelInfo : apiConfiguration.actModeOcaModelInfo,
	}
}

/**
 * Synchronizes mode configurations by copying the source mode's settings to both modes
 * This is used when the "Use different models for Plan and Act modes" toggle is unchecked
 */
export async function syncModeConfigurations(
	apiConfiguration: ApiConfiguration | undefined,
	sourceMode: Mode,
	handleFieldsChange: (updates: Partial<ApiConfiguration>) => Promise<void>,
): Promise<void> {
	if (!apiConfiguration) {
		return
	}

	const sourceFields = getModeSpecificFields(apiConfiguration, sourceMode)
	const { apiProvider } = sourceFields

	if (!apiProvider) {
		return
	}

	// Build the complete update object with both plan and act mode fields
	const updates: Partial<ApiConfiguration> = {
		// Always sync common fields
		planModeApiProvider: sourceFields.apiProvider,
		actModeApiProvider: sourceFields.apiProvider,
		planModeThinkingBudgetTokens: sourceFields.thinkingBudgetTokens,
		actModeThinkingBudgetTokens: sourceFields.thinkingBudgetTokens,
		planModeReasoningEffort: sourceFields.reasoningEffort,
		actModeReasoningEffort: sourceFields.reasoningEffort,
	}

	// Handle provider-specific fields
	switch (apiProvider) {
		case "openrouter":
		case "cline":
			updates.planModeOpenRouterModelId = sourceFields.openRouterModelId
			updates.actModeOpenRouterModelId = sourceFields.openRouterModelId
			updates.planModeOpenRouterModelInfo = sourceFields.openRouterModelInfo
			updates.actModeOpenRouterModelInfo = sourceFields.openRouterModelInfo
			break

		case "requesty":
			updates.planModeRequestyModelId = sourceFields.requestyModelId
			updates.actModeRequestyModelId = sourceFields.requestyModelId
			updates.planModeRequestyModelInfo = sourceFields.requestyModelInfo
			updates.actModeRequestyModelInfo = sourceFields.requestyModelInfo
			break

		case "openai":
			updates.planModeOpenAiModelId = sourceFields.openAiModelId
			updates.actModeOpenAiModelId = sourceFields.openAiModelId
			updates.planModeOpenAiModelInfo = sourceFields.openAiModelInfo
			updates.actModeOpenAiModelInfo = sourceFields.openAiModelInfo
			break

		case "ollama":
			updates.planModeOllamaModelId = sourceFields.ollamaModelId
			updates.actModeOllamaModelId = sourceFields.ollamaModelId
			break

		case "lmstudio":
			updates.planModeLmStudioModelId = sourceFields.lmStudioModelId
			updates.actModeLmStudioModelId = sourceFields.lmStudioModelId
			break

		case "vscode-lm":
			updates.planModeVsCodeLmModelSelector = sourceFields.vsCodeLmModelSelector
			updates.actModeVsCodeLmModelSelector = sourceFields.vsCodeLmModelSelector
			break

		case "litellm":
			updates.planModeLiteLlmModelId = sourceFields.liteLlmModelId
			updates.actModeLiteLlmModelId = sourceFields.liteLlmModelId
			updates.planModeLiteLlmModelInfo = sourceFields.liteLlmModelInfo
			updates.actModeLiteLlmModelInfo = sourceFields.liteLlmModelInfo
			break

		case "groq":
			updates.planModeGroqModelId = sourceFields.groqModelId
			updates.actModeGroqModelId = sourceFields.groqModelId
			updates.planModeGroqModelInfo = sourceFields.groqModelInfo
			updates.actModeGroqModelInfo = sourceFields.groqModelInfo
			break

		case "huggingface":
			updates.planModeHuggingFaceModelId = sourceFields.huggingFaceModelId
			updates.actModeHuggingFaceModelId = sourceFields.huggingFaceModelId
			updates.planModeHuggingFaceModelInfo = sourceFields.huggingFaceModelInfo
			updates.actModeHuggingFaceModelInfo = sourceFields.huggingFaceModelInfo
			break

		case "baseten":
			updates.planModeBasetenModelId = sourceFields.basetenModelId
			updates.actModeBasetenModelId = sourceFields.basetenModelId
			updates.planModeBasetenModelInfo = sourceFields.basetenModelInfo
			updates.actModeBasetenModelInfo = sourceFields.basetenModelInfo
			break

		case "together":
			updates.planModeTogetherModelId = sourceFields.togetherModelId
			updates.actModeTogetherModelId = sourceFields.togetherModelId
			break

		case "fireworks":
			updates.planModeFireworksModelId = sourceFields.fireworksModelId
			updates.actModeFireworksModelId = sourceFields.fireworksModelId
			break

		case "bedrock":
			updates.planModeApiModelId = sourceFields.apiModelId
			updates.actModeApiModelId = sourceFields.apiModelId
			updates.planModeAwsBedrockCustomSelected = sourceFields.awsBedrockCustomSelected
			updates.actModeAwsBedrockCustomSelected = sourceFields.awsBedrockCustomSelected
			updates.planModeAwsBedrockCustomModelBaseId = sourceFields.awsBedrockCustomModelBaseId
			updates.actModeAwsBedrockCustomModelBaseId = sourceFields.awsBedrockCustomModelBaseId
			break
		case "huawei-cloud-maas":
			updates.planModeHuaweiCloudMaasModelId = sourceFields.huaweiCloudMaasModelId
			updates.actModeHuaweiCloudMaasModelId = sourceFields.huaweiCloudMaasModelId
			updates.planModeHuaweiCloudMaasModelInfo = sourceFields.huaweiCloudMaasModelInfo
			updates.actModeHuaweiCloudMaasModelInfo = sourceFields.huaweiCloudMaasModelInfo
			break

		case "dify":
			// Dify doesn't have mode-specific model configurations
			// The model is configured in the Dify application itself
			break

		case "hicap":
			updates.planModeHicapModelId = sourceFields.hicapModelId
			updates.actModeHicapModelId = sourceFields.hicapModelId
			updates.planModeHicapModelInfo = sourceFields.hicapModelInfo
			updates.actModeHicapModelInfo = sourceFields.hicapModelInfo
			break

		case "vercel-ai-gateway":
			// Vercel AI Gateway uses OpenRouter model fields
			updates.planModeOpenRouterModelId = sourceFields.openRouterModelId
			updates.actModeOpenRouterModelId = sourceFields.openRouterModelId
			updates.planModeOpenRouterModelInfo = sourceFields.openRouterModelInfo
			updates.actModeOpenRouterModelInfo = sourceFields.openRouterModelInfo
			break
		case "oca":
			updates.planModeOcaModelId = sourceFields.ocaModelId
			updates.actModeOcaModelId = sourceFields.ocaModelId
			updates.planModeOcaModelInfo = sourceFields.ocaModelInfo
			updates.actModeOcaModelInfo = sourceFields.ocaModelInfo
			break
		case "nousResearch":
			updates.planModeNousResearchModelId = sourceFields.nousResearchModelId
			updates.actModeNousResearchModelId = sourceFields.nousResearchModelId
			break

		case "aihubmix":
			updates.planModeAihubmixModelId = sourceFields.aihubmixModelId
			updates.planModeAihubmixModelInfo = sourceFields.aihubmixModelInfo
			updates.actModeAihubmixModelId = sourceFields.aihubmixModelId
			updates.actModeAihubmixModelInfo = sourceFields.aihubmixModelInfo
			break

		// Providers that use apiProvider + apiModelId fields
		case "anthropic":
		case "claude-code":
		case "vertex":
		case "gemini":
		case "openai-native":
		case "deepseek":
		case "qwen":
		case "doubao":
		case "mistral":
		case "asksage":
		case "xai":
		case "nebius":
		case "sambanova":
		case "cerebras":
		case "sapaicore":
		case "zai":
		case "minimax":
		default:
			updates.planModeApiModelId = sourceFields.apiModelId
			updates.actModeApiModelId = sourceFields.apiModelId
			break
	}

	// Make the atomic update
	await handleFieldsChange(updates)
}
