import { StringArray } from "@shared/proto/cline/common"
import { OpenAiModelsRequest } from "@shared/proto/cline/models"
import { fetch } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from ".."

/**
 * Fetches available models from LM Studio
 * @param controller The controller instance
 * @param request The request containing the base URL and optional API key
 * @returns Array of model names
 */
export async function getLmStudioModels(_controller: Controller, request: OpenAiModelsRequest): Promise<StringArray> {
	try {
		const baseUrl = request.baseUrl || "http://localhost:1234"
		if (!URL.canParse(baseUrl)) {
			return StringArray.create({ values: [] })
		}
		const endpoint = new URL("api/v0/models", baseUrl)

		const init = request.apiKey ? { headers: { Authorization: `Bearer ${request.apiKey}` } } : undefined
		const response = await fetch(endpoint.href, init)
		const data = await response.json()
		const models = data?.data?.map((m: unknown) => JSON.stringify(m)) || []

		return StringArray.create({ values: models })
	} catch (error) {
		Logger.error("Failed to fetch LM Studio models:", error)
		return StringArray.create({ values: [] })
	}
}
