import { Controller } from "./index"
import { handleBrowserServiceRequest } from "./browser/index"
import { ExtensionMessage } from "../../shared/ExtensionMessage"

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
	 * @returns The response message or error
	 */
	async handleRequest(
		service: string,
		method: string,
		message: any,
		requestId: string,
	): Promise<{
		message?: any
		error?: string
		request_id: string
	}> {
		try {
			// Handle BrowserService requests
			if (service === "cline.BrowserService") {
				return {
					message: await handleBrowserServiceRequest(this.controller, method, message),
					request_id: requestId,
				}
			}

			throw new Error(`Unknown service: ${service}`)
		} catch (error) {
			return {
				error: error instanceof Error ? error.message : String(error),
				request_id: requestId,
			}
		}
	}
}

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
	},
) {
	try {
		const grpcHandler = new GrpcHandler(controller)
		const response = await grpcHandler.handleRequest(request.service, request.method, request.message, request.request_id)

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
