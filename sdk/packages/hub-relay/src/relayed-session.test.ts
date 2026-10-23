/**
 * The proof that matters: a REAL `HubClient` drives a REAL hub through the relay,
 * with nothing about either one modified.
 *
 * `createRelayWebSocketImpl` is handed to `HubClient` as its `WebSocketImpl` and
 * that is the entire integration — registration, `session.create`, streaming
 * events and approvals all run over the relayed channel. The mobile app's
 * `SessionConnection` sits above `HubClient`, so if this passes, the app works
 * relayed with zero source changes.
 */

import { HubClient, type HubClientOptions } from "@cline/hub-client";
import {
	acceptDeviceSession,
	acceptPairingOffer,
	createHubPairingSession,
	createInMemoryDeviceStore,
	createPairingOffer,
	createSecureChannel,
	DeviceRegistry,
	generateDeviceKeyPair,
	startDeviceSession,
} from "@cline/hub-pairing";
import { startTestHub, type TestHub } from "@cline/hub-testkit";
import type { HubEventEnvelope } from "@cline/shared";
import { afterEach, describe, expect, it } from "vitest";
import {
	createRelayWebSocketImpl,
	type RelayPayloadCodec,
} from "./client/socket";
import {
	createRelayHostClient,
	type RelayHostClient,
	type RelaySecureHostHandshakeAcceptor,
} from "./host/host-client";
import {
	createRelayServer,
	type RelayServer,
	type RelayServerEvent,
	type VerifyAccount,
} from "./server/server";

const ACCOUNT_TOKEN = "dev-token-account-a";
const OTHER_ACCOUNT_TOKEN = "dev-token-account-b";

const verifyAccount: VerifyAccount = ({ token }) => {
	if (token === ACCOUNT_TOKEN) {
		return { accountId: "acct_a" };
	}
	if (token === OTHER_ACCOUNT_TOKEN) {
		return { accountId: "acct_b" };
	}
	return undefined;
};

const TURN = {
	steps: [
		{ kind: "text" as const, chunks: ["Relayed ", "and ", "streaming."] },
		{ kind: "usage" as const, inputTokens: 12, outputTokens: 5, cost: 0.0001 },
	],
	finishReason: "completed" as const,
};

function secureCodecPair(): {
	host: RelayPayloadCodec;
	device: RelayPayloadCodec;
} {
	const deviceToHub = new Uint8Array(32).fill(0x41);
	const hubToDevice = new Uint8Array(32).fill(0x72);
	const hostChannel = createSecureChannel({
		role: "hub",
		sendKey: hubToDevice,
		recvKey: deviceToHub,
		maxPlaintextSize: 256 * 1024,
	});
	const deviceChannel = createSecureChannel({
		role: "device",
		sendKey: deviceToHub,
		recvKey: hubToDevice,
		maxPlaintextSize: 256 * 1024,
	});
	return {
		host: {
			seal: (plaintext) => hostChannel.encryptBytes(plaintext),
			open: (sealed) => hostChannel.decryptBytes(sealed),
		},
		device: {
			seal: (plaintext) => deviceChannel.encryptBytes(plaintext),
			open: (sealed) => deviceChannel.decryptBytes(sealed),
		},
	};
}

function channelCodec(channel: {
	encryptBytes(value: Uint8Array): Uint8Array;
	decryptBytes(value: Uint8Array): Uint8Array;
}): RelayPayloadCodec {
	return {
		seal: (value) => channel.encryptBytes(value),
		open: (value) => channel.decryptBytes(value),
	};
}

const hubs: TestHub[] = [];
const relays: RelayServer[] = [];
const hostClients: RelayHostClient[] = [];
const clients: HubClient[] = [];

afterEach(async () => {
	for (const client of clients.splice(0, clients.length)) {
		client.close();
	}
	for (const host of hostClients.splice(0, hostClients.length)) {
		await host.close();
	}
	for (const relay of relays.splice(0, relays.length)) {
		await relay.close();
	}
	for (const hub of hubs.splice(0, hubs.length)) {
		await hub.close();
	}
});

