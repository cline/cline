/**
 * Pairing with, and reconnecting to, a machine's own hub — no relay, no account.
 *
 * This is the path a `clinecode://handoff` link takes when the machine put its
 * own websocket address in the link (the default). The phone:
 *
 *   1. loads (or generates once) its device X25519 key from SecureStore,
 *   2. opens `cline-hub-pair.v2.<offerId>` against the hub and runs enrollment
 *      handshake, pinning the hub's static key from the reply,
 *   3. saves a `device-key` descriptor — no token, nothing that expires,
 *   4. from then on connects with `cline-hub-device.v2`, which the machine can
 *      revoke.
 *
 * The wire contract lives in `@cline/hub-pairing`'s `transport.ts` and is shared
 * with the hub server, so neither end can drift from the other.
 *
 * The Noise transport keys seal every hub frame after the handshake, so LAN
 * peers see neither transcripts nor tool inputs and cannot replay or reorder
 * traffic undetected.
 */

import type { WebSocketCtor, WebSocketLike } from "@cline/hub-client";
import {
	acceptPairingOffer,
	base64UrlToBytes,
	bytesToBase64Url,
	bytesToUtf8,
	decodeDeviceOkFrame,
	decodePairOkFrame,
	decodeSecureDataFrame,
	encodeDeviceBeginFrame,
	encodePairAttestFrame,
	encodeSecureDataFrame,
	FRAME_HEADER_LENGTH,
	generateDeviceKeyPair,
	HUB_DEVICE_SUBPROTOCOL,
	HUB_HANDSHAKE_MAX_WIRE_BYTES,
	HUB_PAIR_SUBPROTOCOL_PREFIX,
	maxEncodedSecureDataFrameBytes,
	PAIRING_PROTOCOL_VERSION,
	readHandshakeErrorFrame,
	type SecureChannel,
	startDeviceSession,
	utf8ToBytes,
} from "@cline/hub-pairing";
import { HUB_MAX_FRAME_BYTES } from "@cline/shared";
import { env } from "@/config/env";
import type { HandoffLink } from "@/state/handoff-link";
import type { ConnectionDescriptor } from "./endpoints";

const DEVICE_KEY_STORAGE = "cline.mobile.deviceIdentity.v1";
const PAIRING_TIMEOUT_MS = 15_000;
const SECURE_FRAME_MAX_WIRE_BYTES = maxEncodedSecureDataFrameBytes(
	HUB_MAX_FRAME_BYTES + FRAME_HEADER_LENGTH + 16,
);

/** The label and platform the machine records for this device. */
const DEVICE_METADATA = {
	label: "Cline mobile",
	platform: "mobile",
} as const;

/**
 * True when a handoff link points at the account relay rather than at a machine.
 *
 * Decided by origin against the build's own session host, because that is the
 * only address the relay is ever served from. Anything else is a machine's hub —
 * including a LAN address, which is the common case for `/handoff`.
 */
export function isRelayHandoffUrl(url: string): boolean {
	try {
		return new URL(url).origin === new URL(env.sessionBaseUrl).origin;
	} catch {
		return false;
	}
}

