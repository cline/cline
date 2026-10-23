import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { type WebSocket, WebSocketServer } from "ws";
import {
	base64ToText,
	RELAY_NEWEST_MACHINE,
	textToBase64,
} from "../protocol/index";
import {
	createRelayServer,
	type RelayServer,
	type VerifyAccount,
} from "../server/server";
import { connectRawPeer, type RawRelayPeer } from "../testing/raw-peer";
import { createRelayHostClient, type RelayHostClient } from "./host-client";

const ACCOUNT_TOKEN = "dev-token-account-a";
const HUB_TOKEN = "hub-token-that-never-leaves-the-laptop";

const verifyAccount: VerifyAccount = ({ token }) =>
	token === ACCOUNT_TOKEN ? { accountId: "acct_a" } : undefined;

interface FakeHub {
	url: string;
	/** Auth credentials each accepted upgrade presented. */
	offeredProtocols: string[];
	connections: number;
	close(): Promise<void>;
}

/**
 * A stand-in local hub: echoes `<text>` back as `echo:<text>` and records the
 * subprotocol it was offered, so a test can prove the hub token is injected
 * host-side and never crosses the relay.
 */
async function startFakeHub(): Promise<FakeHub> {
	const offeredProtocols: string[] = [];
	let connections = 0;
	const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
	wss.on("connection", (socket: WebSocket, request) => {
		connections += 1;
		offeredProtocols.push(request.headers["sec-websocket-protocol"] ?? "");
		socket.on("message", (raw: unknown) => {
			socket.send(`echo:${String(raw)}`);
		});
	});
	await new Promise<void>((resolve) => wss.once("listening", () => resolve()));
	const address = wss.address() as AddressInfo;
	return {
		url: `ws://127.0.0.1:${address.port}/hub`,
		offeredProtocols,
		get connections() {
			return connections;
		},
		close: () => new Promise<void>((resolve) => wss.close(() => resolve())),
	};
}

const relays: RelayServer[] = [];
const hosts: RelayHostClient[] = [];
const peers: RawRelayPeer[] = [];
const hubs: FakeHub[] = [];

afterEach(async () => {
	for (const peer of peers.splice(0, peers.length)) {
		peer.close();
	}
	for (const host of hosts.splice(0, hosts.length)) {
		await host.close();
	}
	for (const relay of relays.splice(0, relays.length)) {
		await relay.close();
	}
	for (const hub of hubs.splice(0, hubs.length)) {
		await hub.close();
	}
});

async function startRelay(port = 0): Promise<RelayServer> {
	const relay = await createRelayServer({ verifyAccount, port });
	relays.push(relay);
	return relay;
}

async function connectClient(
	relayUrl: string,
	machineId: string,
): Promise<{ peer: RawRelayPeer; channelId: string }> {
	const peer = await connectRawPeer({
		relayUrl,
		role: "client",
		token: ACCOUNT_TOKEN,
	});
	peers.push(peer);
	peer.send({
		t: "client.connect",
		protocolVersion: "relay-v1",
		machineId,
	});
	const connected = await peer.waitFor("client.connected");
	return { peer, channelId: connected.channelId };
}

