import { StreamingResponseHandler } from "./grpc-handler"

/**
 * Information about a registered gRPC request
 */
export interface RequestInfo {
	/**
	 * Function to clean up resources when the request is cancelled or completed
	 */
	cleanup: () => void

	/**
	 * Optional metadata about the request
	 */
	metadata?: any

	/**
	 * Timestamp when the request was registered
	 */
	timestamp: Date

	/**
	 * The streaming response handler for this request
	 */
	responseStream?: StreamingResponseHandler<any>
}

/**
 * Registry for managing gRPC request lifecycles
 * This class provides a centralized way to track active requests and their cleanup functions
 */
export class GrpcRequestRegistry {
	/**
	 * Map of request IDs to request information
	 */
	private activeRequests = new Map<string, RequestInfo>()

	/**
	 * Register a new request with its cleanup function
	 * @param requestId The unique ID of the request
	 * @param cleanup Function to clean up resources when the request is cancelled
	 * @param metadata Optional metadata about the request
	 * @param responseStream Optional streaming response handler
	 */
	public registerRequest(
		requestId: string,
		cleanup: () => void,
		metadata?: any,
		responseStream?: StreamingResponseHandler<any>,
	): void {
		this.activeRequests.set(requestId, {
			cleanup,
			metadata,
			timestamp: new Date(),
			responseStream,
		})
		console.log(`[DEBUG] Registered request: ${requestId}`)
	}

	/**
	 * Cancel a request and clean up its resources
	 * @param requestId The ID of the request to cancel
	 * @returns True if the request was found and cancelled, false otherwise
	 */
	public cancelRequest(requestId: string): boolean {
		const requestInfo = this.activeRequests.get(requestId)
		if (!requestInfo) {
			return false
		}
		try {
			requestInfo.cleanup()
			console.log(`[DEBUG] Cleaned up request: ${requestId}`)
		} catch (error) {
			console.error(`Error cleaning up request ${requestId}:`, error)
		}
		this.activeRequests.delete(requestId)
		return true
	}

	/**
	 * Get information about a request
	 * @param requestId The ID of the request
	 * @returns The request information, or undefined if not found
	 */
	public getRequestInfo(requestId: string): RequestInfo | undefined {
		return this.activeRequests.get(requestId)
	}

	/**
	 * Check if a request exists in the registry
	 * @param requestId The ID of the request
	 * @returns True if the request exists, false otherwise
	 */
	public hasRequest(requestId: string): boolean {
		return this.activeRequests.has(requestId)
	}

	/**
	 * Get all active requests
	 * @returns An array of [requestId, requestInfo] pairs
	 */
	public getAllRequests(): [string, RequestInfo][] {
		return Array.from(this.activeRequests.entries())
	}

	/**
	 * Clean up stale requests that have been active for too long
	 * @param maxAgeMs Maximum age in milliseconds before a request is considered stale
	 * @returns The number of requests that were cleaned up
	 */
	public cleanupStaleRequests(maxAgeMs: number): number {
		const now = new Date()
		let cleanedCount = 0

		for (const [requestId, info] of this.activeRequests.entries()) {
			if (now.getTime() - info.timestamp.getTime() > maxAgeMs) {
				this.cancelRequest(requestId)
				cleanedCount++
			}
		}

		return cleanedCount
	}
}
