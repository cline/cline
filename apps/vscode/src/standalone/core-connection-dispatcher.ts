import type { Controller } from "@core/controller"
import { handleGrpcRequest } from "@core/controller/grpc-handler"
import { responseStreamingMethods, serviceRequestDecoders } from "@generated/hosts/vscode/protobus-services"
import {
	type CoreConnectionMessageWriter,
	dispatchCoreConnectionRequest as dispatchProtocolRequest,
} from "./core-connection-protocol"

/**
 * Requests arrive over the core connection as proto3 JSON (the webview encodes
 * them with ts-proto's toJSON): enums are string names, and default-valued
 * fields — empty repeated fields included — are omitted entirely. The protobus
 * handlers assume ts-proto message shapes (numeric enums, repeated fields
 * always present), so decode with the generated fromJSON before dispatch.
 * The in-process VS Code webview does not need this: it posts structured-cloned
 * ts-proto objects that never pass through JSON.
 *
 * Unknown methods fall through undecoded; handleGrpcRequest rejects them with
 * its own unknown-rpc error.
 */
export function decodeCoreConnectionRequestMessage(service: string, method: string, message: unknown): unknown {
	const decoder = serviceRequestDecoders[service]?.[method]
	return decoder ? decoder(message) : message
}

export async function dispatchCoreConnectionRequest(
	controller: Controller,
	write: CoreConnectionMessageWriter,
	request: Parameters<typeof dispatchProtocolRequest>[1],
): Promise<void> {
	await dispatchProtocolRequest(
		write,
		request,
		(qualifiedMethod) => responseStreamingMethods.has(qualifiedMethod),
		(postMessage, grpcRequest) =>
			// A decode failure throws out of the dispatch; the connection layer
			// reports it as this request's error response.
			handleGrpcRequest(controller, postMessage, {
				...grpcRequest,
				message: decodeCoreConnectionRequestMessage(grpcRequest.service, grpcRequest.method, grpcRequest.message),
			}),
	)
}
