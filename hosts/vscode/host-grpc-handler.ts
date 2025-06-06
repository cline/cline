import { v4 as uuidv4 } from "uuid"
import { hostServiceHandlers } from "./host-grpc-service-config"
import { GrpcRequestRegistry } from "../../src/core/controller/grpc-request-registry"

/**
 * Type definition for a streaming response handler
 */
export type StreamingResponseHandler = (response: any, isLast?: boolean, sequenceNumber?: number) => Promise<void>

// Registry to track active gRPC requests and their cleanup functions
const requestRegistry = new GrpcRequestRegistry()

/**
 * Callback interface for streaming requests
 */
export interface StreamingCallbacks<T = any> {
	onResponse: (response: T) => void
	onError?: (error: Error) => void
	onComplete?: () => void
}

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
	 * @param streamingCallbacks Optional callbacks for streaming responses
	 * @returns For unary requests: the response message or error. For streaming requests: a cancel function.
	 */
	async handleRequest<T = any>(
		service: string,
		method: string,
		message: any,
		requestId: string,
		streamingCallbacks?: StreamingCallbacks<T>,
	): Promise<
		| {
				message?: any
				error?: string
				request_id: string
		  }
		| (() => void)
	> {
		// If streaming callbacks are provided, handle as a streaming request
		if (streamingCallbacks) {
			let completionCalled = false

			// Create a response handler that will call the client's callbacks
			const responseHandler: StreamingResponseHandler = async (response, isLast = false, sequenceNumber) => {
				try {
					// Call the client's onResponse callback with the response
					streamingCallbacks.onResponse(response)

					// If this is the last response, call the onComplete callback
					if (isLast && streamingCallbacks.onComplete && !completionCalled) {
						completionCalled = true
						streamingCallbacks.onComplete()
					}
				} catch (error) {
					// If there's an error in the callback, call the onError callback
					if (streamingCallbacks.onError) {
						streamingCallbacks.onError(error instanceof Error ? error : new Error(String(error)))
					}
				}
			}

			// Register the response handler with the registry
			requestRegistry.registerRequest(
				requestId,
				() => {
					console.log(`[DEBUG] Cleaning up streaming request: ${requestId}`)
					if (streamingCallbacks.onComplete && !completionCalled) {
						completionCalled = true
						streamingCallbacks.onComplete()
					}
				},
				{ type: "streaming_request", service, method },
				responseHandler,
			)

			// Call the streaming handler directly
			console.log(`[DEBUG] Streaming gRPC host call to ${service}.${method} req:${requestId}`)
			try {
				await this.handleStreamingRequest(service, method, message, requestId)
			} catch (error) {
				if (streamingCallbacks.onError) {
					streamingCallbacks.onError(error instanceof Error ? error : new Error(String(error)))
				}
			}

			// Return a function to cancel the stream
			return () => {
				console.log(`[DEBUG] Cancelling streaming request: ${requestId}`)
				this.cancelRequest(requestId)
			}
		}

		// Handle as a unary request
		try {
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
	}
}

/**
 * Get the request registry instance
 * This allows other parts of the code to access the registry
 */
export function getRequestRegistry(): GrpcRequestRegistry {
	return requestRegistry
}
