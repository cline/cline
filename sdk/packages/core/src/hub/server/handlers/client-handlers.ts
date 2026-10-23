import type {
	HubClientRegisterResult,
	HubClientRegistration,
	HubCommandEnvelope,
	HubIncompatibleProtocolDetails,
	HubProtocolMetadata,
	HubReplyEnvelope,
} from "@cline/shared";
import {
	CURRENT_HUB_PROTOCOL_VERSION,
	createSessionId,
	HUB_CAPABILITIES,
	HUB_INCOMPATIBLE_PROTOCOL_ERROR_CODE,
	isHubProtocolCompatible,
	LEGACY_HUB_PROTOCOL_VERSION,
	MAX_CLIENT_HUB_PROTOCOL_VERSION,
	MIN_CLIENT_HUB_PROTOCOL_VERSION,
} from "@cline/shared";
import {
	asPlainRecord,
	errorReply,
	type HubTransportContext,
	okReply,
} from "./context";

/**
 * Commands this transport advertises in the `client.register` reply so clients
 * can feature-detect instead of probing.
 *
 * Re-exported from the shared list rather than maintained here: this used to be
 * its own array and drifted out of sync with the `/version` endpoint's. Add new
 * commands to `HUB_CAPABILITIES` in `@cline/shared`.
 */
export const HUB_TRANSPORT_CAPABILITIES: readonly string[] = HUB_CAPABILITIES;

/** Protocol range this transport accepts from registering clients. */
const HUB_TRANSPORT_PROTOCOL: HubProtocolMetadata = {
	protocolVersion: CURRENT_HUB_PROTOCOL_VERSION,
	minClientProtocolVersion: MIN_CLIENT_HUB_PROTOCOL_VERSION,
	maxClientProtocolVersion: MAX_CLIENT_HUB_PROTOCOL_VERSION,
};

export function handleClientRegister(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): HubReplyEnvelope {
	const payload = envelope.payload as HubClientRegistration | undefined;
	// Clients that predate the handshake send nothing here. They stay compatible,
	// but through the range check rather than around it: absent is treated as the
	// pinned legacy version so the allowance is bounded by what the hub declares
	// it supports. See LEGACY_HUB_PROTOCOL_VERSION.
	const clientProtocolVersion =
		payload?.protocolVersion?.trim() || LEGACY_HUB_PROTOCOL_VERSION;
	if (
		!isHubProtocolCompatible(HUB_TRANSPORT_PROTOCOL, clientProtocolVersion)
			.compatible
	) {
		const details: HubIncompatibleProtocolDetails = {
			serverProtocolVersion: CURRENT_HUB_PROTOCOL_VERSION,
			minClientProtocolVersion: MIN_CLIENT_HUB_PROTOCOL_VERSION,
			maxClientProtocolVersion: MAX_CLIENT_HUB_PROTOCOL_VERSION,
			clientProtocolVersion,
		};
		return errorReply(
			envelope,
			HUB_INCOMPATIBLE_PROTOCOL_ERROR_CODE,
			`Hub protocol ${CURRENT_HUB_PROTOCOL_VERSION} does not support client protocol ${clientProtocolVersion} (supported client protocol range: ${MIN_CLIENT_HUB_PROTOCOL_VERSION}..${MAX_CLIENT_HUB_PROTOCOL_VERSION}).`,
			details,
		);
	}
	const clientId =
		payload?.clientId?.trim() ||
		envelope.clientId?.trim() ||
		createSessionId("client_");
	ctx.clients.set(clientId, {
		clientId,
		clientType: payload?.clientType ?? "unknown",
		displayName: payload?.displayName,
		actorKind: payload?.actorKind ?? "client",
		connectedAt: Date.now(),
		lastSeenAt: Date.now(),
		transport: payload?.transport ?? "native",
		capabilities: payload?.capabilities ?? [],
		metadata: payload?.metadata,
		workspaceContext: payload?.workspaceContext,
	});
	ctx.publish(
		ctx.buildEvent("hub.client.registered", {
			clientId,
			clientType: payload?.clientType ?? "unknown",
			displayName: payload?.displayName,
			connectedAt: Date.now(),
		}),
	);
	return okReply(envelope, {
		clientId,
		protocol: { ...HUB_TRANSPORT_PROTOCOL },
		capabilities: [...HUB_TRANSPORT_CAPABILITIES],
	} satisfies HubClientRegisterResult);
}

export function handleClientUpdate(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): HubReplyEnvelope {
	const clientId = envelope.clientId?.trim();
	const client = clientId ? ctx.clients.get(clientId) : undefined;
	if (!clientId || !client) {
		return errorReply(
			envelope,
			"client_not_found",
			"Client is not registered with this hub.",
		);
	}
	const metadata = asPlainRecord(envelope.payload?.metadata);
	client.lastSeenAt = Date.now();
	if (metadata) {
		client.metadata = JSON.parse(JSON.stringify(metadata));
	}
	if (Array.isArray(envelope.payload?.capabilities)) {
		client.capabilities = envelope.payload.capabilities.flatMap((value) => {
			if (!value || typeof value !== "object" || Array.isArray(value))
				return [];
			const capability = value as Record<string, unknown>;
			if (typeof capability.name !== "string" || !capability.name.trim()) {
				return [];
			}
			return [
				{
					name: capability.name.trim(),
					...(typeof capability.description === "string"
						? { description: capability.description }
						: {}),
					...(Array.isArray(capability.scopes) &&
					capability.scopes.every((scope) => typeof scope === "string")
						? { scopes: capability.scopes }
						: {}),
				},
			];
		});
	}
	return okReply(envelope);
}

export function handleClientUnregister(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
	onClientRemoved: (clientId: string) => void,
): HubReplyEnvelope {
	const clientId = envelope.clientId?.trim();
	if (clientId) {
		ctx.clients.delete(clientId);
		onClientRemoved(clientId);
		ctx.publish(ctx.buildEvent("hub.client.disconnected", { clientId }));
	}
	return okReply(envelope);
}

export function handleClientList(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): HubReplyEnvelope {
	return okReply(envelope, { clients: [...ctx.clients.values()] });
}
