import { hostServiceHandlers } from "./host-grpc-service-config"
import { GrpcRequestRegistry } from "../../src/core/controller/grpc-request-registry"

/**
 * Type definition for a streaming response handler
 */
export type StreamingResponseHandler = (response: any, isLast?: boolean, sequenceNumber?: number) => Promise<void>

// Registry to track active gRPC requests and their cleanup functions
const requestRegistry = new GrpcRequestRegistry()

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
	 * Cancel a gRPC request
	 * @param requestId The request ID to cancel
	 * @returns True if the request was found and cancelled, false otherwise
	 */
	public async cancelRequest(requestId: string): Promise<boolean> {
		const cancelled = requestRegistry.cancelRequest(requestId)

		if (cancelled) {
			// Get the registered response handler from the registry
			const requestInfo = requestRegistry.getRequestInfo(requestId)
			if (requestInfo && requestInfo.responseStream) {
				try {
					// Send cancellation confirmation using the registered response handler
					await requestInfo.responseStream(
						{ cancelled: true },
						true, // Mark as last message
					)
				} catch (e) {
					console.error(`Error sending cancellation response for ${requestId}:`, e)
				}
			}
		} else {
			console.log(`[DEBUG] Request not found for cancellation: ${requestId}`)
		}

		return cancelled
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

/**
 * Get the request registry instance
 * This allows other parts of the code to access the registry
 */
export function getRequestRegistry(): GrpcRequestRegistry {
	return requestRegistry
}
