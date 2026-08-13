import type { CoreConnectionMessage } from "@generated/grpc-js/host/core_connection";
import type { ExtensionMessage } from "@shared/ExtensionMessage";

export type CoreConnectionMessageWriter = (
	message: CoreConnectionMessage,
) => Promise<void>;
export type CoreRequestHandler = (
	postMessage: (message: ExtensionMessage) => Promise<boolean>,
	request: {
		service: string;
		method: string;
		message: unknown;
		request_id: string;
		is_streaming: boolean;
	},
) => Promise<void>;

/** Protocol logic shared by the production dispatcher and focused tests. */
export async function dispatchCoreConnectionRequest(
	write: CoreConnectionMessageWriter,
	request: NonNullable<CoreConnectionMessage["request"]>,
	isStreamingMethod: (qualifiedMethod: string) => boolean,
	handleRequest: CoreRequestHandler,
): Promise<void> {
	const qualifiedMethod = `${request.service}.${request.method}`;
	if (isStreamingMethod(qualifiedMethod) !== request.isStreaming) {
		await write({
			response: {
				requestId: request.requestId,
				error: `${qualifiedMethod} streaming mode does not match its proto contract`,
				completed: true,
			},
		});
		return;
	}

	await handleRequest(
		(message) => forwardCoreControllerResponse(write, message),
		{
			service: request.service,
			method: request.method,
			message: JSON.parse(request.messageJson || "{}"),
			request_id: request.requestId,
			is_streaming: request.isStreaming,
		},
	);
}

export async function forwardCoreControllerResponse(
	write: CoreConnectionMessageWriter,
	message: ExtensionMessage,
): Promise<boolean> {
	const response = message.grpc_response;
	if (!response) {
		return false;
	}
	await write({
		response: {
			requestId: response.request_id,
			messageJson:
				response.message === undefined
					? undefined
					: JSON.stringify(response.message),
			error: response.error,
			completed: response.error !== undefined || response.is_streaming !== true,
		},
	});
	return true;
}
