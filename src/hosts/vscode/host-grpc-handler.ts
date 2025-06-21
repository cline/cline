import { StreamingCallbacks } from "@/hosts/host-provider-types"
import { HostServiceHandlerConfig, hostServiceHandlers } from "./host-grpc-service-config"
import { GrpcRequestRegistry } from "@core/controller/grpc-request-registry"

/**
 * Type definition for a streaming response handler
 */
export type StreamingResponseHandler = (response: any, isLast?: boolean, sequenceNumber?: number) => Promise<void>

// Registry to track active gRPC requests and their cleanup functions
const requestRegistry = new GrpcRequestRegistry()

/**
 * Handles gRPC requests for the host bridge.
 */
export class GrpcHandler {
	constructor() {}

	/**
	 * Handle a gRPC request for the host bridge.
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
		request: any,
		requestId: string,
		streamingCallbacks?: StreamingCallbacks<T>,
	): Promise<any | (() => void)> {
		if (!streamingCallbacks) {
			return this.handleUnaryRequest(service, method, request)
		}

		// If streaming callbacks are provided, handle as a streaming request
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
			await this.handleStreamingRequest(service, method, request, requestId)
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

	private async handleUnaryRequest(service: string, method: string, request: any): Promise<any> {
		const serviceConfig = this.getServiceHandlerConfig(service)
		const response = await serviceConfig.requestHandler(method, request)
		return response
	}

	/**
	 * Cancel a gRPC request
	 * @param requestId The request ID to cancel
	 * @returns True if the request was found and cancelled, false otherwise
	 */
	public async cancelRequest(requestId: string): Promise<boolean> {
		const requestInfo = requestRegistry.getRequestInfo(requestId)
		if (!requestInfo) {
			return false
		}

		const cancelled = requestRegistry.cancelRequest(requestId)
		if (!cancelled) {
			console.log(`[DEBUG] Request not found for cancellation: ${requestId}`)
			return false
		}
		if (requestInfo.responseStream) {
			try {
				// Send cancellation confirmation using the registered response handler
				await requestInfo.responseStream({ cancelled: true }, true /* isLast */)
			} catch (e) {
				console.error(`Error sending cancellation response for ${requestId}:`, e)
			}
		}
		return true
	}

	/**
	 * Handle a streaming gRPC request
	 * @param service The service name
	 * @param method The method name
	 * @param message The request message
	 * @param requestId The request ID for response correlation
	 */
	private async handleStreamingRequest(service: string, method: string, message: any, requestId: string): Promise<void> {
		const serviceConfig = this.getServiceHandlerConfig(service)

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

	private getServiceHandlerConfig(serviceName: string): HostServiceHandlerConfig {
		if (!(serviceName in hostServiceHandlers)) {
			throw new Error(`Unknown service: ${serviceName}`)
		}
		return hostServiceHandlers[serviceName]
	}
}

/**
 * Get the request registry instance
 * This allows other parts of the code to access the registry
 */
export function getRequestRegistry(): GrpcRequestRegistry {
	return requestRegistry
}
