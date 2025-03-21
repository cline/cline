import axios from "axios"
import { z } from "zod"
import { useQuery, UseQueryOptions } from "@tanstack/react-query"

import { ModelInfo } from "../../../../../src/shared/api"
import { parseApiPrice } from "../../../../../src/utils/cost"

export const OPENROUTER_DEFAULT_PROVIDER_NAME = "[default]"

const openRouterEndpointsSchema = z.object({
	data: z.object({
		id: z.string(),
		name: z.string(),
		description: z.string().optional(),
		architecture: z
			.object({
				modality: z.string().nullish(),
				tokenizer: z.string().nullish(),
			})
			.nullish(),
		endpoints: z.array(
			z.object({
				name: z.string(),
				context_length: z.number(),
				max_completion_tokens: z.number().nullish(),
				pricing: z
					.object({
						prompt: z.union([z.string(), z.number()]).optional(),
						completion: z.union([z.string(), z.number()]).optional(),
					})
					.optional(),
			}),
		),
	}),
})

type OpenRouterModelProvider = ModelInfo & {
	label: string
}

async function getOpenRouterProvidersForModel(modelId: string) {
	const models: Record<string, OpenRouterModelProvider> = {}

	try {
		const response = await axios.get(`https://openrouter.ai/api/v1/models/${modelId}/endpoints`)
		const result = openRouterEndpointsSchema.safeParse(response.data)

		if (!result.success) {
			console.error("OpenRouter API response validation failed:", result.error)
			return models
		}

		const { id, description, architecture, endpoints } = result.data.data

		for (const endpoint of endpoints) {
			const providerName = endpoint.name.split("|")[0].trim()
			const inputPrice = parseApiPrice(endpoint.pricing?.prompt)
			const outputPrice = parseApiPrice(endpoint.pricing?.completion)

			const modelInfo: OpenRouterModelProvider = {
				maxTokens: endpoint.max_completion_tokens || endpoint.context_length,
				contextWindow: endpoint.context_length,
				supportsImages: architecture?.modality?.includes("image"),
				supportsPromptCache: false,
				inputPrice,
				outputPrice,
				description,
				thinking: modelId === "anthropic/claude-3.7-sonnet:thinking",
				label: providerName,
			}

			switch (true) {
				case modelId.startsWith("anthropic/claude-3.7-sonnet"):
					modelInfo.supportsComputerUse = true
					modelInfo.supportsPromptCache = true
					modelInfo.cacheWritesPrice = 3.75
					modelInfo.cacheReadsPrice = 0.3
					modelInfo.maxTokens = id === "anthropic/claude-3.7-sonnet:thinking" ? 64_000 : 8192
					break
				case modelId.startsWith("anthropic/claude-3.5-sonnet-20240620"):
					modelInfo.supportsPromptCache = true
					modelInfo.cacheWritesPrice = 3.75
					modelInfo.cacheReadsPrice = 0.3
					modelInfo.maxTokens = 8192
					break
				default:
					modelInfo.supportsPromptCache = true
					modelInfo.cacheWritesPrice = 0.3
					modelInfo.cacheReadsPrice = 0.03
					break
			}

			models[providerName] = modelInfo
		}
	} catch (error) {
		if (error instanceof z.ZodError) {
			console.error(`OpenRouter API response validation failed:`, error.errors)
		} else {
			console.error(`Error fetching OpenRouter providers:`, error)
		}
	}

	return models
}

type UseOpenRouterModelProvidersOptions = Omit<
	UseQueryOptions<Record<string, OpenRouterModelProvider>>,
	"queryKey" | "queryFn"
>

export const useOpenRouterModelProviders = (modelId?: string, options?: UseOpenRouterModelProvidersOptions) =>
	useQuery<Record<string, OpenRouterModelProvider>>({
		queryKey: ["openrouter-model-providers", modelId],
		queryFn: () => (modelId ? getOpenRouterProvidersForModel(modelId) : {}),
		...options,
	})
