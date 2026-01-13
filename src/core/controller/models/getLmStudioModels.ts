import { StringArray, type StringRequest } from "@shared/proto/cline/common"
import { fetch } from "@/shared/net"
import type { Controller } from ".."

/**
 * Fetches available models from LM Studio
 * @param controller The controller instance
 * @param request The request containing the base URL (optional)
 * @returns Array of model names
 */
export async function getLmStudioModels(_controller: Controller, request: StringRequest): Promise<StringArray> {
	try {
		const baseUrl = request.value || "http://localhost:1234"
		if (!URL.canParse(baseUrl)) {
			return StringArray.create({ values: [] })
		}

		// Try OpenAI-compatible endpoint first (v1/models), then fall back to LM Studio native endpoint
		const endpoints = [new URL("v1/models", baseUrl), new URL("api/v0/models", baseUrl)]

		for (const endpoint of endpoints) {
			try {
				const response = await fetch(endpoint.href)
				if (!response.ok) {
					continue
				}
				const data = await response.json()
				// Extract model IDs from the response (OpenAI format: { data: [{ id: "model-name" }] })
				const models = data?.data?.map((m: { id?: string }) => (typeof m === "object" && m?.id ? m.id : String(m))) || []
				if (models.length > 0) {
					return StringArray.create({ values: models })
				}
			} catch {}
		}

		return StringArray.create({ values: [] })
	} catch (error) {
		console.error("Failed to fetch LM Studio models:", error)
		return StringArray.create({ values: [] })
	}
}
