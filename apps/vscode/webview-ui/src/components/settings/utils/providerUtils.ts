import { type ApiConfiguration, type ApiProvider, BEDROCK_DEFAULT_MODEL_ID, type ModelInfo } from "@shared/api"
import type { Mode } from "@shared/storage/types"

export interface NormalizedApiConfig {
	selectedProvider: ApiProvider
	selectedModelId: string
	selectedModelInfo: ModelInfo
}

export function getModeSpecificFields(apiConfiguration: ApiConfiguration | undefined, mode: Mode) {
	return {
		apiProvider: "bedrock" as const,
		apiModelId:
			(mode === "plan" ? apiConfiguration?.planModeApiModelId : apiConfiguration?.actModeApiModelId) ??
			BEDROCK_DEFAULT_MODEL_ID,
		thinkingBudgetTokens:
			mode === "plan" ? apiConfiguration?.planModeThinkingBudgetTokens : apiConfiguration?.actModeThinkingBudgetTokens,
		reasoningEffort: mode === "plan" ? apiConfiguration?.planModeReasoningEffort : apiConfiguration?.actModeReasoningEffort,
	}
}

export async function syncModeConfigurations(
	apiConfiguration: ApiConfiguration | undefined,
	sourceMode: Mode,
	handleFieldsChange: (updates: Partial<ApiConfiguration>) => Promise<void>,
): Promise<void> {
	const fields = getModeSpecificFields(apiConfiguration, sourceMode)
	await handleFieldsChange({
		planModeApiProvider: "bedrock",
		actModeApiProvider: "bedrock",
		planModeApiModelId: fields.apiModelId,
		actModeApiModelId: fields.apiModelId,
		planModeThinkingBudgetTokens: fields.thinkingBudgetTokens,
		actModeThinkingBudgetTokens: fields.thinkingBudgetTokens,
		planModeReasoningEffort: fields.reasoningEffort,
		actModeReasoningEffort: fields.reasoningEffort,
	})
}
