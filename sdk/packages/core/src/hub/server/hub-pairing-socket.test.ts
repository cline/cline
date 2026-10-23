/**
 * The pairing handshake driven over a REAL hub websocket, the way the phone does
 * it: a `ws` client, the published subprotocols, and the same frame codecs the
 * app imports from `@cline/hub-pairing`.
 *
 * Nothing here is a stub — `startHubWebSocketServer` is the production server and
 * the only thing pointed somewhere else is the pairing directory. The point of
 * these tests is the boundary between "the socket is open" and "the socket may
 * issue hub commands", which the unit tests around the authority cannot see.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	acceptPairingOffer,
	bytesToUtf8,
	createPairingOffer,
	decodeDeviceOkFrame,
	decodePairOkFrame,
	decodeSecureDataFrame,
	encodeDeviceBeginFrame,
	encodePairAttestFrame,
	encodeSecureDataFrame,
	generateDeviceKeyPair,
	HUB_DEVICE_SUBPROTOCOL,
	HUB_HANDSHAKE_MAX_WIRE_BYTES,
	HUB_PAIR_SUBPROTOCOL_PREFIX,
	PAIRING_PROTOCOL_VERSION,
	type PairingOffer,
	readHandshakeErrorFrame,
	type SecureChannel,
	startDeviceSession,
	utf8ToBytes,
} from "@cline/hub-pairing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { createLocalHubScheduleRuntimeHandlers } from "../daemon/runtime-handlers";
import { createInMemoryHubOwnerContext } from "../discovery";
import {
	type HubPairingAuthority,
	loadOrCreateHubIdentity,
	openDeviceRegistry,
	writePairingOffer,
} from "../pairing";
import { type HubWebSocketServer, startHubWebSocketServer } from "../server";

const TIMEOUT_MS = 8_000;

let pairingDir: string;
let server: HubWebSocketServer | undefined;
const openSockets: WebSocket[] = [];

const identityPath = () => join(pairingDir, "identity.json");
const devicesPath = () => join(pairingDir, "devices.json");
const offersDir = () => join(pairingDir, "offers");

async function startServer(
	options: { pairing?: HubPairingAuthority } = {},
): Promise<HubWebSocketServer> {
	pairingDir = await mkdtemp(join(tmpdir(), "cline-hub-pair-socket-"));
	server = await startHubWebSocketServer({
		owner: createInMemoryHubOwnerContext(),
		host: "127.0.0.1",
		port: 0,
		pathname: "/hub",
		runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
		scheduleOptions: { dbPath: ":memory:" },
		pairingDir,
		...(options.pairing ? { pairing: options.pairing } : {}),
	});
	return server;
}

afterEach(async () => {
	for (const socket of openSockets.splice(0)) {
		socket.close();
	}
	await server?.close();
	server = undefined;
	await rm(pairingDir, { recursive: true, force: true });
});

function connect(
	url: string,
	protocol: string,
	options?: { origin?: string },
): WebSocket {
	const socket = new WebSocket(url, protocol, options);
	openSockets.push(socket);
	return socket;
}

/**
 * The Origin a React Native client puts on its own upgrade. RN derives it from
 * the socket URL, so a phone talking to a loopback hub arrives carrying an origin
 * the hub recognises as local — see the regression tests at the bottom of this
 * file for why that matters.
 */
function loopbackOriginFor(url: string): string {
	const parsed = new URL(url);
	return `http://${parsed.host}`;
}

/** The next text frame, or a rejection when the hub closes first. */
function nextFrame(socket: WebSocket): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error("timed out waiting for a frame")),
			TIMEOUT_MS,
		);
		socket.once("message", (data) => {
			clearTimeout(timer);
			resolve(String(data));
		});
		socket.once("close", () => {
			clearTimeout(timer);
			reject(new Error("socket closed before replying"));
		});
		socket.once("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
	});
}

function closeCode(socket: WebSocket): Promise<number> {
	return new Promise<number>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error("timed out waiting for the close")),
			TIMEOUT_MS,
		);
		socket.once("close", (code) => {
			clearTimeout(timer);
			resolve(code);
		});
	});
}

async function publishOffer(
	ttlMs = 120_000,
	sessionId?: string,
): Promise<PairingOffer> {
	const identity = await loadOrCreateHubIdentity(identityPath());
	const created = createPairingOffer({
		hubPublicKey: identity.publicKey,
		hubName: "Examples MacBook Pro",
		url: "ws://127.0.0.1:0/hub",
		ttlMs,
		...(sessionId ? { sessionId } : {}),
	});
	await writePairingOffer(created.offer, offersDir());
	return created.offer;
}

