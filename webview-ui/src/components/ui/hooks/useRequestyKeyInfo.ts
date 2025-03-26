import axios from "axios"
import { z } from "zod"
import { useQuery, UseQueryOptions } from "@tanstack/react-query"

const requestyKeyInfoSchema = z.object({
	name: z.string(),
	monthly_limit: z.string(),
	monthly_spend: z.string(),
	org_balance: z.string(),
	config: z.object({
		aliases: z.record(z.string(), z.any()).optional(),
	}),
})

export type RequestyKeyInfo = z.infer<typeof requestyKeyInfoSchema>

async function getRequestyKeyInfo(apiKey?: string) {
	if (!apiKey) return null

	try {
		const response = await axios.get("https://api.requesty.ai/x/apikey", {
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
		})

		const result = requestyKeyInfoSchema.safeParse(response.data)
		if (!result.success) {
			console.error("Requesty API key info validation failed:", result.error)
			return null
		}

		return result.data
	} catch (error) {
		console.error("Error fetching Requesty key info:", error)
		return null
	}
}

type UseRequestyKeyInfoOptions = Omit<UseQueryOptions<RequestyKeyInfo | null>, "queryKey" | "queryFn">
export const useRequestyKeyInfo = (apiKey?: string, options?: UseRequestyKeyInfoOptions) => {
	return useQuery<RequestyKeyInfo | null>({
		queryKey: ["requesty-key-info", apiKey],
		queryFn: () => getRequestyKeyInfo(apiKey),
		staleTime: 30 * 1000, // 30 seconds
		enabled: !!apiKey,
		...options,
	})
}
