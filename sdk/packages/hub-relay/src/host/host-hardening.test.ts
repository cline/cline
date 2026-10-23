/**
 * What a HOSTILE relay can do to the laptop.
 *
 * The host client dials out to a relay it authenticates to but does not trust:
 * the relay chooses when channels open, how many, and how big its frames are.
 * Every limit the server enforces has to exist on this side too, because a
 * compromised or spoofed relay simply does not apply them.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { type WebSocket, WebSocketServer } from "ws";
import {
	encodeRelayFrame,
	RELAY_PROTOCOL_VERSION,
	type RelayFrame,
} from "../protocol/index";
import {
	createRelayHostClient,
	type RelayHostClient,
	type RelayHostEvent,
} from "./host-client";

/** A relay the test drives frame by frame, including frames no real relay sends. */
interface FakeRelay {
	url: string;
	/** Resolves once a host socket has registered. */
	registered(): Promise<void>;
	send(frame: RelayFrame): void;
	sendRaw(text: string): void;
	received(): RelayFrame[];
	closeCodes(): number[];
	dropHostSocket(): void;
	close(): Promise<void>;
}

async function startFakeRelay(
	options: { rejectUpgrade?: number; registerThenDrop?: boolean } = {},
): Promise<FakeRelay> {
	const received: RelayFrame[] = [];
	const closeCodes: number[] = [];
	let hostSocket: WebSocket | undefined;
	const registeredWaiters = new Set<() => void>();
	let registeredOnce = false;

	const httpServer: Server = createServer((_request, response) => {
		response.statusCode = 404;
		response.end();
	});
	const wss = new WebSocketServer({ noServer: true });
	httpServer.on("upgrade", (request, socket, head) => {
		if (options.rejectUpgrade) {
			socket.write(
				`HTTP/1.1 ${options.rejectUpgrade} Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
			);
			socket.end();
			return;
		}
		wss.handleUpgrade(request, socket, head, (websocket) => {
			hostSocket = websocket;
			websocket.on("close", (code: number) => closeCodes.push(code));
			websocket.on("message", (raw: unknown) => {
				let frame: RelayFrame;
				try {
					frame = JSON.parse(String(raw)) as RelayFrame;
				} catch {
					return;
				}
				received.push(frame);
				if (frame.t !== "host.register") {
					return;
				}
				websocket.send(
					encodeRelayFrame({
						t: "host.registered",
						protocolVersion: RELAY_PROTOCOL_VERSION,
						machineId: frame.machineId,
						accountId: "acct_a",
						label: frame.label ?? "machine",
						connectedAt: Date.now(),
					}),
				);
				registeredOnce = true;
				for (const waiter of [...registeredWaiters]) {
					waiter();
				}
				if (options.registerThenDrop) {
					// Accept, then immediately drop: the flap the backoff must survive.
					setTimeout(() => websocket.terminate(), 5);
				}
			});
		});
	});
	await new Promise<void>((resolve) => {
		httpServer.listen(0, "127.0.0.1", () => resolve());
	});
	const address = httpServer.address() as AddressInfo;
	return {
		url: `ws://127.0.0.1:${address.port}`,
		registered: () =>
			registeredOnce
				? Promise.resolve()
				: new Promise<void>((resolve) => {
						const waiter = (): void => {
							registeredWaiters.delete(waiter);
							resolve();
						};
						registeredWaiters.add(waiter);
					}),
		send: (frame) => hostSocket?.send(encodeRelayFrame(frame)),
		sendRaw: (text) => hostSocket?.send(text),
		received: () => [...received],
		closeCodes: () => [...closeCodes],
		dropHostSocket: () => hostSocket?.terminate(),
		close: async () => {
			for (const client of wss.clients) {
				client.terminate();
			}
			await new Promise<void>((resolve) => wss.close(() => resolve()));
			await new Promise<void>((resolve) => httpServer.close(() => resolve()));
		},
	};
}

interface FakeHub {
	url: string;
	connections: number;
	liveConnections: number;
	close(): Promise<void>;
}

async function startFakeHub(): Promise<FakeHub> {
	let connections = 0;
	const live = new Set<WebSocket>();
	const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
	wss.on("connection", (socket: WebSocket) => {
		connections += 1;
		live.add(socket);
		socket.on("close", () => live.delete(socket));
	});
	await new Promise<void>((resolve) => wss.once("listening", () => resolve()));
	const address = wss.address() as AddressInfo;
	return {
		url: `ws://127.0.0.1:${address.port}/hub`,
		get connections() {
			return connections;
		},
		get liveConnections() {
			return live.size;
		},
		close: () => new Promise<void>((resolve) => wss.close(() => resolve())),
	};
}

/** Accepts TCP and never completes the websocket handshake. */
async function startStalledHub(): Promise<{
	url: string;
	close(): Promise<void>;
}> {
	const httpServer = createServer();
	const stalled: { destroy(): void }[] = [];
	httpServer.on("upgrade", (_request, socket) => {
		// Deliberately never answers; kept so the listener can be shut down.
		stalled.push(socket);
	});
	await new Promise<void>((resolve) => {
		httpServer.listen(0, "127.0.0.1", () => resolve());
	});
	const address = httpServer.address() as AddressInfo;
	return {
		url: `ws://127.0.0.1:${address.port}/hub`,
		close: async () => {
			for (const socket of stalled.splice(0, stalled.length)) {
				socket.destroy();
			}
			await new Promise<void>((resolve) => httpServer.close(() => resolve()));
		},
	};
}

const relays: FakeRelay[] = [];
const hosts: RelayHostClient[] = [];
const hubs: { close(): Promise<void> }[] = [];

afterEach(async () => {
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

async function waitFor(
	predicate: () => boolean,
	label: string,
	timeoutMs = 10_000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error(`timed out waiting for ${label}`);
}

describe("a host client against a hostile relay", () => {
	it("does not leak a hub socket when the relay repeats a channel id", async () => {
		const hub = await startFakeHub();
		hubs.push(hub);
		const relay = await startFakeRelay();
		relays.push(relay);
		const events: RelayHostEvent[] = [];
		const host = createRelayHostClient({
			relayUrl: relay.url,
			accountToken: "tok",
			hubUrl: hub.url,
			machineId: "mach_air",
			onEvent: (event) => events.push(event),
		});
		hosts.push(host);
		await host.start();

		relay.send({
			t: "channel.open",
			channelId: "chn_dup",
			openedAt: Date.now(),
		});
		await waitFor(() => hub.connections === 1, "the first hub socket");
		relay.send({
			t: "channel.open",
			channelId: "chn_dup",
			openedAt: Date.now(),
		});
		await new Promise((resolve) => setTimeout(resolve, 100));

		// One channel id means one hub socket, tracked and closeable.
		expect(hub.connections).toBe(1);
		expect(host.channelCount()).toBe(1);
		expect(hub.liveConnections).toBe(1);
		await host.close();
		hosts.splice(hosts.indexOf(host), 1);
		await waitFor(() => hub.liveConnections === 0, "every hub socket to close");
	});

	it("caps the channels a relay can force it to open", async () => {
		const hub = await startFakeHub();
		hubs.push(hub);
		const relay = await startFakeRelay();
		relays.push(relay);
		const host = createRelayHostClient({
			relayUrl: relay.url,
			accountToken: "tok",
			hubUrl: hub.url,
			machineId: "mach_air",
			maxChannels: 4,
		});
		hosts.push(host);
		await host.start();

		for (let index = 0; index < 300; index += 1) {
			relay.send({
				t: "channel.open",
				channelId: `chn_${index}`,
				openedAt: Date.now(),
			});
		}
		await waitFor(
			() =>
				relay
					.received()
					.filter(
						(frame) =>
							frame.t === "channel.close" && frame.code === "channel_limit",
					).length > 0,
			"a channel_limit refusal",
		);
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(host.channelCount()).toBeLessThanOrEqual(4);
		expect(hub.connections).toBeLessThanOrEqual(4);
	});

	it("refuses a relay frame larger than its own payload cap without parsing it", async () => {
		const hub = await startFakeHub();
		hubs.push(hub);
		const relay = await startFakeRelay();
		relays.push(relay);
		const host = createRelayHostClient({
			relayUrl: relay.url,
			accountToken: "tok",
			hubUrl: hub.url,
			machineId: "mach_air",
			maxPayloadBytes: 64 * 1024,
			reconnect: { initialDelayMs: 5, maxDelayMs: 10, jitterRatio: 0 },
		});
		hosts.push(host);
		await host.start();
		relay.sendRaw(
			`{"t":"data","channelId":"c","seq":1,"payload":"${"A".repeat(
				2 * 1024 * 1024,
			)}"}`,
		);
		// `ws` refuses at the transport layer (1009) instead of handing the laptop a
		// multi-megabyte JSON.parse.
		await waitFor(
			() => relay.closeCodes().includes(1009),
			"a 1009 close from the host's own maxPayload",
		);
	});

	it("bounds the frames it queues for a hub socket that never opens", async () => {
		const stalled = await startStalledHub();
		hubs.push(stalled);
		const relay = await startFakeRelay();
		relays.push(relay);
		const host = createRelayHostClient({
			relayUrl: relay.url,
			accountToken: "tok",
			hubUrl: stalled.url,
			machineId: "mach_air",
			maxPendingBytesPerChannel: 32 * 1024,
		});
		hosts.push(host);
		await host.start();
		relay.send({ t: "channel.open", channelId: "chn_1", openedAt: Date.now() });
		await new Promise((resolve) => setTimeout(resolve, 50));
		const payload = "A".repeat(8 * 1024);
		for (let seq = 1; seq <= 64; seq += 1) {
			relay.send({ t: "data", channelId: "chn_1", seq, payload });
		}
		await waitFor(
			() =>
				relay
					.received()
					.some(
						(frame) =>
							frame.t === "channel.close" && frame.code === "backpressure",
					),
			"the channel to be dropped for backpressure",
		);
		expect(host.channelCount()).toBe(0);
	});

	it("keeps backing off when a relay accepts the registration then drops it", async () => {
		const hub = await startFakeHub();
		hubs.push(hub);
		const relay = await startFakeRelay({ registerThenDrop: true });
		relays.push(relay);
		const delays: number[] = [];
		const host = createRelayHostClient({
			relayUrl: relay.url,
			accountToken: "tok",
			hubUrl: hub.url,
			machineId: "mach_air",
			reconnect: {
				initialDelayMs: 20,
				maxDelayMs: 5_000,
				jitterRatio: 0,
				stablePeriodMs: 60_000,
			},
			onEvent: (event) => {
				if (
					event.type === "disconnected" &&
					event.willRetryInMs !== undefined
				) {
					delays.push(event.willRetryInMs);
				}
			},
		});
		hosts.push(host);
		await host.start();
		await waitFor(() => delays.length >= 4, "four reconnect delays");
		// 20, 40, 80, 160 — an accept-then-drop relay must not pin the backoff at
		// the initial delay forever.
		expect(delays[3]).toBeGreaterThan(delays[0] as number);
		expect(delays[3]).toBeGreaterThanOrEqual(160);
	});

	it("treats a rejected account credential as terminal, with no retry loop", async () => {
		const relay = await startFakeRelay({ rejectUpgrade: 401 });
		relays.push(relay);
		const events: RelayHostEvent[] = [];
		const host = createRelayHostClient({
			relayUrl: relay.url,
			accountToken: "revoked",
			hubUrl: "ws://127.0.0.1:1/hub",
			machineId: "mach_air",
			// No maxAttempts: the default retries forever, which is exactly why a
			// revoked token used to spin instead of settling.
			reconnect: { initialDelayMs: 5, maxDelayMs: 5 },
			onEvent: (event) => events.push(event),
		});
		hosts.push(host);
		await expect(host.start()).rejects.toThrow(/unauthorized/);
		expect(host.state()).toBe("closed");
		const attempts = events.filter(
			(event) => event.type === "connecting",
		).length;
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(events.filter((event) => event.type === "connecting").length).toBe(
			attempts,
		);
		expect(attempts).toBe(1);
	});
});