/** `http(s)` in a link becomes `ws(s)` for the socket. */
export function toWebSocketUrl(url: string): string {
	return url.replace(/^http(s?):\/\//i, "ws$1://");
}

async function loadDevicePrivateKey(): Promise<Uint8Array> {
	const SecureStore = await import("expo-secure-store");
	const stored = await SecureStore.getItemAsync(DEVICE_KEY_STORAGE);
	if (stored) {
		return base64UrlToBytes(stored);
	}
	// Generated exactly once per install: rotating it would orphan every machine
	// this device is enrolled with, and each would need re-pairing.
	const identity = generateDeviceKeyPair();
	await SecureStore.setItemAsync(
		DEVICE_KEY_STORAGE,
		bytesToBase64Url(identity.privateKey),
	);
	return identity.privateKey;
}

/** Injected in tests so no `expo-secure-store` (or real socket) is needed. */
export interface HubPairingDeps {
	readonly loadDevicePrivateKey?: () => Promise<Uint8Array>;
	readonly WebSocketImpl?: WebSocketCtor;
}

function resolveWebSocketCtor(impl?: WebSocketCtor): WebSocketCtor {
	const ctor =
		impl ??
		(globalThis as { WebSocket?: WebSocketCtor }).WebSocket ??
		undefined;
	if (!ctor) {
		throw new Error("This device has no WebSocket implementation.");
	}
	return ctor;
}

function frameText(event: unknown): string {
	const data = (event as { data?: unknown })?.data ?? event;
	if (typeof data === "string") {
		return data;
	}
	if (data instanceof Uint8Array) {
		return new TextDecoder().decode(data);
	}
	return String(data);
}

/** Refuse unauthenticated input before JSON/base64/Noise decoding. */
function handshakeFrameText(event: unknown): string {
	const text = frameText(event);
	if (text.length > HUB_HANDSHAKE_MAX_WIRE_BYTES) {
		throw new Error("The machine sent an oversized pairing response.");
	}
	return text;
}

/**
 * Runs the enrollment handshake against the machine's hub and returns the saved
 * connection it produced.
 *
 * The socket is closed as soon as pairing completes: the row it returns
 * authenticates on its own from then on, so the very next connect already
 * exercises the returning-device path rather than leaving a special first
 * session behind.
 */
export async function pairHubHandoffLink(
	link: HandoffLink,
	deps: HubPairingDeps = {},
): Promise<ConnectionDescriptor> {
	const devicePrivateKey = await (
		deps.loadDevicePrivateKey ?? loadDevicePrivateKey
	)();
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
		{ metadata: DEVICE_METADATA, maxPlaintextSize: HUB_MAX_FRAME_BYTES },
	);

	const Ctor = resolveWebSocketCtor(deps.WebSocketImpl);
	const socket = new Ctor(toWebSocketUrl(link.url), [
		`${HUB_PAIR_SUBPROTOCOL_PREFIX}${link.offerId}`,
	]);

	try {
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				reject(new Error("Pairing timed out. Run /handoff again and retry."));
			}, PAIRING_TIMEOUT_MS);
			const settle = (error?: Error): void => {
				clearTimeout(timer);
				if (error) {
					reject(error);
				} else {
					resolve();
				}
			};
			socket.addEventListener("open", () => {
				socket.send(
					encodePairAttestFrame({
						offerId: link.offerId,
						message: pending.attestation.message,
					}),
				);
			});
			socket.addEventListener("message", (event: unknown) => {
				let text: string;
				try {
					text = handshakeFrameText(event);
				} catch (error) {
					socket.close();
					settle(
						error instanceof Error
							? error
							: new Error("The machine sent an invalid pairing response."),
					);
					return;
				}
				const refusal = readHandshakeErrorFrame(text);
				if (refusal) {
					// The hub already phrased this for a person; passing it through beats
					// re-deriving a message from a code the app does not own.
					settle(new Error(refusal.message));
					return;
				}
				try {
					const ok = decodePairOkFrame(text);
					// Completing here is what pins the hub key: a machine answering with a
					// different static key cannot get past this.
					const completed = pending.complete({
						// The frame codec already validated transport v2; the Noise pairing
						// transcript remains pairing protocol v1.
						version: PAIRING_PROTOCOL_VERSION,
						offerId: ok.offerId,
						message: ok.message,
					});
					completed.channel.close();
					settle();
				} catch (error) {
					settle(
						error instanceof Error
							? error
							: new Error("The secure pairing handshake failed."),
					);
				}
			});
			socket.addEventListener("close", () => {
				settle(
					new Error(
						"That computer closed the connection before pairing finished. Run /handoff again and retry.",
					),
				);
			});
			socket.addEventListener("error", (event: unknown) => {
				settle(
					new Error(
						(event as { message?: string } | undefined)?.message ??
							"Could not reach that computer. Check that you are on the same network.",
					),
				);
			});
		});
	} finally {
		socket.close();
	}

	return {
		mode: "local",
		transport: "direct",
		credentialKind: "device-key",
		url: toWebSocketUrl(link.url),
		label: link.machineName,
		hubPublicKey: bytesToBase64Url(link.hubPublicKey),
		devicePrivateKey: bytesToBase64Url(devicePrivateKey),
		...(link.hubSessionId ? { hubSessionId: link.hubSessionId } : {}),
	};
}

/**
 * A `WebSocketCtor` that completes the returning-device handshake before it
 * reports itself open.
 *
 * `HubClient` starts talking on `open`, so the handshake has to finish first —
 * hence `readyState` staying `CONNECTING` and `open` being withheld until the
 * hub has accepted the device. Refusals (a revoked device, an unknown key)
 * surface as an `error` carrying the hub's own sentence.
 */