/**
 * One `client.register` on an already-open socket. This is the real question:
 * does the hub treat the socket as authenticated after the handshake?
 */
async function registerOverSocket(
	socket: WebSocket,
	channel?: SecureChannel,
	displayName = "Paired phone",
): Promise<Record<string, unknown>> {
	const requestId = `hubreq_${Math.random().toString(36).slice(2)}`;
	const reply = nextFrame(socket);
	const command = JSON.stringify({
		kind: "command",
		envelope: {
			version: "v1",
			command: "client.register",
			requestId,
			clientId: "paired-device",
			payload: {
				clientId: "paired-device",
				clientType: "cline-mobile",
				displayName,
				transport: "native",
				actorKind: "client",
			},
		},
	});
	socket.send(
		channel
			? encodeSecureDataFrame(channel.encryptBytes(utf8ToBytes(command)))
			: command,
	);
	const wireReply = await reply;
	const plaintext = channel
		? bytesToUtf8(channel.decryptBytes(decodeSecureDataFrame(wireReply).data))
		: wireReply;
	return JSON.parse(plaintext) as Record<string, unknown>;
}

async function pairOverSocket(
	url: string,
	offer: PairingOffer,
	devicePrivateKey: Uint8Array,
	options?: { origin?: string },
): Promise<{
	socket: WebSocket;
	ok: ReturnType<typeof decodePairOkFrame>;
	channel: SecureChannel;
}> {
	const pending = acceptPairingOffer(offer, devicePrivateKey);
	const socket = connect(
		url,
		`${HUB_PAIR_SUBPROTOCOL_PREFIX}${offer.offerId}`,
		options,
	);
	await new Promise<void>((resolve, reject) => {
		socket.once("open", () => resolve());
		socket.once("error", reject);
	});
	const reply = nextFrame(socket);
	socket.send(
		encodePairAttestFrame({
			offerId: offer.offerId,
			message: pending.attestation.message,
		}),
	);
	const ok = decodePairOkFrame(await reply);
	// The device only trusts the hub after completing its half against the reply.
	const finished = pending.complete({
		version: PAIRING_PROTOCOL_VERSION,
		offerId: ok.offerId,
		message: ok.message,
	});
	expect(finished.hub.publicKey).toEqual(offer.hubPublicKey);
	return { socket, ok, channel: finished.channel };
}

