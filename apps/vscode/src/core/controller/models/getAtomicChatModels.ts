import { StringArray, type StringRequest } from "@shared/proto/cline/common"
import { fetch } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from ".."

function resolveModelsEndpoint(baseUrl: string): string | undefined {
	const trimmed = baseUrl.trim()
	if (!trimmed || !URL.canParse(trimmed)) {
		return undefined
	}

	const parsed = new URL(trimmed)
	if (parsed.pathname.endsWith("/v1") || parsed.pathname.endsWith("/v1/")) {
		parsed.pathname = `${parsed.pathname.replace(/\/+$/, "")}/models`
	} else if (parsed.pathname === "/" || parsed.pathname === "") {
		parsed.pathname = "/v1/models"
	} else {
		parsed.pathname = `${parsed.pathname.replace(/\/+$/, "")}/v1/models`
	}
	return parsed.toString()
}

/**
 * Fetches available models from Atomic Chat's OpenAI-compatible API.
 */
export async function getAtomicChatModels(_controller: Controller, request: StringRequest): Promise<StringArray> {
	try {
		const endpoint = resolveModelsEndpoint(request.value || "http://127.0.0.1:1337/v1")
		if (!endpoint) {
			return StringArray.create({ values: [] })
		}

		const response = await fetch(endpoint)
		if (!response.ok) {
			return StringArray.create({ values: [] })
		}

		const data = (await response.json()) as { data?: Array<{ id?: string }> }
		const modelIds = data?.data?.map((model) => model.id?.trim()).filter((id): id is string => !!id && id.length > 0) || []
		return StringArray.create({ values: [...new Set(modelIds)].sort() })
	} catch (error) {
		Logger.error("Failed to fetch Atomic Chat models:", error)
		return StringArray.create({ values: [] })
	}
}
