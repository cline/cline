import { Controller } from "../index"
import { StreamingResponseHandler } from "../grpc-handler"

// Define types for unary and streaming methods
type UnaryStateMethod<Req, Res> = (controller: Controller, request: Req) => Promise<Res>
type StreamingStateMethod<Req> = (controller: Controller, request: Req, responseStream: StreamingResponseHandler) => Promise<void>

// Combined type for method registry
type StateMethod<Req, Res> = UnaryStateMethod<Req, Res> | StreamingStateMethod<Req>

// Method metadata to track streaming status
interface MethodMetadata {
	isStreaming: boolean
}

const methodRegistry: Record<string, StateMethod<any, any>> = {}
const methodMetadata: Record<string, MethodMetadata> = {}

/**
 * Register a method with the state service
 * @param name The name of the method
 * @param method The method implementation
 * @param metadata Optional metadata about the method
 */
export function registerMethod<Req, Res>(
	name: string,
	method: UnaryStateMethod<Req, Res> | StreamingStateMethod<Req>,
	metadata?: MethodMetadata,
): void {
	methodRegistry[name] = method
	methodMetadata[name] = {
		isStreaming: name === "subscribeToState" || (metadata?.isStreaming ?? false),
	}
}

/**
 * Get a method from the registry
 * @param name The name of the method
 * @returns The method implementation or undefined if not found
 */
export function getMethod(name: string): StateMethod<any, any> | undefined {
	return methodRegistry[name]
}

/**
 * Check if a method is a streaming method
 * @param name The name of the method
 * @returns True if the method is a streaming method
 */
export function isStreamingMethod(name: string): boolean {
	return methodMetadata[name]?.isStreaming ?? false
}

/**
 * Handle a state service request
 * @param controller The controller instance
 * @param method The method name
 * @param message The request message
 * @returns The response message
 */
export async function handleStateServiceRequest(controller: Controller, method: string, message: any): Promise<any> {
	const stateMethod = methodRegistry[method]
	if (!stateMethod) {
		throw new Error(`Unknown method: ${method}`)
	}

	if (isStreamingMethod(method)) {
		throw new Error(`Method ${method} is a streaming method and should be handled with handleStreamingStateServiceRequest`)
	}

	return await (stateMethod as UnaryStateMethod<any, any>)(controller, message)
}

/**
 * Handle a streaming state service request
 * @param controller The controller instance
 * @param method The method name
 * @param message The request message
 * @param responseStream The streaming response handler
 */
export async function handleStreamingStateServiceRequest(
	controller: Controller,
	method: string,
	message: any,
	responseStream: StreamingResponseHandler,
): Promise<void> {
	const stateMethod = methodRegistry[method]
	if (!stateMethod) {
		throw new Error(`Unknown method: ${method}`)
	}

	if (!isStreamingMethod(method)) {
		throw new Error(`Method ${method} is not a streaming method and should be handled with handleStateServiceRequest`)
	}

	await (stateMethod as StreamingStateMethod<any>)(controller, message, responseStream)
}

// Export all methods
export * from "./methods"
