/**
 * `gateway.hello` negotiation (Gateway RFC, Phase 0).
 *
 * Pure protocol logic: given the client's offered versions and the
 * Gateway's identity, either negotiate the connection or fail with
 * `protocol_version_unsupported`. No transport here.
 */

import {
	type CatalogGeneration,
	type ClientId,
	createClientId,
	createGatewayError,
	GATEWAY_PROTOCOL_VERSION,
	type GatewayError,
	GatewayHelloParamsSchema,
	type GatewayHelloResult,
	GatewayHelloResultSchema,
	type GatewayId,
	type GatewayInstanceId,
	KNOWN_GATEWAY_CAPABILITIES,
} from "@cline/shared/gateway";

/** Protocol versions this Gateway build can speak. */
export const SUPPORTED_PROTOCOL_VERSIONS: readonly number[] = [
	GATEWAY_PROTOCOL_VERSION,
];

export interface GatewayIdentityInfo {
	gatewayId: GatewayId;
	instanceId: GatewayInstanceId;
	catalogGeneration: CatalogGeneration;
	capabilities?: readonly string[];
}

export type HelloNegotiation =
	| { ok: true; result: GatewayHelloResult }
	| { ok: false; error: GatewayError };

export function negotiateHello(
	rawParams: unknown,
	gateway: GatewayIdentityInfo,
	options: { assignClientId?: () => ClientId } = {},
): HelloNegotiation {
	const params = GatewayHelloParamsSchema.safeParse(rawParams);
	if (!params.success) {
		return {
			ok: false,
			error: createGatewayError(
				"invalid_request",
				`Malformed gateway.hello params: ${params.error.issues[0]?.message ?? "unknown"}`,
			),
		};
	}
	const shared = params.data.protocolVersions.filter((version) =>
		SUPPORTED_PROTOCOL_VERSIONS.includes(version),
	);
	if (shared.length === 0) {
		return {
			ok: false,
			error: createGatewayError(
				"protocol_version_unsupported",
				`No shared protocol version; client offered [${params.data.protocolVersions.join(", ")}], gateway supports [${SUPPORTED_PROTOCOL_VERSIONS.join(", ")}]`,
				{ retryable: false },
			),
		};
	}
	const result = GatewayHelloResultSchema.parse({
		protocolVersion: Math.max(...shared),
		gatewayId: gateway.gatewayId,
		instanceId: gateway.instanceId,
		clientId:
			params.data.client.clientId ??
			(options.assignClientId ?? (() => createClientId()))(),
		capabilities: [...(gateway.capabilities ?? KNOWN_GATEWAY_CAPABILITIES)],
		catalogGeneration: gateway.catalogGeneration,
	});
	return { ok: true, result };
}