interface RelayedStack {
	hub: TestHub;
	relay: RelayServer;
	host: RelayHostClient;
	events: RelayServerEvent[];
}

async function startRelayedStack(
	options: {
		payloadCodec?: RelayPayloadCodec;
		secureHandshake?: RelaySecureHostHandshakeAcceptor;
	} = {},
): Promise<RelayedStack> {
	const hub = await startTestHub({ script: TURN });
	hubs.push(hub);
	const events: RelayServerEvent[] = [];
	const relay = await createRelayServer({
		verifyAccount,
		port: 0,
		onEvent: (event) => events.push(event),
	});
	relays.push(relay);
	const host = createRelayHostClient({
		relayUrl: relay.url,
		accountToken: ACCOUNT_TOKEN,
		hubUrl: hub.url,
		hubAuthToken: hub.authToken,
		machineId: "mach_air",
		label: "Example's MacBook Air",
		...(options.payloadCodec ? { payloadCodec: options.payloadCodec } : {}),
		...(options.secureHandshake
			? { secureHandshake: options.secureHandshake }
			: {}),
	});
	hostClients.push(host);
	await host.start();
	return { hub, relay, host, events };
}

function relayedHubClient(
	stack: RelayedStack,
	options: {
		accountToken?: string;
		machineId?: string;
		payloadCodec?: RelayPayloadCodec;
		secureHandshake?: Parameters<
			typeof createRelayWebSocketImpl
		>[0]["secureHandshake"];
		onConnectionState?: HubClientOptions["onConnectionState"];
	} = {},
): HubClient {
	const client = new HubClient({
		...(options.onConnectionState
			? { onConnectionState: options.onConnectionState }
			: {}),
		// Ignored: the relay client socket dials the relay, not this url. `HubClient`
		// still wants one, so name it for what it is.
		url: "ws://relayed.invalid/hub",
		authMode: "none",
		clientType: "cline-mobile",
		displayName: "relayed phone",
		workspaceRoot: stack.hub.runtimeHost.workspaceRoot,
		cwd: stack.hub.runtimeHost.workspaceRoot,
		WebSocketImpl: createRelayWebSocketImpl({
			relayUrl: stack.relay.url,
			accountToken: options.accountToken ?? ACCOUNT_TOKEN,
			machineId: options.machineId ?? "mach_air",
			...(options.payloadCodec ? { payloadCodec: options.payloadCodec } : {}),
			...(options.secureHandshake
				? { secureHandshake: options.secureHandshake }
				: {}),
		}),
	});
	clients.push(client);
	return client;
}

async function createSession(
	client: HubClient,
	stack: RelayedStack,
): Promise<string> {
	const reply = await client.command("session.create", {
		workspaceRoot: stack.hub.runtimeHost.workspaceRoot,
		cwd: stack.hub.runtimeHost.workspaceRoot,
		sessionConfig: {
			providerId: "testkit",
			modelId: "testkit-model",
			cwd: stack.hub.runtimeHost.workspaceRoot,
			workspaceRoot: stack.hub.runtimeHost.workspaceRoot,
			systemPrompt: "testkit",
		},
		metadata: { source: "core", interactive: true },
	});
	const session = reply.payload?.session as { sessionId?: string } | undefined;
	if (!session?.sessionId) {
		throw new Error("session.create returned no session id");
	}
	return session.sessionId;
}