describe("pairing over the hub websocket", () => {
	it(
		"pairs a phone with the offer secret and leaves the socket authenticated",
		async () => {
			const hub = await startServer();
			const offer = await publishOffer(120_000, "sess_handoff");
			const device = generateDeviceKeyPair();

			const { socket, ok, channel } = await pairOverSocket(
				hub.url,
				offer,
				device.privateKey,
			);
			expect(ok.hubName).toBe("Examples MacBook Pro");
			expect(ok.hubPublicKey).toEqual(offer.hubPublicKey);

			// No token was ever sent on this socket, and it can drive the hub.
			const reply = await registerOverSocket(socket, channel);
			expect(reply.kind).toBe("reply");
			expect(
				(reply.envelope as { error?: unknown } | undefined)?.error,
			).toBeUndefined();
		},
		TIMEOUT_MS * 2,
	);

	it(
		"lets the paired device reconnect with no token and no second QR",
		async () => {
			const hub = await startServer();
			const offer = await publishOffer();
			const device = generateDeviceKeyPair();
			const { socket: first } = await pairOverSocket(
				hub.url,
				offer,
				device.privateKey,
			);
			first.close();

			const session = startDeviceSession({
				devicePrivateKey: device.privateKey,
				hubPublicKey: offer.hubPublicKey,
			});
			const socket = connect(hub.url, HUB_DEVICE_SUBPROTOCOL);
			await new Promise<void>((resolve, reject) => {
				socket.once("open", () => resolve());
				socket.once("error", reject);
			});
			const reply = nextFrame(socket);
			socket.send(encodeDeviceBeginFrame({ message: session.message }));
			const ok = decodeDeviceOkFrame(await reply);
			const completed = session.complete(ok.message);

			const registered = await registerOverSocket(socket, completed.channel);
			expect(registered.kind).toBe("reply");
		},
		TIMEOUT_MS * 2,
	);

	it(
		"closes a paired socket that sends plaintext after the handshake",
		async () => {
			const hub = await startServer();
			const offer = await publishOffer();
			const { socket } = await pairOverSocket(
				hub.url,
				offer,
				generateDeviceKeyPair().privateKey,
			);
			const closed = closeCode(socket);
			socket.send(
				JSON.stringify({
					kind: "command",
					envelope: { version: "v1", command: "session.list" },
				}),
			);
			await expect(closed).resolves.toBeGreaterThanOrEqual(1000);
		},
		TIMEOUT_MS * 2,
	);

	it(
		"allows application-sized frames only after the pairing handshake",
		async () => {
			const hub = await startServer();
			const offer = await publishOffer();
			const { socket, channel } = await pairOverSocket(
				hub.url,
				offer,
				generateDeviceKeyPair().privateKey,
			);
			const reply = await registerOverSocket(
				socket,
				channel,
				// The sealed/base64 wire frame exceeds 64 KiB even though the
				// plaintext remains under the test channel's conservative default.
				"phone-" + "x".repeat(50 * 1024),
			);
			expect(reply.kind).toBe("reply");
		},
		TIMEOUT_MS * 2,
	);

	it(
		"refuses a wrong secret, and the socket never becomes usable",
		async () => {
			const hub = await startServer();
			const offer = await publishOffer();
			const wrong: PairingOffer = {
				...offer,
				oneTimeSecret: new Uint8Array(32).fill(3),
			};
			const pending = acceptPairingOffer(
				wrong,
				generateDeviceKeyPair().privateKey,
			);
			const socket = connect(
				hub.url,
				`${HUB_PAIR_SUBPROTOCOL_PREFIX}${offer.offerId}`,
			);
			await new Promise<void>((resolve, reject) => {
				socket.once("open", () => resolve());
				socket.once("error", reject);
			});
			const reply = nextFrame(socket);
			socket.send(
				encodePairAttestFrame({
					offerId: offer.offerId,
					message: pending.attestation.message,
				}),
			);
			const refusal = readHandshakeErrorFrame(await reply);
			expect(refusal?.code).toBe("attestation_rejected");
			expect(await closeCode(socket)).toBe(1008);

			const registry = await openDeviceRegistry(devicesPath());
			expect(registry.list({ includeRevoked: true })).toHaveLength(0);
		},
		TIMEOUT_MS * 2,
	);

	it(
		"refuses an expired offer on the hub's own clock",
		async () => {
			const hub = await startServer();
			// Minted already dead: the phone's expiry check is bypassed entirely, which
			// is exactly what a hostile client would do.
			const identity = await loadOrCreateHubIdentity(identityPath());
			const created = createPairingOffer({
				hubPublicKey: identity.publicKey,
				hubName: "Examples MacBook Pro",
				url: "ws://127.0.0.1:0/hub",
				ttlMs: 1_000,
				now: () => Date.now() - 60_000,
			});
			await writePairingOffer(created.offer, offersDir());
			const pending = acceptPairingOffer(
				created.offer,
				generateDeviceKeyPair().privateKey,
				{ now: () => created.offer.expiresAt - 1 },
			);
			const socket = connect(
				hub.url,
				`${HUB_PAIR_SUBPROTOCOL_PREFIX}${created.offer.offerId}`,
			);
			await new Promise<void>((resolve, reject) => {
				socket.once("open", () => resolve());
				socket.once("error", reject);
			});
			const reply = nextFrame(socket);
			socket.send(
				encodePairAttestFrame({
					offerId: created.offer.offerId,
					message: pending.attestation.message,
				}),
			);
			expect(readHandshakeErrorFrame(await reply)?.code).toBe("offer_expired");
		},
		TIMEOUT_MS * 2,
	);

	it(
		"refuses a replayed offer",
		async () => {
			const hub = await startServer();
			const offer = await publishOffer();
			const device = generateDeviceKeyPair();
			const { socket: first } = await pairOverSocket(
				hub.url,
				offer,
				device.privateKey,
			);
			first.close();

			const replay = acceptPairingOffer(offer, device.privateKey);
			const socket = connect(
				hub.url,
				`${HUB_PAIR_SUBPROTOCOL_PREFIX}${offer.offerId}`,
			);
			await new Promise<void>((resolve, reject) => {
				socket.once("open", () => resolve());
				socket.once("error", reject);
			});
			const reply = nextFrame(socket);
			socket.send(
				encodePairAttestFrame({
					offerId: offer.offerId,
					message: replay.attestation.message,
				}),
			);
			expect(readHandshakeErrorFrame(await reply)?.code).toBe("offer_consumed");
		},
		TIMEOUT_MS * 2,
	);

	it(
		"refuses a revoked device on reconnect",
		async () => {
			const hub = await startServer();
			const offer = await publishOffer();
			const device = generateDeviceKeyPair();
			const { socket: first, ok } = await pairOverSocket(
				hub.url,
				offer,
				device.privateKey,
			);
			first.close();

			// Revocation as the CLI performs it: another process, same store file.
			const cli = await openDeviceRegistry(devicesPath());
			await cli.revoke(ok.deviceId);

			const session = startDeviceSession({
				devicePrivateKey: device.privateKey,
				hubPublicKey: offer.hubPublicKey,
			});
			const socket = connect(hub.url, HUB_DEVICE_SUBPROTOCOL);
			await new Promise<void>((resolve, reject) => {
				socket.once("open", () => resolve());
				socket.once("error", reject);
			});
			const reply = nextFrame(socket);
			socket.send(encodeDeviceBeginFrame({ message: session.message }));
			expect(readHandshakeErrorFrame(await reply)?.code).toBe("device_revoked");
			expect(await closeCode(socket)).toBe(1008);
		},
		TIMEOUT_MS * 2,
	);

	it(
		"refuses a device that was never paired",
		async () => {
			const hub = await startServer();
			const identity = await loadOrCreateHubIdentity(identityPath());
			const session = startDeviceSession({
				devicePrivateKey: generateDeviceKeyPair().privateKey,
				hubPublicKey: identity.publicKey,
			});
			const socket = connect(hub.url, HUB_DEVICE_SUBPROTOCOL);
			await new Promise<void>((resolve, reject) => {
				socket.once("open", () => resolve());
				socket.once("error", reject);
			});
			const reply = nextFrame(socket);
			socket.send(encodeDeviceBeginFrame({ message: session.message }));
			expect(readHandshakeErrorFrame(await reply)?.code).toBe("device_unknown");
		},
		TIMEOUT_MS * 2,
	);

	it(
		"refuses a socket that presents no handshake at all",
		async () => {
			const hub = await startServer();
			await publishOffer();
			// A socket that upgrades on the pairing subprotocol and then tries to issue
			// hub commands without handshaking must get nowhere.
			const socket = connect(
				hub.url,
				`${HUB_PAIR_SUBPROTOCOL_PREFIX}nosuchoffer`,
			);
			await new Promise<void>((resolve, reject) => {
				socket.once("open", () => resolve());
				socket.once("error", reject);
			});
			const reply = nextFrame(socket);
			socket.send(JSON.stringify({ kind: "command", envelope: {} }));
			const refusal = readHandshakeErrorFrame(await reply);
			// The command frame is read as the handshake frame, and it is not one.
			expect(refusal).toBeDefined();
			expect(await closeCode(socket)).toBe(1008);
		},
		TIMEOUT_MS * 2,
	);

	it(
		"rejects an oversized handshake at the websocket parser boundary",
		async () => {
			const hub = await startServer();
			const socket = connect(
				hub.url,
				`${HUB_PAIR_SUBPROTOCOL_PREFIX}nosuchoffer`,
			);
			await new Promise<void>((resolve, reject) => {
				socket.once("open", () => resolve());
				socket.once("error", reject);
			});
			const closed = closeCode(socket);
			socket.send("x".repeat(HUB_HANDSHAKE_MAX_WIRE_BYTES + 1));
			await expect(closed).resolves.toBe(1009);
		},
		TIMEOUT_MS * 2,
	);

	it(
		"releases authentication state when the socket closes during registry work",
		async () => {
			let markStarted!: () => void;
			let finishAuthentication!: () => void;
			const started = new Promise<void>((resolve) => {
				markStarted = resolve;
			});
			const authenticationMayFinish = new Promise<void>((resolve) => {
				finishAuthentication = resolve;
			});
			const release = vi.fn();
			const authority: HubPairingAuthority = {
				isAvailable: async () => true,
				pair: async () => {
					throw new Error("not used");
				},
				openDeviceSession: async () => {
					markStarted();
					await authenticationMayFinish;
					return {
						response: new Uint8Array([1]),
						deviceId: "device-race",
						label: "Phone",
						fingerprint: "fingerprint",
						approvalPolicy: { read: "ask", write: "ask", execute: "ask" },
						channel: { close: vi.fn() } as never,
						release,
					};
				},
				close: async () => {},
			};
			const hub = await startServer({ pairing: authority });
			const socket = connect(hub.url, HUB_DEVICE_SUBPROTOCOL);
			await new Promise<void>((resolve, reject) => {
				socket.once("open", () => resolve());
				socket.once("error", reject);
			});
			socket.send(encodeDeviceBeginFrame({ message: new Uint8Array([1]) }));
			await started;
			const closed = closeCode(socket);
			socket.close();
			await closed;
			finishAuthentication();
			await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1));
		},
		TIMEOUT_MS * 2,
	);

	it(
		"still authenticates the token path (regression)",
		async () => {
			const hub = await startServer();
			const socket = connect(hub.url, `cline-hub-auth.${hub.authToken}`);
			await new Promise<void>((resolve, reject) => {
				socket.once("open", () => resolve());
				socket.once("error", reject);
			});
			const reply = await registerOverSocket(socket);
			expect(reply.kind).toBe("reply");
			expect(
				(reply.envelope as { error?: unknown } | undefined)?.error,
			).toBeUndefined();
		},
		TIMEOUT_MS * 2,
	);

	it(
		"still refuses a socket with neither a token nor a pairing subprotocol (regression)",
		async () => {
			const hub = await startServer();
			const socket = new WebSocket(hub.url);
			openSockets.push(socket);
			await expect(
				new Promise<void>((resolve, reject) => {
					socket.once("open", () => resolve());
					socket.once("error", reject);
				}),
			).rejects.toThrow(/401/);
		},
		TIMEOUT_MS * 2,
	);
});

