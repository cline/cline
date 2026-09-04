import * as grpc from "@grpc/grpc-js"
import { type Channel, type ClientMiddleware, type CompatServiceDefinition, createClientFactory, Metadata } from "nice-grpc"

/**
 * Request header carrying the per-spawn token that identifies this core to the
 * host that started it. The name is part of the host<->core contract — keep it
 * in sync with the host-side interceptor (JetBrains: SessionTokenInterceptor).
 */
export const HOST_BRIDGE_TOKEN_HEADER = "cline-hostbridge-token"

/**
 * The Host Bridge listens on loopback with insecure credentials, so binding
 * pins *where* it listens but cannot prove *who* is calling: any local process
 * or OS user can dial the port and drive the IDE. Echoing the token the host
 * generated for this spawn lets the host tell its own core apart from an
 * orphaned/foreign one — or from unrelated local code.
 *
 * This reuses the token already issued for the core connection stream
 * (CLINE_CORE_CONNECTION_TOKEN) rather than introducing a second secret, so
 * there is one credential per spawn with one lifetime.
 *
 * Read at call time, not module load: tests and embedders set the variable
 * after import, and a core spawned without a token (standalone dev runs, older
 * hosts) simply sends no header.
 */
export function getHostBridgeToken(): string | undefined {
	return process.env.CLINE_CORE_CONNECTION_TOKEN || undefined
}

/** Metadata for hand-written `@grpc/grpc-js` clients (health check, core connection stream). */
export function hostBridgeGrpcMetadata(): grpc.Metadata {
	const metadata = new grpc.Metadata()
	const token = getHostBridgeToken()
	if (token) {
		metadata.set(HOST_BRIDGE_TOKEN_HEADER, token)
	}
	return metadata
}

/** Attaches the token to every outgoing call, preserving any caller-supplied metadata. */
export const hostBridgeAuthMiddleware: ClientMiddleware = async function* (call, options) {
	const token = getHostBridgeToken()
	if (!token) {
		return yield* call.next(call.request, options)
	}
	const metadata = Metadata(options.metadata).set(HOST_BRIDGE_TOKEN_HEADER, token)
	return yield* call.next(call.request, { ...options, metadata })
}

/**
 * Creates an authenticated Host Bridge client. Used by the generated clients in
 * place of nice-grpc's `createClient` — see scripts/generate-host-bridge-client.mjs.
 */
export function createHostBridgeClient<Service extends CompatServiceDefinition>(definition: Service, channel: Channel) {
	return createClientFactory().use(hostBridgeAuthMiddleware).create(definition, channel)
}