function collectEvents(client: HubClient): {
	events: HubEventEnvelope[];
	waitFor(name: string, timeoutMs?: number): Promise<HubEventEnvelope>;
	unsubscribe(): void;
} {
	const events: HubEventEnvelope[] = [];
	const waiters = new Set<() => void>();
	const unsubscribe = client.subscribe((event) => {
		events.push(event);
		for (const waiter of [...waiters]) {
			waiter();
		}
	});
	return {
		events,
		unsubscribe,
		waitFor: (name, timeoutMs = 15_000) =>
			new Promise<HubEventEnvelope>((resolve, reject) => {
				const timer = setTimeout(() => {
					waiters.delete(check);
					reject(
						new Error(
							`timed out waiting for ${name}; saw [${events.map((event) => event.event).join(", ")}]`,
						),
					);
				}, timeoutMs);
				function check(): void {
					const found = events.find((event) => event.event === name);
					if (!found) {
						return;
					}
					clearTimeout(timer);
					waiters.delete(check);
					resolve(found);
				}
				waiters.add(check);
				check();
			}),
	};
}

describe("a real HubClient driving a real hub through the relay", () => {
	it("registers, creates a session and streams a full turn", async () => {
		const stack = await startRelayedStack();
		const client = relayedHubClient(stack);

		await client.connect();
		expect(client.isConnected()).toBe(true);

		const sessionId = await createSession(client, stack);
		expect(sessionId).toMatch(/\S/);

		const stream = collectEvents(client);
		// A completed round-trip proves the hub processed the subscription.
		await client.command("approval.list_pending", { sessionId }, sessionId);
		await client.command(
			"session.send_input",
			{ sessionId, prompt: "hello from the phone" },
			sessionId,
		);
		await stream.waitFor("run.completed");
		const names = stream.events.map((event) => event.event);
		expect(names).toContain("run.started");
		expect(names).toContain("run.completed");
		stream.unsubscribe();

		// Bytes crossed in both directions, and the relay counted frames only.
		const stats = stack.relay.stats();
		expect(stats.channels).toBe(1);
		expect(stats.framesRelayed).toBeGreaterThan(4);
		const directions = new Set(
			stack.events
				.filter((event) => event.type === "frame")
				.map((event) => (event.type === "frame" ? event.direction : "")),
		);
		expect([...directions].sort()).toEqual(["client->host", "host->client"]);
	});

	it("works identically when payloads are sealed so the relay cannot read them", async () => {
		const codecs = secureCodecPair();
		const stack = await startRelayedStack({ payloadCodec: codecs.host });
		const client = relayedHubClient(stack, { payloadCodec: codecs.device });

		await client.connect();
		const sessionId = await createSession(client, stack);
		const stream = collectEvents(client);
		await client.command("approval.list_pending", { sessionId }, sessionId);
		await client.command(
			"session.send_input",
			{ sessionId, prompt: "sealed prompt: SECRET-MARKER" },
			sessionId,
		);
		await stream.waitFor("run.completed");
		stream.unsubscribe();

		// Nothing recognisable reached the relay's own view of the traffic.
		const serialized = JSON.stringify(stack.events);
		expect(serialized).not.toContain("SECRET-MARKER");
		expect(serialized).not.toContain("session.send_input");
		expect(serialized).not.toContain("run.completed");
	});

	it("pairs with Noise before open, then reconnects from the device allowlist", async () => {
		const hubIdentity = generateDeviceKeyPair();
		const deviceIdentity = generateDeviceKeyPair();
		const registry = await DeviceRegistry.open(createInMemoryDeviceStore());
		const now = Date.now();
		const created = createPairingOffer({
			hubPublicKey: hubIdentity.publicKey,
			hubName: "Test machine",
			url: "ws://relay.invalid",
			ttlMs: 60_000,
			now: () => now,
		});
		const hubPairing = createHubPairingSession(
			created.offer,
			hubIdentity.privateKey,
			{ now: () => now },
		);
		const acceptor: RelaySecureHostHandshakeAcceptor = {
			async accept(input) {
				if (input.kind === "pairing") {
					const completed = hubPairing.complete({
						version: 1,
						offerId: input.offerId ?? "",
						message: input.message,
					});
					await registry.add({
						publicKey: completed.device.publicKey,
						label: completed.device.label,
					});
					return {
						response: completed.response.message,
						payloadCodec: channelCodec(completed.channel),
					};
				}
				const accepted = acceptDeviceSession({
					hubPrivateKey: hubIdentity.privateKey,
					registry,
					message: input.message,
				});
				return {
					response: accepted.message,
					payloadCodec: channelCodec(accepted.channel),
					release: accepted.release,
				};
			},
		};
		const stack = await startRelayedStack({ secureHandshake: acceptor });
		const pendingPairing = acceptPairingOffer(
			created.offer,
			deviceIdentity.privateKey,
			{ now: () => now, metadata: { label: "Test phone" } },
		);
		const first = relayedHubClient(stack, {
			secureHandshake: {
				kind: "pairing",
				offerId: created.offer.offerId,
				message: pendingPairing.attestation.message,
				complete: (response) =>
					channelCodec(pendingPairing.complete(response).channel),
			},
		});
		await first.connect();
		const sessionId = await createSession(first, stack);
		first.close();

		const reconnect = startDeviceSession({
			devicePrivateKey: deviceIdentity.privateKey,
			hubPublicKey: hubIdentity.publicKey,
		});
		const second = relayedHubClient(stack, {
			secureHandshake: {
				kind: "session",
				message: reconnect.message,
				complete: (response) =>
					channelCodec(reconnect.complete(response).channel),
			},
		});
		await second.connect();
		const listed = await second.command("session.list", {});
		expect(
			((listed.payload?.sessions ?? []) as { sessionId: string }[]).map(
				(session) => session.sessionId,
			),
		).toContain(sessionId);
		expect(JSON.stringify(stack.events)).not.toContain("session.list");
	});

	it("resolves 'newest' so a phone needs no machine id at all", async () => {
		const stack = await startRelayedStack();
		const client = relayedHubClient(stack, { machineId: undefined });
		await client.connect();
		expect(client.isConnected()).toBe(true);
		expect(await createSession(client, stack)).toMatch(/\S/);
	});

	it("serves two phones against the same hub on separate channels", async () => {
		const stack = await startRelayedStack();
		const first = relayedHubClient(stack);
		const second = relayedHubClient(stack);
		await first.connect();
		await second.connect();
		const sessionId = await createSession(first, stack);

		// The second phone sees the session the first one created: same hub, two
		// independent relay channels.
		const listed = await second.command("session.list", {});
		const sessions = (listed.payload?.sessions ?? []) as {
			sessionId: string;
		}[];
		expect(sessions.map((session) => session.sessionId)).toContain(sessionId);
		expect(stack.relay.stats().channels).toBe(2);
		expect(stack.host.channelCount()).toBe(2);
	});

	it("fails a phone on another account before any hub frame is exchanged", async () => {
		const stack = await startRelayedStack();
		const intruder = relayedHubClient(stack, {
			accountToken: OTHER_ACCOUNT_TOKEN,
		});
		// Machine ids are per-account, so another account's machine simply does not
		// exist for this phone — the same answer an id nobody registered gets.
		await expect(intruder.connect()).rejects.toThrow(/machine_not_found/);
		expect(stack.relay.stats().channels).toBe(0);
		expect(stack.relay.stats().framesRelayed).toBe(0);
		expect(stack.host.channelCount()).toBe(0);
	});

	it("closes the phone's session when the laptop hub goes away", async () => {
		const stack = await startRelayedStack();
		const states: string[] = [];
		let onClosed: (() => void) | undefined;
		const closed = new Promise<void>((resolve) => {
			onClosed = resolve;
		});
		const client = relayedHubClient(stack, {
			onConnectionState: (change) => {
				states.push(change.state);
				if (change.state === "closed" || change.state === "reconnecting") {
					onClosed?.();
				}
			},
		});
		await client.connect();
		await createSession(client, stack);

		await stack.host.close();
		await closed;
		expect(client.isConnected()).toBe(false);
		// The phone learns the machine went away, rather than hanging on a dead
		// socket: the relay tore the channel down (`machine_gone`).
		expect(client.getConnectionError()?.message ?? "").toMatch(/4502|closed/);
	});
});
