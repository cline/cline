import { StringArray, StringRequest } from "@shared/proto/cline/common"
import axios from "axios"
import { Controller } from ".."

/**
 * Fetches available models from Ollama
 * @param controller The controller instance
 * @param request The request containing the base URL (optional)
 * @returns Array of model names
 */
export async function getOllamaModels(_controller: Controller, request: StringRequest): Promise<StringArray> {
	try {
		const baseUrl = request.value || "http://localhost:11434"

		if (!URL.canParse(baseUrl)) {
			return StringArray.create({ values: [] })
		}

		const response = await axios.get(`${baseUrl}/api/tags`)
		const modelsArray = response.data?.models?.map((model: any) => model.name) || []
		const models = [...new Set<string>(modelsArray)].sort()

		return StringArray.create({ values: models })
	} catch (_error) {
		return StringArray.create({ values: [] })
	}
}
