import { Controller } from "./index"
import { serviceHandlers } from "@generated/hosts/vscode/protobus-services"
import { GrpcRequestRegistry } from "./grpc-request-registry"
import { GrpcRequest } from "@shared/WebviewMessage"

export type JsonUnaryHandler<TRequest, TResponse> = {
	handler: UnaryHandler<TRequest, TResponse>
	decodeRequest: (_: unknown) => TRequest
	encodeResponse: (_: TResponse) => unknown
}
export type JsonStreamingHandler<TRequest, TResponse> = {
	handler: StreamingHandler<TRequest, TResponse>
	decodeRequest: (_: unknown) => TRequest
	encodeResponse: (_: TResponse) => unknown
}

export type UnaryHandler<TRequest, TResponse> = (controller: Controller, request: TRequest) => Promise<TResponse>

export type StreamingHandler<TRequest, TResponse> = (
	controller: Controller,
	request: TRequest,
	callback: StreamingResponseHandler<TResponse>,
	requestId: string,
) => Promise<void>

/**
 * Type definition for a streaming response handler
 */
export type StreamingResponseHandler<TResponse> = (
	response: TResponse,
	isLast?: boolean,
	sequenceNumber?: number,
) => Promise<void>

// Registry to track active gRPC requests and their cleanup functions
const requestRegistry = new GrpcRequestRegistry()

/**
 * Handle a gRPC request from the webview
 * @param controller The controller instance
 * @param request The gRPC request
 */
export async function handleGrpcRequest(controller: Controller, request: GrpcRequest) {
	if (request.is_streaming) {
		await handleStreamingRequest(controller, request.service, request.method, request.message, request.request_id)
	} else {
		await handleUnaryRequest(controller, request.service, request.method, request.message, request.request_id)
	}
}

/**
 * Handle a gRPC request from the webview
 * @param service The service name
 * @param method The method name
 * @param requestJSON The JSON request message
 * @param requestId The request ID for response correlation
 * @param isStreaming Whether this is a streaming request
 * @returns The response message or error for unary requests, void for streaming requests
 */
async function handleUnaryRequest(
	controller: Controller,
	service: string,
	method: string,
	requestJSON: any,
	requestId: string,
): Promise<void> {
	try {
		// Get the service handler from the config
		const handler = getHandler(service, method) as JsonUnaryHandler<any, any>
		// Decode the request from JSON.
		const request = handler.decodeRequest(requestJSON)
		// Call the handler
		const response = await handler.handler(controller, request)
		// Encode the response to JSON.
		const responseJSON = handler.encodeResponse(response)
		const grpcResponse = { message: responseJSON, request_id: requestId }

		// Send the response back to the webview
		await controller.postMessageToWebview({ type: "grpc_response", grpc_response: grpcResponse })
	} catch (error) {
		console.log("Protobus error:", error)
		await controller.postMessageToWebview({
			type: "grpc_response",
			grpc_response: {
				error: error instanceof Error ? error.message : String(error),
				request_id: requestId,
			},
		})
	}
}

/**
 * Handle a streaming gRPC request
 * @param service The service name
 * @param method The method name
 * @param requestJSON The request message
 * @param requestId The request ID for response correlation
 */
async function handleStreamingRequest(
	controller: Controller,
	service: string,
	method: string,
	requestJSON: any,
	requestId: string,
): Promise<void> {
	try {
		// Get the service handler from the config
		const handler = getHandler(service, method) as JsonStreamingHandler<any, any>

		// Create a response stream function
		const callback: StreamingResponseHandler<any> = async (
			response: any,
			isLast: boolean = false,
			sequenceNumber?: number,
		) => {
			// Encode the response
			const responseJSON = handler.encodeResponse(response)
			await controller.postMessageToWebview({
				type: "grpc_response",
				grpc_response: {
					message: responseJSON,
					request_id: requestId,
					is_streaming: !isLast,
					sequence_number: sequenceNumber,
				},
			})
		}
		// Decode the request
		const request = handler.decodeRequest(requestJSON)
		// Handle streaming request and pass the requestId to the streaming handler.
		await handler.handler(controller, request, callback, requestId)

		// Don't send a final message here - the stream should stay open for future updates
		// The stream will be closed when the client disconnects or when the service explicitly ends it
	} catch (error) {
		// Send error response
		console.log("Protobus error:", error)
		await controller.postMessageToWebview({
			type: "grpc_response",
			grpc_response: {
				error: error instanceof Error ? error.message : String(error),
				request_id: requestId,
				is_streaming: false,
			},
		})
	}
}

/**
 * Handle a gRPC request cancellation from the webview
 * @param controller The controller instance
 * @param request The cancellation request
 */
export async function handleGrpcRequestCancel(controller: Controller, request: { request_id: string }) {
	const cancelled = requestRegistry.cancelRequest(request.request_id)

	if (cancelled) {
		// Send a cancellation confirmation
		await controller.postMessageToWebview({
			type: "grpc_response",
			grpc_response: {
				message: { cancelled: true },
				request_id: request.request_id,
				is_streaming: false,
			},
		})
	} else {
		console.log(`[DEBUG] Request not found for cancellation: ${request.request_id}`)
	}
}

function getHandler(serviceName: string, methodName: string): JsonUnaryHandler<any, any> | JsonStreamingHandler<any, any> {
	// Get the service handler from the config
	const serviceConfig = serviceHandlers[serviceName]
	if (!serviceConfig) {
		throw new Error(`Unknown service: ${serviceName}`)
	}
	const handler = serviceConfig[methodName]
	if (!handler) {
		throw new Error(`Unknown rpc: ${serviceName}.${methodName}`)
	}
	return handler
}

/**
 * Get the request registry instance
 * This allows other parts of the code to access the registry
 */
export function getRequestRegistry(): GrpcRequestRegistry {
	return requestRegistry
}
