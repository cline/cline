import { Controller } from "./index"
import { serviceHandlers } from "./grpc-service-config"

/**
 * Type definition for a streaming response handler
 */
export type StreamingResponseHandler = (response: any, isLast?: boolean, sequenceNumber?: number) => Promise<void>

/**
 * Handles gRPC requests from the webview
 */
export class GrpcHandler {
	constructor(private controller: Controller) {}

	/**
	 * Handle a gRPC request from the webview
	 * @param service The service name
	 * @param method The method name
	 * @param message The request message
	 * @param requestId The request ID for response correlation
	 * @param isStreaming Whether this is a streaming request
	 * @returns The response message or error for unary requests, void for streaming requests
	 */
	async handleRequest(
		service: string,
		method: string,
		message: any,
		requestId: string,
		isStreaming: boolean = false,
	): Promise<{
		message?: any
		error?: string
		request_id: string
	} | void> {
		try {
			// If this is a streaming request, use the streaming handler
			if (isStreaming) {
				await this.handleStreamingRequest(service, method, message, requestId)
				return
			}

			// Get the service handler from the config
			const serviceConfig = serviceHandlers[service]
			if (!serviceConfig) {
				throw new Error(`Unknown service: ${service}`)
			}

			// Handle unary request
			return {
				message: await serviceConfig.requestHandler(this.controller, method, message),
				request_id: requestId,
			}
		} catch (error) {
			return {
				error: error instanceof Error ? error.message : String(error),
				request_id: requestId,
			}
		}
	}

	/**
	 * Handle a streaming gRPC request
	 * @param service The service name
	 * @param method The method name
	 * @param message The request message
	 * @param requestId The request ID for response correlation
	 */
	private async handleStreamingRequest(service: string, method: string, message: any, requestId: string): Promise<void> {
		// Create a response stream function
		const responseStream: StreamingResponseHandler = async (
			response: any,
			isLast: boolean = false,
			sequenceNumber?: number,
		) => {
			await this.controller.postMessageToWebview({
				type: "grpc_response",
				grpc_response: {
					message: response,
					request_id: requestId,
					is_streaming: !isLast,
					sequence_number: sequenceNumber,
				},
			})
		}

		try {
			// Get the service handler from the config
			const serviceConfig = serviceHandlers[service]
			if (!serviceConfig) {
				throw new Error(`Unknown service: ${service}`)
			}

			// Check if the service supports streaming
			if (!serviceConfig.streamingHandler) {
				throw new Error(`Service ${service} does not support streaming`)
			}

			// Handle streaming request
			await serviceConfig.streamingHandler(this.controller, method, message, responseStream)

			// Don't send a final message here - the stream should stay open for future updates
			// The stream will be closed when the client disconnects or when the service explicitly ends it
		} catch (error) {
			// Send error response
			await this.controller.postMessageToWebview({
				type: "grpc_response",
				grpc_response: {
					error: error instanceof Error ? error.message : String(error),
					request_id: requestId,
					is_streaming: false,
				},
			})
		}
	}
}

// Map to track active streaming requests
const activeStreamingRequests = new Map<string, AbortController>()

/**
 * Handle a gRPC request from the webview
 * @param controller The controller instance
 * @param request The gRPC request
 */
export async function handleGrpcRequest(
	controller: Controller,
	request: {
		service: string
		method: string
		message: any
		request_id: string
		is_streaming?: boolean
	},
) {
	try {
		const grpcHandler = new GrpcHandler(controller)

		// For streaming requests, handleRequest handles sending responses directly
		if (request.is_streaming) {
			// Create an AbortController for this streaming request
			const abortController = new AbortController()
			activeStreamingRequests.set(request.request_id, abortController)

			try {
				await grpcHandler.handleRequest(request.service, request.method, request.message, request.request_id, true)
			} finally {
				// Clean up when the request is done
				activeStreamingRequests.delete(request.request_id)
			}
			return
		}

		// For unary requests, we get a response and send it back
		const response = (await grpcHandler.handleRequest(
			request.service,
			request.method,
			request.message,
			request.request_id,
			false,
		)) as {
			message?: any
			error?: string
			request_id: string
		}

		// Send the response back to the webview
		await controller.postMessageToWebview({
			type: "grpc_response",
			grpc_response: response,
		})
	} catch (error) {
		// Send error response
		await controller.postMessageToWebview({
			type: "grpc_response",
			grpc_response: {
				error: error instanceof Error ? error.message : String(error),
				request_id: request.request_id,
			},
		})
	}
}

/**
 * Handle a gRPC request cancellation from the webview
 * @param controller The controller instance
 * @param request The cancellation request
 */
export async function handleGrpcRequestCancel(
	controller: Controller,
	request: {
		request_id: string
	},
) {
	const abortController = activeStreamingRequests.get(request.request_id)
	if (abortController) {
		// Abort the request
		abortController.abort()
		activeStreamingRequests.delete(request.request_id)

		// Send a cancellation confirmation
		await controller.postMessageToWebview({
			type: "grpc_response",
			grpc_response: {
				message: { cancelled: true },
				request_id: request.request_id,
				is_streaming: false,
			},
		})
	}
}
