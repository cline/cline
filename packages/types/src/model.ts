import { z } from "zod"

/**
 * ReasoningEffort
 */

export const reasoningEfforts = ["low", "medium", "high"] as const

export const reasoningEffortsSchema = z.enum(reasoningEfforts)

export type ReasoningEffort = z.infer<typeof reasoningEffortsSchema>

/**
 * ModelParameter
 */

export const modelParameters = ["max_tokens", "temperature", "reasoning", "include_reasoning"] as const

export const modelParametersSchema = z.enum(modelParameters)

export type ModelParameter = z.infer<typeof modelParametersSchema>

export const isModelParameter = (value: string): value is ModelParameter =>
	modelParameters.includes(value as ModelParameter)

/**
 * ModelInfo
 */

export const modelInfoSchema = z.object({
	maxTokens: z.number().nullish(),
	maxThinkingTokens: z.number().nullish(),
	contextWindow: z.number(),
	supportsImages: z.boolean().optional(),
	supportsComputerUse: z.boolean().optional(),
	supportsPromptCache: z.boolean(),
	supportsReasoningBudget: z.boolean().optional(),
	requiredReasoningBudget: z.boolean().optional(),
	supportsReasoningEffort: z.boolean().optional(),
	supportedParameters: z.array(modelParametersSchema).optional(),
	inputPrice: z.number().optional(),
	outputPrice: z.number().optional(),
	cacheWritesPrice: z.number().optional(),
	cacheReadsPrice: z.number().optional(),
	description: z.string().optional(),
	reasoningEffort: reasoningEffortsSchema.optional(),
	minTokensPerCachePoint: z.number().optional(),
	maxCachePoints: z.number().optional(),
	cachableFields: z.array(z.string()).optional(),
	tiers: z
		.array(
			z.object({
				contextWindow: z.number(),
				inputPrice: z.number().optional(),
				outputPrice: z.number().optional(),
				cacheWritesPrice: z.number().optional(),
				cacheReadsPrice: z.number().optional(),
			}),
		)
		.optional(),
})

export type ModelInfo = z.infer<typeof modelInfoSchema>
