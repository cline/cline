import { z } from "zod"
import { useQuery } from "@tanstack/react-query"

export const openRouterModelSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string(),
	created: z.number(),
	context_length: z.number(),
})

export type OpenRouterModel = z.infer<typeof openRouterModelSchema>

export const getOpenRouterModels = async () => {
	const response = await fetch("https://openrouter.ai/api/v1/models")

	if (!response.ok) {
		console.error("Failed to fetch OpenRouter models")
		return []
	}

	const result = z.object({ data: z.array(openRouterModelSchema) }).safeParse(await response.json())

	if (!result.success) {
		console.error(result.error)
		return []
	}

	return result.data.data.sort((a, b) => a.name.localeCompare(b.name))
}

export const useOpenRouterModels = () =>
	useQuery<OpenRouterModel[]>({
		queryKey: ["getOpenRouterModels"],
		queryFn: getOpenRouterModels,
	})
