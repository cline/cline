import { vscode } from "../utils/vscode"
import { v4 as uuidv4 } from "uuid"

export interface Callbacks<TResponse> {
	onResponse: (response: TResponse) => void
	onError: (error: Error) => void
	onComplete: () => void
}

export abstract class ProtoBusClient {
	static serviceName: string
	static async makeRequest<TRequest, TResponse>(methodName: string, request: TRequest): Promise<TResponse> {
		return new Promise((resolve, reject) => {
			const requestId = uuidv4()

			// Set up one-time listener for this specific request
			const handleResponse = (event: MessageEvent) => {
				const message = event.data
				if (message.type === "grpc_response" && message.grpc_response?.request_id === requestId) {
					// Remove listener once we get our response
					window.removeEventListener("message", handleResponse)

					if (message.grpc_response.error) {
						reject(new Error(message.grpc_response.error))
					} else {
						resolve(message.grpc_response.message)
					}
				}
			}

			window.addEventListener("message", handleResponse)

			// Send the request
			vscode.postMessage({
				type: "grpc_request",
				grpc_request: {
					service: this.serviceName,
					method: methodName,
					message: request,
					request_id: requestId,
					is_streaming: false,
				},
			})
		})
	}

	static makeStreamingRequest<TRequest, TResponse>(
		methodName: string,
		request: TRequest,
		callbacks: Callbacks<TResponse>,
	): () => void {
		const requestId = uuidv4()
		// Set up listener for streaming responses
		const handleResponse = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "grpc_response" && message.grpc_response?.request_id === requestId) {
				if (message.grpc_response.error) {
					// Handle error
					if (callbacks.onError) {
						callbacks.onError(new Error(message.grpc_response.error))
					}
					// Only remove the event listener on error
					window.removeEventListener("message", handleResponse)
				} else if (message.grpc_response.message) {
					// Process streaming message
					callbacks.onResponse(message.grpc_response.message)
				}
				if (message.grpc_response.is_streaming === false) {
					if (callbacks.onComplete) {
						callbacks.onComplete()
					}
					// Only remove the event listener when the stream is explicitly ended
					window.removeEventListener("message", handleResponse)
				}
			}
		}
		window.addEventListener("message", handleResponse)
		// Send the streaming request
		vscode.postMessage({
			type: "grpc_request",
			grpc_request: {
				service: this.serviceName,
				method: methodName,
				message: request,
				request_id: requestId,
				is_streaming: true,
			},
		})
		// Return a function to cancel the stream
		return () => {
			window.removeEventListener("message", handleResponse)
			// Send cancellation message
			vscode.postMessage({
				type: "grpc_request_cancel",
				grpc_request_cancel: {
					request_id: requestId,
				},
			})
			console.log(`[DEBUG] Sent cancellation for request: ${requestId}`)
		}
	}
}
