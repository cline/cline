import {
	ApiConfiguration,
	ApiProvider,
	ModelInfo,
	anthropicDefaultModelId,
	anthropicModels,
	bedrockDefaultModelId,
	bedrockModels,
	deepSeekDefaultModelId,
	deepSeekModels,
	geminiDefaultModelId,
	geminiModels,
	mistralDefaultModelId,
	mistralModels,
	openAiModelInfoSaneDefaults,
	openAiNativeDefaultModelId,
	openAiNativeModels,
	openRouterDefaultModelId,
	openRouterDefaultModelInfo,
	requestyDefaultModelId,
	requestyDefaultModelInfo,
	mainlandQwenModels,
	internationalQwenModels,
	mainlandQwenDefaultModelId,
	internationalQwenDefaultModelId,
	vertexDefaultModelId,
	vertexModels,
	askSageModels,
	askSageDefaultModelId,
	xaiDefaultModelId,
	xaiModels,
	sambanovaModels,
	sambanovaDefaultModelId,
	doubaoModels,
	doubaoDefaultModelId,
	liteLlmModelInfoSaneDefaults,
	moonshotModels,
	moonshotDefaultModelId,
	huggingFaceModels,
	huggingFaceDefaultModelId,
	nebiusModels,
	nebiusDefaultModelId,
	cerebrasModels,
	cerebrasDefaultModelId,
	sapAiCoreModels,
	sapAiCoreDefaultModelId,
	claudeCodeDefaultModelId,
	claudeCodeModels,
	groqModels,
	groqDefaultModelId,
} from "@shared/api"
import { Mode } from "@shared/ChatSettings"

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
): NormalizedApiConfig {
	const provider =
		(currentMode === "plan" ? apiConfiguration?.planModeApiProvider : apiConfiguration?.actModeApiProvider) || "anthropic"

	const getProviderData = (models: Record<string, ModelInfo>, defaultId: string, modelId?: string) => {
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
			const anthropicModelId =
				currentMode === "plan" ? apiConfiguration?.planModeAnthropicModelId : apiConfiguration?.actModeAnthropicModelId
			return getProviderData(anthropicModels, anthropicDefaultModelId, anthropicModelId)
		case "claude-code":
			const claudeCodeModelId =
				currentMode === "plan" ? apiConfiguration?.planModeClaudeCodeModelId : apiConfiguration?.actModeClaudeCodeModelId
			return getProviderData(claudeCodeModels, claudeCodeDefaultModelId, claudeCodeModelId)
		case "bedrock":
			const awsBedrockCustomSelected =
				currentMode === "plan"
					? apiConfiguration?.planModeAwsBedrockCustomSelected
					: apiConfiguration?.actModeAwsBedrockCustomSelected
			const bedrockModelId =
				currentMode === "plan" ? apiConfiguration?.planModeAwsBedrockModelId : apiConfiguration?.actModeAwsBedrockModelId
			if (awsBedrockCustomSelected) {
				const baseModelId =
					currentMode === "plan"
						? apiConfiguration?.planModeAwsBedrockCustomModelBaseId
						: apiConfiguration?.actModeAwsBedrockCustomModelBaseId
				return {
					selectedProvider: provider,
					selectedModelId: bedrockModelId || bedrockDefaultModelId,
					selectedModelInfo: (baseModelId && bedrockModels[baseModelId]) || bedrockModels[bedrockDefaultModelId],
				}
			}
			return getProviderData(bedrockModels, bedrockDefaultModelId, bedrockModelId)
		case "vertex":
			const vertexModelId =
				currentMode === "plan" ? apiConfiguration?.planModeVertexModelId : apiConfiguration?.actModeVertexModelId
			return getProviderData(vertexModels, vertexDefaultModelId, vertexModelId)
		case "gemini":
			const geminiModelId =
				currentMode === "plan" ? apiConfiguration?.planModeGeminiModelId : apiConfiguration?.actModeGeminiModelId
			return getProviderData(geminiModels, geminiDefaultModelId, geminiModelId)
		case "openai-native":
			const openAiNativeModelId =
				currentMode === "plan"
					? apiConfiguration?.planModeOpenAiNativeModelId
					: apiConfiguration?.actModeOpenAiNativeModelId
			return getProviderData(openAiNativeModels, openAiNativeDefaultModelId, openAiNativeModelId)
		case "deepseek":
			const deepSeekModelId =
				currentMode === "plan" ? apiConfiguration?.planModeDeepSeekModelId : apiConfiguration?.actModeDeepSeekModelId
			return getProviderData(deepSeekModels, deepSeekDefaultModelId, deepSeekModelId)
		case "qwen":
			const qwenModels = apiConfiguration?.qwenApiLine === "china" ? mainlandQwenModels : internationalQwenModels
			const qwenDefaultId =
				apiConfiguration?.qwenApiLine === "china" ? mainlandQwenDefaultModelId : internationalQwenDefaultModelId
			const qwenModelId =
				currentMode === "plan" ? apiConfiguration?.planModeQwenModelId : apiConfiguration?.actModeQwenModelId
			return getProviderData(qwenModels, qwenDefaultId, qwenModelId)
		case "doubao":
			const doubaoModelId =
				currentMode === "plan" ? apiConfiguration?.planModeDoubaoModelId : apiConfiguration?.actModeDoubaoModelId
			return getProviderData(doubaoModels, doubaoDefaultModelId, doubaoModelId)
		case "mistral":
			const mistralModelId =
				currentMode === "plan" ? apiConfiguration?.planModeMistralModelId : apiConfiguration?.actModeMistralModelId
			return getProviderData(mistralModels, mistralDefaultModelId, mistralModelId)
		case "asksage":
			const askSageModelId =
				currentMode === "plan" ? apiConfiguration?.planModeAskSageModelId : apiConfiguration?.actModeAskSageModelId
			return getProviderData(askSageModels, askSageDefaultModelId, askSageModelId)
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
		case "ollama":
			const ollamaModelId =
				currentMode === "plan" ? apiConfiguration?.planModeOllamaModelId : apiConfiguration?.actModeOllamaModelId
			return {
				selectedProvider: provider,
				selectedModelId: ollamaModelId || "",
				selectedModelInfo: openAiModelInfoSaneDefaults,
			}
		case "lmstudio":
			const lmStudioModelId =
				currentMode === "plan" ? apiConfiguration?.planModeLmStudioModelId : apiConfiguration?.actModeLmStudioModelId
			return {
				selectedProvider: provider,
				selectedModelId: lmStudioModelId || "",
				selectedModelInfo: openAiModelInfoSaneDefaults,
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
			const liteLlmModelInfo =
				currentMode === "plan" ? apiConfiguration?.planModeLiteLlmModelInfo : apiConfiguration?.actModeLiteLlmModelInfo
			return {
				selectedProvider: provider,
				selectedModelId: liteLlmModelId || "",
				selectedModelInfo: liteLlmModelInfo || liteLlmModelInfoSaneDefaults,
			}
		case "xai":
			const xaiModelId = currentMode === "plan" ? apiConfiguration?.planModeXaiModelId : apiConfiguration?.actModeXaiModelId
			return getProviderData(xaiModels, xaiDefaultModelId, xaiModelId)
		case "moonshot":
			const moonshotModelId =
				currentMode === "plan" ? apiConfiguration?.planModeMoonshotModelId : apiConfiguration?.actModeMoonshotModelId
			return getProviderData(moonshotModels, moonshotDefaultModelId, moonshotModelId)
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
			const nebiusModelId =
				currentMode === "plan" ? apiConfiguration?.planModeNebiusModelId : apiConfiguration?.actModeNebiusModelId
			return getProviderData(nebiusModels, nebiusDefaultModelId, nebiusModelId)
		case "sambanova":
			const sambanovaModelId =
				currentMode === "plan" ? apiConfiguration?.planModeSambanovaModelId : apiConfiguration?.actModeSambanovaModelId
			return getProviderData(sambanovaModels, sambanovaDefaultModelId, sambanovaModelId)
		case "cerebras":
			const cerebrasModelId =
				currentMode === "plan" ? apiConfiguration?.planModeCerebrasModelId : apiConfiguration?.actModeCerebrasModelId
			return getProviderData(cerebrasModels, cerebrasDefaultModelId, cerebrasModelId)
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
		case "sapaicore":
			const sapAiCoreModelId =
				currentMode === "plan" ? apiConfiguration?.planModeSapAiCoreModelId : apiConfiguration?.actModeSapAiCoreModelId
			return getProviderData(sapAiCoreModels, sapAiCoreDefaultModelId, sapAiCoreModelId)
		default:
			const defaultModelId =
				currentMode === "plan" ? apiConfiguration?.planModeAnthropicModelId : apiConfiguration?.actModeAnthropicModelId
			return getProviderData(anthropicModels, anthropicDefaultModelId, defaultModelId)
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

			// Provider-specific model IDs
			anthropicModelId: undefined,
			claudeCodeModelId: undefined,
			awsBedrockModelId: undefined,
			vertexModelId: undefined,
			geminiModelId: undefined,
			openAiNativeModelId: undefined,
			deepSeekModelId: undefined,
			qwenModelId: undefined,
			doubaoModelId: undefined,
			mistralModelId: undefined,
			askSageModelId: undefined,
			xaiModelId: undefined,
			moonshotModelId: undefined,
			nebiusModelId: undefined,
			sambanovaModelId: undefined,
			cerebrasModelId: undefined,
			sapAiCoreModelId: undefined,
			togetherModelId: undefined,
			fireworksModelId: undefined,
			lmStudioModelId: undefined,
			ollamaModelId: undefined,
			liteLlmModelId: undefined,
			requestyModelId: undefined,
			openAiModelId: undefined,
			openRouterModelId: undefined,
			groqModelId: undefined,
			huggingFaceModelId: undefined,

			// Model info objects
			openAiModelInfo: undefined,
			liteLlmModelInfo: undefined,
			openRouterModelInfo: undefined,
			requestyModelInfo: undefined,
			groqModelInfo: undefined,
			huggingFaceModelInfo: undefined,
			vsCodeLmModelSelector: undefined,

			// AWS Bedrock fields
			awsBedrockCustomSelected: undefined,
			awsBedrockCustomModelBaseId: undefined,

			// Other mode-specific fields
			thinkingBudgetTokens: undefined,
			reasoningEffort: undefined,
		}
	}

	return {
		// Core fields
		apiProvider: mode === "plan" ? apiConfiguration.planModeApiProvider : apiConfiguration.actModeApiProvider,

		// Provider-specific model IDs
		anthropicModelId: mode === "plan" ? apiConfiguration.planModeAnthropicModelId : apiConfiguration.actModeAnthropicModelId,
		claudeCodeModelId:
			mode === "plan" ? apiConfiguration.planModeClaudeCodeModelId : apiConfiguration.actModeClaudeCodeModelId,
		awsBedrockModelId:
			mode === "plan" ? apiConfiguration.planModeAwsBedrockModelId : apiConfiguration.actModeAwsBedrockModelId,
		vertexModelId: mode === "plan" ? apiConfiguration.planModeVertexModelId : apiConfiguration.actModeVertexModelId,
		geminiModelId: mode === "plan" ? apiConfiguration.planModeGeminiModelId : apiConfiguration.actModeGeminiModelId,
		openAiNativeModelId:
			mode === "plan" ? apiConfiguration.planModeOpenAiNativeModelId : apiConfiguration.actModeOpenAiNativeModelId,
		deepSeekModelId: mode === "plan" ? apiConfiguration.planModeDeepSeekModelId : apiConfiguration.actModeDeepSeekModelId,
		qwenModelId: mode === "plan" ? apiConfiguration.planModeQwenModelId : apiConfiguration.actModeQwenModelId,
		doubaoModelId: mode === "plan" ? apiConfiguration.planModeDoubaoModelId : apiConfiguration.actModeDoubaoModelId,
		mistralModelId: mode === "plan" ? apiConfiguration.planModeMistralModelId : apiConfiguration.actModeMistralModelId,
		askSageModelId: mode === "plan" ? apiConfiguration.planModeAskSageModelId : apiConfiguration.actModeAskSageModelId,
		xaiModelId: mode === "plan" ? apiConfiguration.planModeXaiModelId : apiConfiguration.actModeXaiModelId,
		moonshotModelId: mode === "plan" ? apiConfiguration.planModeMoonshotModelId : apiConfiguration.actModeMoonshotModelId,
		nebiusModelId: mode === "plan" ? apiConfiguration.planModeNebiusModelId : apiConfiguration.actModeNebiusModelId,
		sambanovaModelId: mode === "plan" ? apiConfiguration.planModeSambanovaModelId : apiConfiguration.actModeSambanovaModelId,
		cerebrasModelId: mode === "plan" ? apiConfiguration.planModeCerebrasModelId : apiConfiguration.actModeCerebrasModelId,
		sapAiCoreModelId: mode === "plan" ? apiConfiguration.planModeSapAiCoreModelId : apiConfiguration.actModeSapAiCoreModelId,
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
		huggingFaceModelId:
			mode === "plan" ? apiConfiguration.planModeHuggingFaceModelId : apiConfiguration.actModeHuggingFaceModelId,

		// Model info objects
		openAiModelInfo: mode === "plan" ? apiConfiguration.planModeOpenAiModelInfo : apiConfiguration.actModeOpenAiModelInfo,
		liteLlmModelInfo: mode === "plan" ? apiConfiguration.planModeLiteLlmModelInfo : apiConfiguration.actModeLiteLlmModelInfo,
		openRouterModelInfo:
			mode === "plan" ? apiConfiguration.planModeOpenRouterModelInfo : apiConfiguration.actModeOpenRouterModelInfo,
		requestyModelInfo:
			mode === "plan" ? apiConfiguration.planModeRequestyModelInfo : apiConfiguration.actModeRequestyModelInfo,
		groqModelInfo: mode === "plan" ? apiConfiguration.planModeGroqModelInfo : apiConfiguration.actModeGroqModelInfo,
		huggingFaceModelInfo:
			mode === "plan" ? apiConfiguration.planModeHuggingFaceModelInfo : apiConfiguration.actModeHuggingFaceModelInfo,
		vsCodeLmModelSelector:
			mode === "plan" ? apiConfiguration.planModeVsCodeLmModelSelector : apiConfiguration.actModeVsCodeLmModelSelector,

		// AWS Bedrock fields
		awsBedrockCustomSelected:
			mode === "plan"
				? apiConfiguration.planModeAwsBedrockCustomSelected
				: apiConfiguration.actModeAwsBedrockCustomSelected,
		awsBedrockCustomModelBaseId:
			mode === "plan"
				? apiConfiguration.planModeAwsBedrockCustomModelBaseId
				: apiConfiguration.actModeAwsBedrockCustomModelBaseId,

		// Other mode-specific fields
		thinkingBudgetTokens:
			mode === "plan" ? apiConfiguration.planModeThinkingBudgetTokens : apiConfiguration.actModeThinkingBudgetTokens,
		reasoningEffort: mode === "plan" ? apiConfiguration.planModeReasoningEffort : apiConfiguration.actModeReasoningEffort,
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
	if (!apiConfiguration) return

	const sourceFields = getModeSpecificFields(apiConfiguration, sourceMode)
	const { apiProvider } = sourceFields

	if (!apiProvider) return

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

		case "together":
			updates.planModeTogetherModelId = sourceFields.togetherModelId
			updates.actModeTogetherModelId = sourceFields.togetherModelId
			break

		case "fireworks":
			updates.planModeFireworksModelId = sourceFields.fireworksModelId
			updates.actModeFireworksModelId = sourceFields.fireworksModelId
			break

		case "bedrock":
			updates.planModeAwsBedrockModelId = sourceFields.awsBedrockModelId
			updates.actModeAwsBedrockModelId = sourceFields.awsBedrockModelId
			updates.planModeAwsBedrockCustomSelected = sourceFields.awsBedrockCustomSelected
			updates.actModeAwsBedrockCustomSelected = sourceFields.awsBedrockCustomSelected
			updates.planModeAwsBedrockCustomModelBaseId = sourceFields.awsBedrockCustomModelBaseId
			updates.actModeAwsBedrockCustomModelBaseId = sourceFields.awsBedrockCustomModelBaseId
			break

		case "anthropic":
			updates.planModeAnthropicModelId = sourceFields.anthropicModelId
			updates.actModeAnthropicModelId = sourceFields.anthropicModelId
			break

		case "claude-code":
			updates.planModeClaudeCodeModelId = sourceFields.claudeCodeModelId
			updates.actModeClaudeCodeModelId = sourceFields.claudeCodeModelId
			break

		case "vertex":
			updates.planModeVertexModelId = sourceFields.vertexModelId
			updates.actModeVertexModelId = sourceFields.vertexModelId
			break

		case "gemini":
			updates.planModeGeminiModelId = sourceFields.geminiModelId
			updates.actModeGeminiModelId = sourceFields.geminiModelId
			break

		case "openai-native":
			updates.planModeOpenAiNativeModelId = sourceFields.openAiNativeModelId
			updates.actModeOpenAiNativeModelId = sourceFields.openAiNativeModelId
			break

		case "deepseek":
			updates.planModeDeepSeekModelId = sourceFields.deepSeekModelId
			updates.actModeDeepSeekModelId = sourceFields.deepSeekModelId
			break

		case "qwen":
			updates.planModeQwenModelId = sourceFields.qwenModelId
			updates.actModeQwenModelId = sourceFields.qwenModelId
			break

		case "doubao":
			updates.planModeDoubaoModelId = sourceFields.doubaoModelId
			updates.actModeDoubaoModelId = sourceFields.doubaoModelId
			break

		case "mistral":
			updates.planModeMistralModelId = sourceFields.mistralModelId
			updates.actModeMistralModelId = sourceFields.mistralModelId
			break

		case "asksage":
			updates.planModeAskSageModelId = sourceFields.askSageModelId
			updates.actModeAskSageModelId = sourceFields.askSageModelId
			break

		case "xai":
			updates.planModeXaiModelId = sourceFields.xaiModelId
			updates.actModeXaiModelId = sourceFields.xaiModelId
			break

		case "moonshot":
			updates.planModeMoonshotModelId = sourceFields.moonshotModelId
			updates.actModeMoonshotModelId = sourceFields.moonshotModelId
			break

		case "nebius":
			updates.planModeNebiusModelId = sourceFields.nebiusModelId
			updates.actModeNebiusModelId = sourceFields.nebiusModelId
			break

		case "sambanova":
			updates.planModeSambanovaModelId = sourceFields.sambanovaModelId
			updates.actModeSambanovaModelId = sourceFields.sambanovaModelId
			break

		case "cerebras":
			updates.planModeCerebrasModelId = sourceFields.cerebrasModelId
			updates.actModeCerebrasModelId = sourceFields.cerebrasModelId
			break

		case "sapaicore":
			updates.planModeSapAiCoreModelId = sourceFields.sapAiCoreModelId
			updates.actModeSapAiCoreModelId = sourceFields.sapAiCoreModelId
			break

		default:
			// Default to anthropic
			updates.planModeAnthropicModelId = sourceFields.anthropicModelId
			updates.actModeAnthropicModelId = sourceFields.anthropicModelId
			break
	}

	// Make the atomic update
	await handleFieldsChange(updates)
}

/**
 * Gets the OpenRouter authentication URL
 */
export function getOpenRouterAuthUrl(uriScheme?: string) {
	return `https://openrouter.ai/auth?callback_url=${uriScheme || "vscode"}://saoudrizwan.claude-dev/openrouter`
}
