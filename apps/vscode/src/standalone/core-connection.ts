import type { Controller } from "@core/controller"
import { handleGrpcRequestCancel } from "@core/controller/grpc-handler"
import { dispatchCoreConnectionRequest } from "./core-connection-dispatcher"
import { type CoreConnection, type CoreConnectionCredentials, connectCoreStream } from "./core-connection-stream"
import { log } from "./utils"

export type { CoreConnection, CoreConnectionCredentials } from "./core-connection-stream"

/** Opens the authenticated reverse-RPC stream on the existing Host Bridge. */
export function connectCoreToHostBridge(
	controller: Controller,
	credentials: CoreConnectionCredentials,
	onDisconnect: (error: Error) => void,
): Promise<CoreConnection> {
	return connectCoreStream(
		requiredEnvironment("HOST_BRIDGE_ADDRESS"),
		credentials,
		{
			onRequest: async (request, write) => {
				try {
					await dispatchCoreConnectionRequest(controller, write, request)
				} catch (error) {
					log(`Core connection request dispatch failed: ${error}`)
					await write({
						response: {
							requestId: request.requestId,
							error: error instanceof Error ? error.message : String(error),
							completed: true,
							messageJsonComplete: false,
						},
					})
				}
			},
			onCancel: (requestId) => {
				// The cancellation confirmation is intentionally discarded: the
				// host has already dropped the request by the time it sends
				// cancel, so there is no one to deliver the confirmation to.
				void handleGrpcRequestCancel(async () => true, { request_id: requestId })
			},
		},
		(error) => {
			log(`Core connection failed: ${error.message}`)
			onDisconnect(error)
		},
	)
}

function requiredEnvironment(name: string): string {
	const value = process.env[name]
	if (!value) {
		throw new Error(`${name} is required for the external core connection`)
	}
	return value
}
