import type {
	HubClientRegistration,
	HubCommandEnvelope,
	HubReplyEnvelope,
} from "@clinebot/shared";
import { createSessionId } from "@clinebot/shared";
import {
	asPlainRecord,
	errorReply,
	type HubTransportContext,
	okReply,
} from "./context";

export function handleClientRegister(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): HubReplyEnvelope {
	const payload = envelope.payload as HubClientRegistration | undefined;
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
	return okReply(envelope, { clientId });
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
