import { vscode } from "../utils/vscode"
import { v4 as uuidv4 } from "uuid"
/**
 * Helper function to encode request objects
 */
function encodeRequest(request) {
	if (request === null || request === undefined) {
		return {}
	} else if (typeof request.toJSON === "function") {
		return request.toJSON()
	} else if (typeof request === "object") {
		return { ...request }
	} else {
		return { value: request }
	}
}
// Create a client for any protobuf service with inferred types
export function createGrpcClient(service) {
	const client = {}
	// For each method in the service
	Object.values(service.methods).forEach((method) => {
		if (method.responseStream) {
			// Streaming method implementation
			client[method.name] = (request, options) => {
				const requestId = uuidv4()
				// Set up listener for streaming responses
				const handleResponse = (event) => {
					const message = event.data
					if (message.type === "grpc_response" && message.grpc_response?.request_id === requestId) {
						if (message.grpc_response.error) {
							// Handle error
							if (options.onError) {
								options.onError(new Error(message.grpc_response.error))
							}
							// Only remove the event listener on error
							window.removeEventListener("message", handleResponse)
						} else if (message.grpc_response.is_streaming === false) {
							// End of stream
							if (message.grpc_response.message) {
								// Process final message if present
								const responseType = method.responseType
								const response = responseType.fromJSON(message.grpc_response.message)
								options.onResponse(response)
							}
							if (options.onComplete) {
								options.onComplete()
							}
							// Only remove the event listener when the stream is explicitly ended
							window.removeEventListener("message", handleResponse)
						} else {
							// Process streaming message
							if (message.grpc_response.message) {
								const responseType = method.responseType
								const response = responseType.fromJSON(message.grpc_response.message)
								options.onResponse(response)
							}
						}
					}
				}
				window.addEventListener("message", handleResponse)
				// Send the streaming request
				const encodedRequest = encodeRequest(request)
				vscode.postMessage({
					type: "grpc_request",
					grpc_request: {
						service: service.fullName,
						method: method.name,
						message: encodedRequest,
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
		} else {
			// Unary method implementation
			client[method.name] = (request) => {
				return new Promise((resolve, reject) => {
					const requestId = uuidv4()
					// Set up one-time listener for this specific request
					const handleResponse = (event) => {
						const message = event.data
						if (message.type === "grpc_response" && message.grpc_response?.request_id === requestId) {
							// Remove listener once we get our response
							window.removeEventListener("message", handleResponse)
							if (message.grpc_response.error) {
								reject(new Error(message.grpc_response.error))
							} else {
								// Convert JSON back to protobuf message
								const responseType = method.responseType
								const response = responseType.fromJSON(message.grpc_response.message)
								resolve(response)
							}
						}
					}
					window.addEventListener("message", handleResponse)
					// Send the request
					const encodedRequest = encodeRequest(request)
					vscode.postMessage({
						type: "grpc_request",
						grpc_request: {
							service: service.fullName,
							method: method.name,
							message: encodedRequest,
							request_id: requestId,
							is_streaming: false,
						},
					})
				})
			}
		}
	})
	return client
}
//# sourceMappingURL=grpc-client-base.js.map
