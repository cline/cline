import axios from "axios"
import { z } from "zod"
import { useQuery, UseQueryOptions } from "@tanstack/react-query"
import { toRequestyServiceUrl } from "@roo/utils/requesty"

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

async function getRequestyKeyInfo(baseUrl?: string, apiKey?: string) {
	if (!apiKey) return null

	const url = toRequestyServiceUrl(baseUrl, "api")
	const apiKeyUrl = new URL("x/apikey", url)

	try {
		const response = await axios.get(apiKeyUrl.toString(), {
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
export const useRequestyKeyInfo = (baseUrl?: string, apiKey?: string, options?: UseRequestyKeyInfoOptions) => {
	return useQuery<RequestyKeyInfo | null>({
		queryKey: ["requesty-key-info", baseUrl, apiKey],
		queryFn: () => getRequestyKeyInfo(baseUrl, apiKey),
		staleTime: 30 * 1000, // 30 seconds
		enabled: !!apiKey,
		...options,
	})
}
