import { ModelInfo, lMStudioDefaultModelInfo } from "@roo-code/types"
import { LLM, LLMInfo, LLMInstanceInfo, LMStudioClient } from "@lmstudio/sdk"
import axios from "axios"

export const parseLMStudioModel = (rawModel: LLMInstanceInfo): ModelInfo => {
	const modelInfo: ModelInfo = Object.assign({}, lMStudioDefaultModelInfo, {
		description: `${rawModel.displayName} - ${rawModel.path}`,
		contextWindow: rawModel.contextLength,
		supportsPromptCache: true,
		supportsImages: rawModel.vision,
		supportsComputerUse: false,
		maxTokens: rawModel.contextLength,
	})

	return modelInfo
}

export async function getLMStudioModels(baseUrl = "http://localhost:1234"): Promise<Record<string, ModelInfo>> {
	// clearing the input can leave an empty string; use the default in that case
	baseUrl = baseUrl === "" ? "http://localhost:1234" : baseUrl

	const models: Record<string, ModelInfo> = {}
	// ws is required to connect using the LMStudio library
	const lmsUrl = baseUrl.replace(/^http:\/\//, "ws://").replace(/^https:\/\//, "wss://")

	try {
		if (!URL.canParse(lmsUrl)) {
			return models
		}

		// test the connection to LM Studio first
		// errors will be caught further down
		await axios.get(`${baseUrl}/v1/models`)

		const client = new LMStudioClient({ baseUrl: lmsUrl })
		const response = (await client.llm.listLoaded().then((models: LLM[]) => {
			return Promise.all(models.map((m) => m.getModelInfo()))
		})) as Array<LLMInstanceInfo>

		for (const lmstudioModel of response) {
			models[lmstudioModel.modelKey] = parseLMStudioModel(lmstudioModel)
		}
	} catch (error) {
		if (error.code === "ECONNREFUSED") {
			console.warn(`Error connecting to LMStudio at ${baseUrl}`)
		} else {
			console.error(
				`Error fetching LMStudio models: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
			)
		}
	}

	return models
}
