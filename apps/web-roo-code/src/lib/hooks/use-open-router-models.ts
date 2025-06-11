import { z } from "zod"
import { useQuery } from "@tanstack/react-query"

import { ModelInfo } from "@roo-code/types"

const parsePrice = (price?: string) => (price ? parseFloat(price) * 1_000_000 : undefined)

export const openRouterModelSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string(),
	created: z.number(),
	context_length: z.number(),
	pricing: z.object({
		prompt: z.string().optional(),
		completion: z.string().optional(),
	}),
	top_provider: z
		.object({
			max_completion_tokens: z.number().nullish(),
		})
		.optional(),
	architecture: z
		.object({
			modality: z.string(),
		})
		.optional(),
})

export type OpenRouterModel = z.infer<typeof openRouterModelSchema>

export type OpenRouterModelRecord = Record<string, OpenRouterModel & { modelInfo: ModelInfo }>

export const getOpenRouterModels = async (): Promise<OpenRouterModelRecord> => {
	const response = await fetch("https://openrouter.ai/api/v1/models")

	if (!response.ok) {
		console.error("Failed to fetch OpenRouter models")
		return {}
	}

	const result = z.object({ data: z.array(openRouterModelSchema) }).safeParse(await response.json())

	if (!result.success) {
		console.error(result.error)
		return {}
	}

	return result.data.data
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((rawModel) => ({
			...rawModel,
			modelInfo: {
				maxTokens: rawModel.top_provider?.max_completion_tokens ?? undefined,
				contextWindow: rawModel.context_length,
				inputPrice: parsePrice(rawModel.pricing?.prompt),
				outputPrice: parsePrice(rawModel.pricing?.completion),
				description: rawModel.description,
				supportsPromptCache: false,
				supportsImages: false,
				supportsThinking: false,
				tiers: [],
			},
		}))
		.reduce((acc, model) => {
			acc[model.id] = model
			return acc
		}, {} as OpenRouterModelRecord)
}

export const useOpenRouterModels = () =>
	useQuery<OpenRouterModelRecord>({ queryKey: ["getOpenRouterModels"], queryFn: getOpenRouterModels })
