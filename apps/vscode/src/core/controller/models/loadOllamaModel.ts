import { Empty } from "@shared/proto/cline/common"
import { OllamaModelRequest } from "@shared/proto/cline/models"
import { createOllamaClient } from "@/services/local-models/ollama"
import { Controller } from ".."

/**
 * Loads a model into memory by sending it an empty prompt. `num_ctx` must
 * match what Cline sends with each request, otherwise Ollama reloads the model
 * on the first message.
 */
export async function loadOllamaModel(_controller: Controller, request: OllamaModelRequest): Promise<Empty> {
	await createOllamaClient(request.baseUrl).generate({
		model: request.model,
		prompt: "",
		// Stay loaded until explicitly unloaded; requests without a keep_alive don't shorten it.
		keep_alive: -1,
		...(request.contextWindow ? { options: { num_ctx: request.contextWindow } } : {}),
	})
	return Empty.create()
}
