import { Controller } from "./index"
import { StreamingResponseHandler } from "./grpc-handler"
import {
	handleStateServiceRequest as handleStateRequest,
	handleStreamingStateServiceRequest,
	registerAllMethods,
} from "./state/index"

// Initialize the state service
registerAllMethods()

/**
 * Handle a state service request
 * @param controller The controller instance
 * @param method The method name
 * @param message The request message
 * @returns The response message
 */
export async function handleStateServiceRequest(controller: Controller, method: string, message: any): Promise<any> {
	return await handleStateRequest(controller, method, message)
}

/**
 * Handle a streaming state service request
 * @param controller The controller instance
 * @param method The method name
 * @param message The request message
 * @param responseStream The streaming response handler
 */
export async function handleStreamingRequest(
	controller: Controller,
	method: string,
	message: any,
	responseStream: StreamingResponseHandler,
): Promise<void> {
	await handleStreamingStateServiceRequest(controller, method, message, responseStream)
}