/**
 * A loopback hub authorizes a socket that merely *arrives from* a loopback origin,
 * because a browser tab on this machine is already the owning user. React Native
 * sets `Origin` from the socket URL, so a phone dialing a loopback hub trips that
 * shortcut — and the shortcut used to win over the pairing subprotocol the same
 * socket asked for. The socket was attached to the plain JSON transport, the Noise
 * handshake never ran, and the device's first frame died as
 * "frame is missing a known `kind`" while the phone sat on "Pairing timed out".
 *
 * Every other test in this file connects with `ws`, which sends no Origin at all,
 * which is exactly why this went unnoticed. An explicit request to prove yourself
 * must beat any shortcut that would have skipped the proof.
 */
describe("pairing from a client that sends a loopback Origin", () => {
	it(
		"runs the pairing handshake instead of short-circuiting on the origin",
		async () => {
			const hub = await startServer();
			const offer = await publishOffer(120_000, "sess_handoff");
			const device = generateDeviceKeyPair();

			const { socket, ok, channel } = await pairOverSocket(
				hub.url,
				offer,
				device.privateKey,
				{ origin: loopbackOriginFor(hub.url) },
			);
			expect(ok.hubPublicKey).toEqual(offer.hubPublicKey);

			const reply = await registerOverSocket(socket, channel);
			expect(
				(reply.envelope as { error?: unknown } | undefined)?.error,
			).toBeUndefined();
		},
		TIMEOUT_MS * 2,
	);

	it(
		"runs the device handshake on reconnect from a loopback origin",
		async () => {
			const hub = await startServer();
			const offer = await publishOffer();
			const device = generateDeviceKeyPair();
			const { socket: first } = await pairOverSocket(
				hub.url,
				offer,
				device.privateKey,
				{ origin: loopbackOriginFor(hub.url) },
			);
			first.close();

			const session = startDeviceSession({
				devicePrivateKey: device.privateKey,
				hubPublicKey: offer.hubPublicKey,
			});
			const socket = connect(hub.url, HUB_DEVICE_SUBPROTOCOL, {
				origin: loopbackOriginFor(hub.url),
			});
			await new Promise<void>((resolve, reject) => {
				socket.once("open", () => resolve());
				socket.once("error", reject);
			});
			const reply = nextFrame(socket);
			socket.send(encodeDeviceBeginFrame({ message: session.message }));
			// The hub answered the handshake rather than rejecting an unknown frame,
			// and the device completes its half against that reply.
			const ok = decodeDeviceOkFrame(await reply);
			const completed = session.complete(ok.message);

			const registered = await registerOverSocket(socket, completed.channel);
			expect(
				(registered.envelope as { error?: unknown } | undefined)?.error,
			).toBeUndefined();
		},
		TIMEOUT_MS * 2,
	);
});
