import { StringArray, type StringRequest } from "@shared/proto/cline/common"
import { fetch } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import { parseProviderId } from "@/sdk/model-catalog/provider-id"
import type { Controller } from ".."

/**
 * Fetches available models from LM Studio
 * @param controller The controller instance
 * @param request The request containing the base URL (optional)
 * @returns Array of model names
 */
export async function getLmStudioModels(controller: Controller, request: StringRequest): Promise<StringArray> {
	try {
		const baseUrl = request.value || "http://localhost:1234"
		if (!URL.canParse(baseUrl)) {
			return StringArray.create({ values: [] })
		}
		const endpoint = new URL("api/v0/models", baseUrl)

		const providerConfig = controller.getProviderConfigStore().read(parseProviderId("lmstudio"))
		const apiKey = providerConfig.apiKey?.trim()
		const headers: HeadersInit = apiKey ? { Authorization: `Bearer ${apiKey}` } : {}

		const response = await fetch(endpoint.href, { headers })
		const data = await response.json()
		const models = data?.data?.map((m: unknown) => JSON.stringify(m)) || []

		return StringArray.create({ values: models })
	} catch (error) {
		Logger.error("Failed to fetch LM Studio models:", error)
		return StringArray.create({ values: [] })
	}
}
