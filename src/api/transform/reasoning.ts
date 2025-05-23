import { BetaThinkingConfigParam } from "@anthropic-ai/sdk/resources/beta"
import OpenAI from "openai"

import { ModelInfo, ProviderSettings } from "../../schemas"
import { shouldUseReasoningBudget, shouldUseReasoningEffort } from "../../shared/api"

type ReasoningEffort = "low" | "medium" | "high"

export type OpenRouterReasoningParams = {
	effort?: ReasoningEffort
	max_tokens?: number
	exclude?: boolean
}

export type AnthropicReasoningParams = BetaThinkingConfigParam

export type OpenAiReasoningParams = { reasoning_effort: OpenAI.Chat.ChatCompletionCreateParams["reasoning_effort"] }

export type GetModelReasoningOptions = {
	model: ModelInfo
	reasoningBudget: number | undefined
	reasoningEffort: ReasoningEffort | undefined
	settings: ProviderSettings
}

export const getOpenRouterReasoning = ({
	model,
	reasoningBudget,
	reasoningEffort,
	settings,
}: GetModelReasoningOptions): OpenRouterReasoningParams | undefined =>
	shouldUseReasoningBudget({ model, settings })
		? { max_tokens: reasoningBudget }
		: shouldUseReasoningEffort({ model, settings })
			? { effort: reasoningEffort }
			: undefined

export const getAnthropicReasoning = ({
	model,
	reasoningBudget,
	settings,
}: GetModelReasoningOptions): AnthropicReasoningParams | undefined =>
	shouldUseReasoningBudget({ model, settings }) ? { type: "enabled", budget_tokens: reasoningBudget! } : undefined

export const getOpenAiReasoning = ({
	model,
	reasoningEffort,
	settings,
}: GetModelReasoningOptions): OpenAiReasoningParams | undefined =>
	shouldUseReasoningEffort({ model, settings }) ? { reasoning_effort: reasoningEffort } : undefined
