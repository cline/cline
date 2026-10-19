import { OllamaModelRequest, OllamaPullProgress } from "@shared/proto/cline/models"
import { getOrStartOllamaPull } from "@/services/local-models/ollama"
import { getRequestRegistry, StreamingResponseHandler } from "../grpc-handler"
import { Controller } from "../index"

/**
 * Streams download progress for an Ollama model. Cancelling the stream only
 * unsubscribes; the download keeps going until it finishes or
 * `cancelOllamaPull` is called.
 */
export async function pullOllamaModel(
	_controller: Controller,
	request: OllamaModelRequest,
	responseStream: StreamingResponseHandler<OllamaPullProgress>,
	requestId?: string,
): Promise<void> {
	const model = request.model.trim()
	if (!model) {
		throw new Error("Model name is required")
	}

	const pull = getOrStartOllamaPull(request.baseUrl, model)
	let subscribed = true
	const listener = (progress: OllamaPullProgress) => {
		void responseStream(progress, false).catch(() => {})
	}
	const unsubscribe = () => {
		subscribed = false
		pull.listeners.delete(listener)
	}
	pull.listeners.add(listener)
	if (requestId) {
		getRequestRegistry().registerRequest(requestId, unsubscribe, { type: "ollama_pull" }, responseStream)
	}
	listener(pull.progress)

	try {
		await pull.done
		if (subscribed) {
			await responseStream(OllamaPullProgress.create({ model, status: "success" }), true)
		}
	} catch (error) {
		if (subscribed) {
			throw error
		}
	} finally {
		if (requestId) {
			getRequestRegistry().cancelRequest(requestId)
		}
		unsubscribe()
	}
}
