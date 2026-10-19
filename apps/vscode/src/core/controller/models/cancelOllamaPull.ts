import { Empty } from "@shared/proto/cline/common"
import { OllamaModelRequest } from "@shared/proto/cline/models"
import { cancelOllamaPull as cancelPull } from "@/services/local-models/ollama"
import { Controller } from ".."

export async function cancelOllamaPull(_controller: Controller, request: OllamaModelRequest): Promise<Empty> {
	cancelPull(request.model)
	return Empty.create()
}
