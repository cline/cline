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
			updates.planModeOpenRouterModelId = sourceFields.openRouterModelId
			updates.actModeOpenRouterModelId = sourceFields.openRouterModelId
			updates.planModeOpenRouterModelInfo = sourceFields.openRouterModelInfo
			updates.actModeOpenRouterModelInfo = sourceFields.openRouterModelInfo
			break

		case "cline":
			updates.planModeClineModelId = sourceFields.clineModelId
			updates.actModeClineModelId = sourceFields.clineModelId
			updates.planModeClineModelInfo = sourceFields.clineModelInfo
			updates.actModeClineModelInfo = sourceFields.clineModelInfo
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
			// Vercel AI Gateway uses its own model fields
			updates.planModeVercelAiGatewayModelId = sourceFields.vercelAiGatewayModelId
			updates.actModeVercelAiGatewayModelId = sourceFields.vercelAiGatewayModelId
			updates.planModeVercelAiGatewayModelInfo = sourceFields.vercelAiGatewayModelInfo
			updates.actModeVercelAiGatewayModelInfo = sourceFields.vercelAiGatewayModelInfo
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

		// Default branch: providers that use the common `apiProvider` +
		// `apiModelId` ApiConfiguration field pair (anthropic, claude-code,
		// vertex, gemini, openai-native, openai-codex, deepseek, qwen,
		// doubao, mistral, asksage, xai, nebius, wandb, sambanova,
		// cerebras, sapaicore, zai, minimax).
		default:
			updates.planModeApiModelId = sourceFields.apiModelId
			updates.actModeApiModelId = sourceFields.apiModelId
			break
	}

	// Make the atomic update
	await handleFieldsChange(updates)
}

export { filterOpenRouterModelIds } from "@shared/utils/model-filters"
