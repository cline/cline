import type { WebSocketCtor } from "@cline/hub-client";
import {
	acceptPairingOffer,
	base64UrlToBytes,
	bytesToBase64Url,
	deviceIdFromPublicKey,
	generateDeviceKeyPair,
	PAIRING_PROTOCOL_VERSION,
	startDeviceSession,
} from "@cline/hub-pairing";
import {
	createRelayClientSocket,
	type RelayPayloadCodec,
	type RelayWebSocketLike,
} from "@cline/hub-relay";
import { cloudAuthStore } from "@/cloud";
import { cloudEnv } from "@/config/env";
import { userErrorMessage } from "@/error-message";
import type { HandoffLink } from "@/state/handoff-link";
import type { ConnectionDescriptor } from "./endpoints";
import { isRelayHandoffUrl, pairHubHandoffLink } from "./hub-pairing-socket";
import { requestRelayTicket } from "./relay-ticket";

const DEVICE_KEY_STORAGE = "cline.mobile.deviceIdentity.v1";
const PAIRING_TIMEOUT_MS = 15_000;

function channelCodec(channel: {
	encryptBytes(value: Uint8Array): Uint8Array;
	decryptBytes(value: Uint8Array): Uint8Array;
}): RelayPayloadCodec {
	return {
		seal: (value) => channel.encryptBytes(value),
		open: (value) => channel.decryptBytes(value),
	};
}

async function loadDevicePrivateKey(): Promise<Uint8Array> {
	const SecureStore = await import("expo-secure-store");
	const stored = await SecureStore.getItemAsync(DEVICE_KEY_STORAGE);
	if (stored) {
		return base64UrlToBytes(stored);
	}
	const identity = generateDeviceKeyPair();
	await SecureStore.setItemAsync(
		DEVICE_KEY_STORAGE,
		bytesToBase64Url(identity.privateKey),
	);
	return identity.privateKey;
}

/**
 * Pair whichever way the link says.
 *
 * A link addressed to the account relay goes through the relay (and needs a
 * signed-in account). Anything else is a machine's own hub address, which pairs
 * directly against it — no account, no relay hop. The machine decides which link
 * it printed; the phone does not guess or fall back between them, because a
 * silent fallback would turn "wrong network" into a confusing auth error.
 */
export async function pairHandoffLink(
	link: HandoffLink,
): Promise<ConnectionDescriptor> {
	return isRelayHandoffUrl(link.url)
		? await pairRelayHandoffLink(link)
		: await pairHubHandoffLink(link);
}

export async function pairRelayHandoffLink(
	link: HandoffLink,
): Promise<ConnectionDescriptor> {
	const accessToken = await cloudAuthStore.getValidAccessToken();
	if (!accessToken) {
		throw new Error("Sign in to Cline before pairing this machine.");
	}
	const devicePrivateKey = await loadDevicePrivateKey();
	const pending = acceptPairingOffer(
		{
			version: PAIRING_PROTOCOL_VERSION,
			offerId: link.offerId,
			hubPublicKey: link.hubPublicKey,
			hubName: link.machineName,
			url: link.url,
			oneTimeSecret: link.oneTimeSecret,
			expiresAt: link.expiresAt,
			...(link.hubSessionId ? { sessionId: link.hubSessionId } : {}),
		},
		devicePrivateKey,
		{ metadata: { label: "Cline mobile", platform: "mobile" } },
	);
	const machineId = deviceIdFromPublicKey(link.hubPublicKey);
	const relayTicket = await requestRelayTicket({
		apiBaseUrl: cloudEnv.apiBaseUrl,
		getAccessToken: () => Promise.resolve(accessToken),
		machineId,
		role: "client",
	});
	const socket = createRelayClientSocket({
		relayUrl: link.url,
		accountToken: relayTicket,
		machineId,
		authMode: "bearer-header",
		secureHandshake: {
			kind: "pairing",
			offerId: link.offerId,
			message: pending.attestation.message,
			complete(response) {
				return channelCodec(pending.complete(response).channel);
			},
		},
	});
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			socket.close();
			reject(new Error("Pairing timed out. Run /handoff again and retry."));
		}, PAIRING_TIMEOUT_MS);
		socket.addEventListener("open", () => {
			clearTimeout(timer);
			resolve();
		});
		socket.addEventListener("error", (event: unknown) => {
			clearTimeout(timer);
			socket.close();
			const message =
				(event as { message?: string } | undefined)?.message ??
				"The secure pairing handshake failed.";
			reject(new Error(message));
		});
	});
	socket.close(1000, "pairing complete");
	return {
		mode: "local",
		transport: "relay",
		credentialKind: "device-key",
		url: link.url,
		label: link.machineName,
		relayMachineId: machineId,
		hubPublicKey: bytesToBase64Url(link.hubPublicKey),
		devicePrivateKey: bytesToBase64Url(devicePrivateKey),
		...(link.hubSessionId ? { hubSessionId: link.hubSessionId } : {}),
	};
}

