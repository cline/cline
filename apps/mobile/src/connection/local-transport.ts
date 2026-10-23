import type { WebSocketCtor } from "@cline/hub-client";
import { cloudEnv } from "@/config/env";
import type { ConnectionDescriptor } from "./endpoints";
import { createPairedHubWebSocketImpl } from "./hub-pairing-socket";
import { validateManualHubUrl } from "./manual-hub-url";
import { createPairedRelayWebSocketImpl } from "./relay-connection";
import { requestRelayTicket } from "./relay-ticket";

export interface ResolveLocalTransportDeps {
	getAccessToken?: () => Promise<string | null>;
	WebSocketImpl?: WebSocketCtor;
}

export interface LocalTransport {
	authMode: "hub-subprotocol" | "none";
	authToken?: string;
	WebSocketImpl?: WebSocketCtor;
}

/**
 * Resolve the authenticated socket for a saved machine once, in one place.
 * Chat connections and Home's read-only session discovery must use the same
 * credential rules; otherwise a paired machine can work in one surface and
 * mysteriously disappear from the other.
 */
export async function resolveLocalTransport(
	descriptor: ConnectionDescriptor,
	deps: ResolveLocalTransportDeps = {},
): Promise<LocalTransport> {
	if (descriptor.mode !== "local") {
		throw new Error("A local transport requires a local descriptor.");
	}
	if (descriptor.transport === "relay") {
		if (!deps.getAccessToken) {
			throw new Error("Sign in to Cline to connect to your machine.");
		}
		if (!descriptor.relayMachineId) {
			throw new Error("Saved machine pairing is missing its machine id.");
		}
		const getAccessToken = deps.getAccessToken;
		const machineId = descriptor.relayMachineId;
		return {
			authMode: "none",
			WebSocketImpl: createPairedRelayWebSocketImpl(descriptor, () =>
				requestRelayTicket({
					apiBaseUrl: cloudEnv.apiBaseUrl,
					getAccessToken,
					machineId,
					role: "client",
				}),
			),
		};
	}
	if (descriptor.credentialKind === "device-key") {
		return {
			authMode: "none",
			WebSocketImpl: createPairedHubWebSocketImpl(descriptor),
		};
	}
	const validated = validateManualHubUrl(descriptor.url);
	if (!validated.ok) {
		throw new Error(validated.message);
	}
	return {
		authMode: "hub-subprotocol",
		...(descriptor.authToken ? { authToken: descriptor.authToken } : {}),
		...(deps.WebSocketImpl ? { WebSocketImpl: deps.WebSocketImpl } : {}),
	};
}
