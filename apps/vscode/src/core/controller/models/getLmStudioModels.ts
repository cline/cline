import { StringArray, type StringRequest } from "@shared/proto/cline/common"
import { parseProviderId } from "@/sdk/model-catalog/provider-id"
import { fetch } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from ".."

/**
 * Fetches available models from LM Studio
 * @param controller The controller instance
 * @param request The request containing the base URL (optional)
 * @returns Array of model names
 */
export async function getLmStudioModels(controller: Controller, request: StringRequest): Promise<StringArray> {
	try {
		const providerConfig = controller.getProviderConfigStore().read(parseProviderId("lmstudio"))
		const baseUrl = request.value || providerConfig.baseUrl || "http://localhost:1234"
		if (!URL.canParse(baseUrl)) {
			return StringArray.create({ values: [] })
		}
		const endpoint = new URL("api/v0/models", baseUrl)

		const response = await fetch(endpoint.href, {
			headers: providerConfig.apiKey ? { Authorization: `Bearer ${providerConfig.apiKey}` } : undefined,
		})
		const data = await response.json()
		const models = data?.data?.map((m: unknown) => JSON.stringify(m)) || []

		return StringArray.create({ values: models })
	} catch (error) {
		Logger.error("Failed to fetch LM Studio models:", error)
		return StringArray.create({ values: [] })
	}
}
