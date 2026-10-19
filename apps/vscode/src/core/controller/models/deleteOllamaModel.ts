import { Empty } from "@shared/proto/cline/common"
import { OllamaModelRequest } from "@shared/proto/cline/models"
import { createOllamaClient } from "@/services/local-models/ollama"
import { Controller } from ".."

export async function deleteOllamaModel(_controller: Controller, request: OllamaModelRequest): Promise<Empty> {
	await createOllamaClient(request.baseUrl).delete({ model: request.model })
	return Empty.create()
}