describe("relay host client", () => {
	it("refuses to proxy the privileged hub leg beyond loopback", () => {
		for (const hubUrl of [
			"ws://192.168.1.20:4599/hub",
			"wss://hub.example.com/hub",
			"http://127.0.0.1:4599/hub",
		]) {
			expect(() =>
				createRelayHostClient({
					relayUrl: "ws://127.0.0.1:4610",
					accountToken: ACCOUNT_TOKEN,
					hubUrl,
				}),
			).toThrow(/loopback/);
		}

		for (const hubUrl of [
			"ws://localhost:4599/hub",
			"ws://127.42.0.1:4599/hub",
			"wss://[::1]:4599/hub",
		]) {
			const host = createRelayHostClient({
				relayUrl: "ws://127.0.0.1:4610",
				accountToken: ACCOUNT_TOKEN,
				hubUrl,
			});
			hosts.push(host);
		}
	});

	it("registers, then bridges each channel to a fresh local hub socket", async () => {
		const hub = await startFakeHub();
		hubs.push(hub);
		const relay = await startRelay();
		const host = createRelayHostClient({
			relayUrl: relay.url,
			accountToken: ACCOUNT_TOKEN,
			hubUrl: hub.url,
			hubAuthToken: HUB_TOKEN,
			machineId: "mach_air",
			label: "Example's MacBook Air",
		});
		hosts.push(host);
		await host.start();
		expect(host.state()).toBe("registered");
		expect(relay.machinesForAccount("acct_a")[0]).toMatchObject({
			machineId: "mach_air",
			label: "Example's MacBook Air",
		});

		const { peer, channelId } = await connectClient(
			relay.url,
			RELAY_NEWEST_MACHINE,
		);
		peer.send({
			t: "data",
			channelId,
			seq: 1,
			payload: textToBase64('{"kind":"command"}'),
		});
		const reply = await peer.waitFor("data");
		expect(base64ToText(reply.payload)).toBe('echo:{"kind":"command"}');

		// The hub token was injected on the LOCAL leg only.
		expect(hub.offeredProtocols).toEqual([`cline-hub-auth.${HUB_TOKEN}`]);
		expect(host.channelCount()).toBe(1);

		// A second phone gets its own local hub socket, not a shared one.
		const second = await connectClient(relay.url, "mach_air");
		second.peer.send({
			t: "data",
			channelId: second.channelId,
			seq: 1,
			payload: textToBase64("two"),
		});
		expect(base64ToText((await second.peer.waitFor("data")).payload)).toBe(
			"echo:two",
		);
		expect(hub.connections).toBe(2);
		expect(host.channelCount()).toBe(2);
	});

	it("closes the local hub socket when the phone goes away", async () => {
		const hub = await startFakeHub();
		hubs.push(hub);
		const relay = await startRelay();
		const host = createRelayHostClient({
			relayUrl: relay.url,
			accountToken: ACCOUNT_TOKEN,
			hubUrl: hub.url,
			hubAuthToken: HUB_TOKEN,
			machineId: "mach_air",
		});
		hosts.push(host);
		await host.start();
		const { peer } = await connectClient(relay.url, "mach_air");
		expect(host.channelCount()).toBe(1);
		peer.close();
		await waitFor(() => host.channelCount() === 0);
		expect(host.channelCount()).toBe(0);
	});

	it("reconnects with backoff after the relay drops, and serves channels again", async () => {
		const hub = await startFakeHub();
		hubs.push(hub);
		const first = await startRelay();
		const port = first.port;
		const host = createRelayHostClient({
			relayUrl: first.url,
			accountToken: ACCOUNT_TOKEN,
			hubUrl: hub.url,
			hubAuthToken: HUB_TOKEN,
			machineId: "mach_air",
			reconnect: { initialDelayMs: 10, maxDelayMs: 50, jitterRatio: 0 },
		});
		hosts.push(host);
		await host.start();

		await first.close();
		relays.splice(relays.indexOf(first), 1);
		await waitFor(() => host.state() === "reconnecting");
		// Attach the waiter only once it has actually lost the relay, otherwise
		// `waitUntilRegistered` short-circuits on the registration it already had.
		const registeredAgain = host.waitUntilRegistered();

		// Same port, new relay process: what a relay deploy/restart looks like.
		const second = await startRelay(port);
		await registeredAgain;
		expect(host.state()).toBe("registered");
		expect(second.machinesForAccount("acct_a")[0]?.machineId).toBe("mach_air");

		const { peer, channelId } = await connectClient(second.url, "mach_air");
		peer.send({
			t: "data",
			channelId,
			seq: 1,
			payload: textToBase64("after-reconnect"),
		});
		expect(base64ToText((await peer.waitFor("data")).payload)).toBe(
			"echo:after-reconnect",
		);
	});

	it("fetches a fresh scoped credential for every reconnect", async () => {
		const hub = await startFakeHub();
		hubs.push(hub);
		const first = await startRelay();
		const port = first.port;
		let credentialRequests = 0;
		const host = createRelayHostClient({
			relayUrl: first.url,
			getAccountToken: async () => {
				credentialRequests += 1;
				return ACCOUNT_TOKEN;
			},
			hubUrl: hub.url,
			machineId: "mach_fresh_ticket",
			reconnect: { initialDelayMs: 10, maxDelayMs: 50, jitterRatio: 0 },
		});
		hosts.push(host);
		await host.start();
		expect(credentialRequests).toBe(1);

		await first.close();
		relays.splice(relays.indexOf(first), 1);
		await waitFor(() => host.state() === "reconnecting");
		const registeredAgain = host.waitUntilRegistered();
		await startRelay(port);
		await registeredAgain;
		expect(credentialRequests).toBeGreaterThanOrEqual(2);
	});

	it("gives up when the relay rejects its account token", async () => {
		const hub = await startFakeHub();
		hubs.push(hub);
		const relay = await startRelay();
		const host = createRelayHostClient({
			relayUrl: relay.url,
			accountToken: "wrong-token",
			hubUrl: hub.url,
			machineId: "mach_air",
			// Deliberately WITHOUT maxAttempts: a rejected credential is terminal on
			// its own, not because the attempt budget ran out.
			reconnect: { initialDelayMs: 5, maxDelayMs: 5 },
		});
		hosts.push(host);
		await expect(host.start()).rejects.toThrow(/unauthorized/);
		expect(host.state()).toBe("closed");
	});

	it("fails the phone's connect when the local hub is unreachable", async () => {
		const relay = await startRelay();
		const host = createRelayHostClient({
			relayUrl: relay.url,
			accountToken: ACCOUNT_TOKEN,
			// Nothing is listening here.
			hubUrl: "ws://127.0.0.1:1/hub",
			machineId: "mach_air",
		});
		hosts.push(host);
		await host.start();
		const peer = await connectRawPeer({
			relayUrl: relay.url,
			role: "client",
			token: ACCOUNT_TOKEN,
		});
		peers.push(peer);
		peer.send({
			t: "client.connect",
			protocolVersion: "relay-v1",
			machineId: "mach_air",
		});
		// The phone is never told it is connected: a down hub is a connect ERROR,
		// not a connect that succeeds and closes a moment later.
		const error = await peer.waitFor("error");
		expect(error.code).toBe("hub_unreachable");
		expect(error.message).toMatch(/local hub/);
		expect(peer.framesOfType("client.connected")).toEqual([]);
	});
});

async function waitFor(
	predicate: () => boolean,
	timeoutMs = 5_000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error("condition never became true");
}