export function createPairedHubWebSocketImpl(
	descriptor: ConnectionDescriptor,
	deps: HubPairingDeps = {},
): WebSocketCtor {
	if (!descriptor.hubPublicKey || !descriptor.devicePrivateKey) {
		throw new Error("Saved machine pairing is incomplete. Pair it again.");
	}
	const devicePrivateKey = base64UrlToBytes(descriptor.devicePrivateKey);
	const hubPublicKey = base64UrlToBytes(descriptor.hubPublicKey);
	const Ctor = resolveWebSocketCtor(deps.WebSocketImpl);

	class PairedHubWebSocket implements WebSocketLike {
		private readonly socket: WebSocketLike;
		private readonly listeners = new Map<
			string,
			Set<(...args: unknown[]) => void>
		>();
		private handshakeComplete = false;
		private channel: SecureChannel | undefined;

		constructor(url: string) {
			// Every connect is a fresh Noise IK exchange. Reusing message 1 would both
			// repeat transport keys and trip the machine's replay guard.
			const pending = startDeviceSession(
				{ devicePrivateKey, hubPublicKey },
				{ maxPlaintextSize: HUB_MAX_FRAME_BYTES },
			);
			this.socket = new Ctor(toWebSocketUrl(url || descriptor.url), [
				HUB_DEVICE_SUBPROTOCOL,
			]);
			this.socket.addEventListener("open", () => {
				this.socket.send(encodeDeviceBeginFrame({ message: pending.message }));
			});
			this.socket.addEventListener("message", (event: unknown) => {
				if (this.handshakeComplete) {
					try {
						const channel = this.channel;
						if (!channel) throw new Error("Secure channel is unavailable.");
						const text = frameText(event);
						if (text.length > SECURE_FRAME_MAX_WIRE_BYTES) {
							throw new Error("Encrypted hub frame exceeds the size limit.");
						}
						const plaintext = bytesToUtf8(
							channel.decryptBytes(decodeSecureDataFrame(text).data),
						);
						this.emit("message", { data: plaintext });
					} catch (error) {
						this.emit("error", {
							message:
								error instanceof Error
									? error.message
									: "An encrypted hub frame was invalid.",
						});
						this.close();
					}
					return;
				}
				let text: string;
				try {
					text = handshakeFrameText(event);
				} catch (error) {
					this.emit("error", {
						message:
							error instanceof Error
								? error.message
								: "The machine sent an invalid pairing response.",
					});
					this.socket.close();
					return;
				}
				const refusal = readHandshakeErrorFrame(text);
				if (refusal) {
					this.emit("error", { message: refusal.message });
					this.socket.close();
					return;
				}
				try {
					const ok = decodeDeviceOkFrame(text);
					this.channel = pending.complete(ok.message).channel;
				} catch (error) {
					this.emit("error", {
						message:
							error instanceof Error
								? error.message
								: "The secure handshake failed.",
					});
					this.socket.close();
					return;
				}
				this.handshakeComplete = true;
				// Only now does the hub protocol begin, which is what `HubClient` waits
				// for.
				this.emit("open", {});
			});
			this.socket.addEventListener("close", (event: unknown) => {
				this.channel?.close();
				this.channel = undefined;
				this.emit("close", event);
			});
			this.socket.addEventListener("error", (event: unknown) => {
				this.emit("error", event);
			});
		}

		private emit(type: string, event: unknown): void {
			for (const listener of [...(this.listeners.get(type) ?? [])]) {
				listener(event);
			}
		}

		get readyState(): number {
			// CONNECTING until authenticated, so nothing is sent before the hub would
			// accept it.
			return this.handshakeComplete ? this.socket.readyState : 0;
		}

		send(data: string): void {
			const channel = this.channel;
			if (!this.handshakeComplete || !channel) {
				throw new Error("The secure hub handshake is not complete.");
			}
			try {
				this.socket.send(
					encodeSecureDataFrame(channel.encryptBytes(utf8ToBytes(data))),
				);
			} catch (error) {
				// Encryption advanced the send counter; this channel cannot safely retry
				// the same logical frame after a socket-level send failure.
				this.close();
				throw error;
			}
		}

		close(): void {
			this.channel?.close();
			this.channel = undefined;
			this.socket.close();
		}

		addEventListener(
			type: string,
			listener: (...args: unknown[]) => void,
		): void {
			const existing = this.listeners.get(type);
			if (existing) {
				existing.add(listener);
				return;
			}
			this.listeners.set(type, new Set([listener]));
		}
	}
	return PairedHubWebSocket as unknown as WebSocketCtor;
}
