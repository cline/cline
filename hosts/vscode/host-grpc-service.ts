import { StreamingResponseHandler } from "./host-grpc-handler"

/**
 * Generic type for service method handlers
 */
export type ServiceMethodHandler = (message: any) => Promise<any>

/**
 * Type for streaming method handlers
 */
export type StreamingMethodHandler = (message: any, responseStream: StreamingResponseHandler, requestId?: string) => Promise<void>

/**
 * Method metadata including streaming information
 */
export interface MethodMetadata {
	isStreaming: boolean
}

/**
 * Generic service registry for gRPC services
 */
export class ServiceRegistry {
	private serviceName: string
	private methodRegistry: Record<string, ServiceMethodHandler> = {}
	private streamingMethodRegistry: Record<string, StreamingMethodHandler> = {}
	private methodMetadata: Record<string, MethodMetadata> = {}

	/**
	 * Create a new service registry
	 * @param serviceName The name of the service (used for logging)
	 */
	constructor(serviceName: string) {
		this.serviceName = serviceName
	}

	/**
	 * Register a method handler
	 * @param methodName The name of the method to register
	 * @param handler The handler function for the method
	 * @param metadata Optional metadata about the method
	 */
	registerMethod(methodName: string, handler: ServiceMethodHandler | StreamingMethodHandler, metadata?: MethodMetadata): void {
		const isStreaming = metadata?.isStreaming || false

		if (isStreaming) {
			this.streamingMethodRegistry[methodName] = handler as StreamingMethodHandler
		} else {
			this.methodRegistry[methodName] = handler as ServiceMethodHandler
		}

		this.methodMetadata[methodName] = { isStreaming, ...metadata }
		console.log(`Registered ${this.serviceName} method: ${methodName}${isStreaming ? " (streaming)" : ""}`)
	}

	/**
	 * Check if a method is a streaming method
	 * @param method The method name
	 * @returns True if the method is a streaming method
	 */
	isStreamingMethod(method: string): boolean {
		return this.methodMetadata[method]?.isStreaming || false
	}

	/**
	 * Get a streaming method handler
	 * @param method The method name
	 * @returns The streaming method handler or undefined if not found
	 */
	getStreamingHandler(method: string): StreamingMethodHandler | undefined {
		return this.streamingMethodRegistry[method]
	}

	/**
	 * Handle a service request
	 * @param method The method name
	 * @param message The request message
	 * @returns The response message
	 */
	async handleRequest(method: string, message: any): Promise<any> {
		const handler = this.methodRegistry[method]

		if (!handler) {
			if (this.isStreamingMethod(method)) {
				throw new Error(`Method ${method} is a streaming method and should be handled with handleStreamingRequest`)
			}
			throw new Error(`Unknown ${this.serviceName} method: ${method}`)
		}

		return handler(message)
	}

	/**
	 * Handle a streaming service request
	 * @param method The method name
	 * @param message The request message
	 * @param responseStream The streaming response handler
	 * @param requestId The request ID for correlation and cleanup
	 */
	async handleStreamingRequest(
		method: string,
		message: any,
		responseStream: StreamingResponseHandler,
		requestId?: string,
	): Promise<void> {
		const handler = this.streamingMethodRegistry[method]

		if (!handler) {
			if (this.methodRegistry[method]) {
				throw new Error(`Method ${method} is not a streaming method and should be handled with handleRequest`)
			}
			throw new Error(`Unknown ${this.serviceName} streaming method: ${method}`)
		}

		await handler(message, responseStream, requestId)
	}
}

/**
 * Create a service registry factory function
 * @param serviceName The name of the service
 * @returns An object with register and handle functions
 */
export function createServiceRegistry(serviceName: string) {
	const registry = new ServiceRegistry(serviceName)

	return {
		registerMethod: (methodName: string, handler: ServiceMethodHandler | StreamingMethodHandler, metadata?: MethodMetadata) =>
			registry.registerMethod(methodName, handler, metadata),

		handleRequest: (method: string, message: any) => registry.handleRequest(method, message),

		handleStreamingRequest: (method: string, message: any, responseStream: StreamingResponseHandler, requestId?: string) =>
			registry.handleStreamingRequest(method, message, responseStream, requestId),

		isStreamingMethod: (method: string) => registry.isStreamingMethod(method),
	}
}
