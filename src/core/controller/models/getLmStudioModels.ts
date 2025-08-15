import { StringArray, type StringRequest } from "@shared/proto/cline/common"
import type { Controller } from ".."

/**
 * Fetches available models from LM Studio
 * @param controller The controller instance
 * @param request The request containing the base URL (optional)
 * @returns Array of model names
 */
export async function getLmStudioModels(_controller: Controller, request: StringRequest): Promise<StringArray> {
	try {
		const baseUrl = new URL("api/v0/models", request.value || "http://localhost:1234")

		if (!URL.canParse(baseUrl)) {
			return StringArray.create({ values: [] })
		}

		const response = await fetch(baseUrl.toString())
		const data = await response.json()
		const models = data?.data?.map((m: unknown) => JSON.stringify(m)) || []

		return StringArray.create({ values: models })
	} catch (error) {
		console.error("Failed to fetch LM Studio models:", error)
		return StringArray.create({ values: [] })
	}
}
