import { type ApiHandler, createHandler, type ProviderConfig } from "@cline/llms"
import { type ApiConfiguration, BEDROCK_DEFAULT_MODEL_ID } from "@shared/api"
import type { Mode } from "@shared/storage/types"
import { buildBedrockProviderConfig } from "./bedrock-config"

export interface BuildApiHandlerOptions {
	disableReasoning?: boolean
	workspaceRoot?: string
}

export function resolveBedrockModelId(configuration: ApiConfiguration, mode: Mode): string {
	const selected = mode === "plan" ? configuration.planModeApiModelId : configuration.actModeApiModelId
	return selected?.trim() || BEDROCK_DEFAULT_MODEL_ID
}

export function buildSdkProviderConfig(
	configuration: ApiConfiguration,
	mode: Mode,
	options?: BuildApiHandlerOptions,
): ProviderConfig {
	const modelId = resolveBedrockModelId(configuration, mode)
	const base: ProviderConfig = {
		...buildBedrockProviderConfig(configuration, modelId, options?.workspaceRoot),
		onRetryAttempt: configuration.onRetryAttempt,
	}
	if (options?.disableReasoning) {
		return { ...base, thinking: false }
	}
	const thinkingBudgetTokens =
		mode === "plan" ? configuration.planModeThinkingBudgetTokens : configuration.actModeThinkingBudgetTokens
	const reasoningEffort = mode === "plan" ? configuration.planModeReasoningEffort : configuration.actModeReasoningEffort
	if (thinkingBudgetTokens && thinkingBudgetTokens > 0) {
		return { ...base, thinkingBudgetTokens }
	}
	if (reasoningEffort === "low" || reasoningEffort === "medium" || reasoningEffort === "high" || reasoningEffort === "xhigh") {
		return { ...base, reasoningEffort }
	}
	return base
}

export function buildApiHandler(configuration: ApiConfiguration, mode: Mode, options?: BuildApiHandlerOptions): ApiHandler {
	return createHandler(buildSdkProviderConfig(configuration, mode, options))
}
