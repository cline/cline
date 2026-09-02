import type { Controller } from "@core/controller"
import { handleGrpcRequest } from "@core/controller/grpc-handler"
import {
	responseStreamingMethods,
	serviceRequestDecoders,
	serviceResponseEncoders,
} from "@generated/hosts/vscode/protobus-services"
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

/**
 * The mirror of the request decode: responses leave over the core connection as
 * JSON, and the webview on the other side decodes them with ts-proto's fromJSON,
 * which expects proto3 JSON. Encode with the generated toJSON so bytes fields
 * become base64 (a raw Uint8Array stringifies to an index-keyed object fromJSON
 * cannot read) and extra non-proto fields on loosely-typed handler results are
 * dropped before the wire, matching what fromJSON would keep anyway.
 *
 * toJSON throws on a handler result that violates its response proto typing
 * (e.g. null inside a repeated message field) — shapes today's raw
 * JSON.stringify forwards without complaint. Fall back to the raw message on
 * encode failure rather than turning a working-in-practice RPC into an error.
 */
export function encodeCoreConnectionResponseMessage(service: string, method: string, message: unknown): unknown {
	const encoder = serviceResponseEncoders[service]?.[method]
	if (!encoder) {
		return message
	}
	try {
		return encoder(message)
	} catch (error) {
		console.error(`Failed to encode ${service}.${method} response as proto3 JSON, forwarding it raw:`, error)
		return message
	}
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
		(message) => encodeCoreConnectionResponseMessage(request.service, request.method, message),
		(postMessage, grpcRequest) =>
			// A decode failure throws out of the dispatch; the connection layer
			// reports it as this request's error response.
			handleGrpcRequest(controller, postMessage, {
				...grpcRequest,
				message: decodeCoreConnectionRequestMessage(grpcRequest.service, grpcRequest.method, grpcRequest.message),
			}),
	)
}