export function createPairedRelayWebSocketImpl(
	descriptor: ConnectionDescriptor,
	getRelayTicket: () => Promise<string>,
): WebSocketCtor {
	if (
		descriptor.transport !== "relay" ||
		!descriptor.relayMachineId ||
		!descriptor.hubPublicKey ||
		!descriptor.devicePrivateKey
	) {
		throw new Error("Saved machine pairing is incomplete. Pair it again.");
	}
	const devicePrivateKey = base64UrlToBytes(descriptor.devicePrivateKey);
	const hubPublicKey = base64UrlToBytes(descriptor.hubPublicKey);
	class PairedRelayWebSocket implements RelayWebSocketLike {
		private socket: RelayWebSocketLike | undefined;
		private readyStateValue = 0;
		private closed = false;
		private readonly listeners = new Map<
			string,
			Set<(...args: unknown[]) => void>
		>();

		constructor() {
			void this.connect();
		}

		private emit(type: string, event: unknown): void {
			for (const listener of [...(this.listeners.get(type) ?? [])]) {
				listener(event);
			}
		}

		private async connect(): Promise<void> {
			try {
				// A reconnect gets both a fresh one-use account ticket and fresh Noise
				// transport keys. Reusing either after a drop is deliberately refused.
				const relayTicket = await getRelayTicket();
				if (this.closed) return;
				const pending = startDeviceSession({ devicePrivateKey, hubPublicKey });
				const socket = createRelayClientSocket({
					relayUrl: descriptor.url,
					accountToken: relayTicket,
					machineId: descriptor.relayMachineId,
					authMode: "bearer-header",
					secureHandshake: {
						kind: "session",
						message: pending.message,
						complete: (response) =>
							channelCodec(pending.complete(response).channel),
					},
				});
				this.socket = socket;
				for (const type of ["open", "message", "error", "close"] as const) {
					socket.addEventListener(type, (event: unknown) => {
						this.readyStateValue = socket.readyState;
						this.emit(type, event);
					});
				}
			} catch (error) {
				if (this.closed) return;
				this.readyStateValue = 3;
				const message = userErrorMessage(error, "Relay authorization failed.");
				this.emit("error", { type: "error", message, error });
				this.emit("close", {
					type: "close",
					code: 4401,
					reason: message,
					wasClean: false,
				});
			}
		}

		get readyState(): number {
			return this.socket?.readyState ?? this.readyStateValue;
		}

		send(data: string): void {
			if (!this.socket || this.socket.readyState !== 1) {
				throw new Error("Relay connection is not open yet.");
			}
			this.socket.send(data);
		}

		close(_code?: number, _reason?: string): void {
			this.closed = true;
			this.readyStateValue = 3;
			this.socket?.close();
		}

		addEventListener(
			type: string,
			listener: (...args: unknown[]) => void,
		): void {
			const existing = this.listeners.get(type);
			if (existing) existing.add(listener);
			else this.listeners.set(type, new Set([listener]));
		}
	}
	return PairedRelayWebSocket as unknown as WebSocketCtor;
}
