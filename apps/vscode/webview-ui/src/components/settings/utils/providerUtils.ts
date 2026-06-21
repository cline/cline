import type { ApiConfiguration, ApiProvider, ModelInfo } from "@shared/api"
import type { Mode } from "@shared/storage/types"
import * as reasoningSupport from "@shared/utils/reasoning-support"

export function supportsReasoningEffortForModelId(modelId?: string, _allowShortOpenAiIds = false): boolean {
	return reasoningSupport.supportsReasoningEffortForModel(modelId)
}

// Webview components must source provider models via
// `useProviderModels(providerId)`, which talks to the extension over
// gRPC and ultimately reads from `@cline/llms`. Do not add a static
// catalog here — it would silently bypass the SDK. If a new caller
// needs model lists synchronously, derive them from the catalog hook
// instead.

/**
 * Interface for normalized API configuration
 */
export interface NormalizedApiConfig {
	selectedProvider: ApiProvider
	selectedModelId: string
	selectedModelInfo: ModelInfo
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
			clineModelId: undefined,
			groqModelId: undefined,
			basetenModelId: undefined,
			huggingFaceModelId: undefined,
			huaweiCloudMaasModelId: undefined,
			hicapModelId: undefined,
			aihubmixModelId: undefined,
			nousResearchModelId: undefined,
			vercelAiGatewayModelId: undefined,
			sapAiCoreModelId: undefined,

			// Model info objects
			openAiModelInfo: undefined,
			liteLlmModelInfo: undefined,
			openRouterModelInfo: undefined,
			clineModelInfo: undefined,
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

	const openRouterModelId =
		mode === "plan" ? apiConfiguration.planModeOpenRouterModelId : apiConfiguration.actModeOpenRouterModelId
	const openRouterModelInfo =
		mode === "plan" ? apiConfiguration.planModeOpenRouterModelInfo : apiConfiguration.actModeOpenRouterModelInfo

	const clineModelId = mode === "plan" ? apiConfiguration.planModeClineModelId : apiConfiguration.actModeClineModelId
	const clineModelInfo = mode === "plan" ? apiConfiguration.planModeClineModelInfo : apiConfiguration.actModeClineModelInfo

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
		openRouterModelId,
		clineModelId,
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
		vercelAiGatewayModelId:
			mode === "plan" ? apiConfiguration.planModeVercelAiGatewayModelId : apiConfiguration.actModeVercelAiGatewayModelId,
		sapAiCoreModelId: mode === "plan" ? apiConfiguration.planModeSapAiCoreModelId : apiConfiguration.actModeSapAiCoreModelId,

		// Model info objects
		openAiModelInfo: mode === "plan" ? apiConfiguration.planModeOpenAiModelInfo : apiConfiguration.actModeOpenAiModelInfo,
		liteLlmModelInfo: mode === "plan" ? apiConfiguration.planModeLiteLlmModelInfo : apiConfiguration.actModeLiteLlmModelInfo,
		openRouterModelInfo,
		clineModelInfo,
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
		vercelAiGatewayModelInfo:
			mode === "plan"
				? apiConfiguration.planModeVercelAiGatewayModelInfo
				: apiConfiguration.actModeVercelAiGatewayModelInfo,

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

export { filterOpenRouterModelIds } from "@shared/utils/model-filters"
