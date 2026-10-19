import { Empty } from "@shared/proto/cline/common"
import { OllamaModelRequest } from "@shared/proto/cline/models"
import { createOllamaClient } from "@/services/local-models/ollama"
import { Controller } from ".."

export async function unloadOllamaModel(_controller: Controller, request: OllamaModelRequest): Promise<Empty> {
	await createOllamaClient(request.baseUrl).generate({ model: request.model, prompt: "", keep_alive: 0 })
	return Empty.create()
}
