import axios from "axios"
import { z } from "zod"
import { useQuery, UseQueryOptions } from "@tanstack/react-query"

// Define schema for OpenRouter key response
const openRouterKeyInfoSchema = z.object({
	data: z.object({
		label: z.string(),
		usage: z.number(),
		is_free_tier: z.boolean(),
		is_provisioning_key: z.boolean(),
		rate_limit: z.object({
			requests: z.number(),
			interval: z.string(),
		}),
		limit: z.number().nullable(),
	}),
})

export type OpenRouterKeyInfo = z.infer<typeof openRouterKeyInfoSchema>["data"]

async function getOpenRouterKeyInfo(apiKey?: string, baseUrl?: string) {
	if (!apiKey) return null

	try {
		// Use the provided base URL or default to OpenRouter's API URL
		const apiBaseUrl = baseUrl || "https://openrouter.ai/api/v1"

		const keyEndpoint = `${apiBaseUrl}/key`

		const response = await axios.get(keyEndpoint, {
			headers: {
				Authorization: `Bearer ${apiKey}`,
			},
		})

		const result = openRouterKeyInfoSchema.safeParse(response.data)
		if (!result.success) {
			console.error("OpenRouter API key info validation failed:", result.error)
			return null
		}

		return result.data.data
	} catch (error) {
		console.error("Error fetching OpenRouter key info:", error)
		return null
	}
}

type UseOpenRouterKeyInfoOptions = Omit<UseQueryOptions<OpenRouterKeyInfo | null>, "queryKey" | "queryFn">
export const useOpenRouterKeyInfo = (apiKey?: string, baseUrl?: string, options?: UseOpenRouterKeyInfoOptions) => {
	return useQuery<OpenRouterKeyInfo | null>({
		queryKey: ["openrouter-key-info", apiKey, baseUrl],
		queryFn: () => getOpenRouterKeyInfo(apiKey, baseUrl),
		staleTime: 30 * 1000, // 30 seconds
		enabled: !!apiKey,
		...options,
	})
}
