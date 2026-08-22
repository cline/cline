import type { CoreConnectionMessage } from "@generated/grpc-js/host/core_connection"
import type { ExtensionMessage } from "@shared/ExtensionMessage"

export type CoreConnectionMessageWriter = (message: CoreConnectionMessage) => Promise<void>
export type CoreRequestHandler = (
	postMessage: (message: ExtensionMessage) => Promise<boolean>,
	request: {
		service: string
		method: string
		message: unknown
		request_id: string
		is_streaming: boolean
	},
) => Promise<void>

const MAX_RESPONSE_CHUNK_BYTES = 1024 * 1024

/** Protocol logic shared by the production dispatcher and focused tests. */
export async function dispatchCoreConnectionRequest(
	write: CoreConnectionMessageWriter,
	request: NonNullable<CoreConnectionMessage["request"]>,
	isStreamingMethod: (qualifiedMethod: string) => boolean,
	handleRequest: CoreRequestHandler,
): Promise<void> {
	const qualifiedMethod = `${request.service}.${request.method}`
	if (isStreamingMethod(qualifiedMethod) !== request.isStreaming) {
		await write({
			response: {
				requestId: request.requestId,
				error: `${qualifiedMethod} streaming mode does not match its proto contract`,
				completed: true,
				messageJsonComplete: false,
			},
		})
		return
	}

	await handleRequest((message) => forwardCoreControllerResponse(write, message), {
		service: request.service,
		method: request.method,
		message: JSON.parse(request.messageJson || "{}"),
		request_id: request.requestId,
		is_streaming: request.isStreaming,
	})
}

export async function forwardCoreControllerResponse(
	write: CoreConnectionMessageWriter,
	message: ExtensionMessage,
): Promise<boolean> {
	const response = message.grpc_response
	if (!response) {
		return false
	}
	const completed = response.error !== undefined || response.is_streaming !== true
	if (response.message === undefined) {
		await write({
			response: {
				requestId: response.request_id,
				error: response.error,
				completed,
				messageJsonComplete: false,
			},
		})
		return true
	}

	const messageJson = JSON.stringify(response.message)
	if (messageJson === undefined) {
		throw new Error(`Core response ${response.request_id} is not JSON serializable`)
	}
	const payload = new TextEncoder().encode(messageJson)
	for (let offset = 0; offset < Math.max(payload.length, 1); offset += MAX_RESPONSE_CHUNK_BYTES) {
		const end = Math.min(offset + MAX_RESPONSE_CHUNK_BYTES, payload.length)
		await write({
			response: {
				requestId: response.request_id,
				messageJsonChunk: payload.subarray(offset, end),
				messageJsonComplete: end === payload.length,
				error: end === payload.length ? response.error : undefined,
				completed: end === payload.length && completed,
			},
		})
	}
	return true
}
