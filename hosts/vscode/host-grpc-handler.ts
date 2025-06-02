import { hostServiceHandlers } from "./host-grpc-service-config"
import { GrpcRequestRegistry } from "../../src/core/controller/grpc-request-registry"

/**
 * Type definition for a streaming response handler
 */
export type StreamingResponseHandler = (response: any, isLast?: boolean, sequenceNumber?: number) => Promise<void>

/**
 * Handles gRPC requests from the webview
 */
export class GrpcHandler {
	constructor() {}

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
			const serviceConfig = hostServiceHandlers[service]
			if (!serviceConfig) {
				throw new Error(`Unknown service: ${service}`)
			}

			// Handle unary request
			return {
				message: await serviceConfig.requestHandler(method, message),
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
		try {
			// Get the service handler from the config
			const serviceConfig = hostServiceHandlers[service]
			if (!serviceConfig) {
				throw new Error(`Unknown service: ${service}`)
			}

			// Check if the service supports streaming
			if (!serviceConfig.streamingHandler) {
				throw new Error(`Service ${service} does not support streaming`)
			}

			// Get the registered response handler from the registry
			const requestInfo = requestRegistry.getRequestInfo(requestId)
			if (!requestInfo || !requestInfo.responseStream) {
				throw new Error(`No response handler registered for request: ${requestId}`)
			}

			// Use the registered response handler
			const responseStream = requestInfo.responseStream

			// Handle streaming request and pass the requestId to all streaming handlers
			await serviceConfig.streamingHandler(method, message, responseStream, requestId)

			// Don't send a final message here - the stream should stay open for future updates
			// The stream will be closed when the client disconnects or when the service explicitly ends it
		} catch (error) {
			console.error(`Error handling streaming request ${requestId}:`, error)

			// Get the registered response handler from the registry
			const requestInfo = requestRegistry.getRequestInfo(requestId)
			if (requestInfo && requestInfo.responseStream) {
				try {
					// Send error to the client using the registered response handler
					await requestInfo.responseStream(
						{ error: error instanceof Error ? error.message : String(error) },
						true, // Mark as last message
					)
				} catch (e) {
					console.error(`Error sending error response for ${requestId}:`, e)
				}
			}

			// Clean up the request
			requestRegistry.cancelRequest(requestId)
		}
	}
}

// Registry to track active gRPC requests and their cleanup functions
const requestRegistry = new GrpcRequestRegistry()

/**
 * Handle a gRPC request from the webview
 * @param request The gRPC request
 */
export async function handleGrpcRequest(request: {
	service: string
	method: string
	message: any
	request_id: string
	is_streaming?: boolean
}) {
	try {
		const grpcHandler = new GrpcHandler()

		// For streaming requests, handleRequest handles sending responses directly
		if (request.is_streaming) {
			try {
				await grpcHandler.handleRequest(request.service, request.method, request.message, request.request_id, true)
			} finally {
				// Note: We don't automatically clean up here anymore
				// The request will be cleaned up when it completes or is cancelled
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

		// Return the response directly to the caller
		return response
	} catch (error) {
		// Return error response directly to the caller
		return {
			error: error instanceof Error ? error.message : String(error),
			request_id: request.request_id,
		}
	}
}

/**
 * Handle a gRPC request cancellation from the webview
 * @param request The cancellation request
 */
export async function handleGrpcRequestCancel(request: { request_id: string }) {
	const cancelled = requestRegistry.cancelRequest(request.request_id)

	if (cancelled) {
		// Get the registered response handler from the registry
		const requestInfo = requestRegistry.getRequestInfo(request.request_id)
		if (requestInfo && requestInfo.responseStream) {
			try {
				// Send cancellation confirmation using the registered response handler
				await requestInfo.responseStream(
					{ cancelled: true },
					true, // Mark as last message
				)
			} catch (e) {
				console.error(`Error sending cancellation response for ${request.request_id}:`, e)
			}
		}
	} else {
		console.log(`[DEBUG] Request not found for cancellation: ${request.request_id}`)
	}
}

/**
 * Get the request registry instance
 * This allows other parts of the code to access the registry
 */
export function getRequestRegistry(): GrpcRequestRegistry {
	return requestRegistry
}
