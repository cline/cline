/**
 * Abuse cases a hostile (or merely broken) peer can reach, each one reproduced
 * before it was fixed:
 *
 * - a stalled peer must not be able to grow the relay's memory (backpressure),
 * - a machine id must not be claimable across accounts, nor grow the registry
 *   without bound,
 * - one bad frame must cost the offending channel, not the whole host tunnel,
 * - routing errors must not leak whether an id exists under another account,
 * - nothing attacker-controlled reaches an operator log unsanitised.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
	bytesToBase64,
	RELAY_CLOSE_CODES,
	RELAY_NEWEST_MACHINE,
	textToBase64,
} from "../protocol/index";
import {
	connectEchoHost,
	connectRawPeer,
	type RawRelayPeer,
} from "../testing/raw-peer";
import {
	createRelayServer,
	type RelayServer,
	type RelayServerEvent,
	type VerifyAccount,
} from "./server";

const ACCOUNT_A_TOKEN = "dev-token-account-a";
const ACCOUNT_B_TOKEN = "dev-token-account-b";

const verifyAccount: VerifyAccount = ({ token }) => {
	if (token === ACCOUNT_A_TOKEN) {
		return { accountId: "acct_a" };
	}
	if (token === ACCOUNT_B_TOKEN) {
		return { accountId: "acct_b" };
	}
	return undefined;
};

const servers: RelayServer[] = [];
const sockets: { close(): void }[] = [];

async function startRelay(
	overrides: Partial<Parameters<typeof createRelayServer>[0]> = {},
	events?: RelayServerEvent[],
): Promise<RelayServer> {
	const relay = await createRelayServer({
		verifyAccount,
		port: 0,
		...overrides,
		...(events ? { onEvent: (event) => events.push(event) } : {}),
	});
	servers.push(relay);
	return relay;
}

function track<T extends { close(): void }>(peer: T): T {
	sockets.push(peer);
	return peer;
}

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

afterEach(async () => {
	for (const socket of sockets.splice(0, sockets.length)) {
		try {
			socket.close();
		} catch {
			// best-effort
		}
	}
	for (const relay of servers.splice(0, servers.length)) {
		await relay.close();
	}
});

describe("backpressure", () => {
	it("bounds buffered bytes for a stalled peer and closes the channel", async () => {
		const frameBytes = 64 * 1024;
		const highWaterMark = 256 * 1024;
		const relay = await startRelay({
			maxPayloadBytes: frameBytes,
			sendHighWaterMarkBytes: highWaterMark,
			backpressureStallMs: 500,
		});
		const host = track(
			await connectEchoHost({
				relayUrl: relay.url,
				token: ACCOUNT_A_TOKEN,
				machineId: "mach_air",
			}),
		);
		const client = track(
			await connectRawPeer({
				relayUrl: relay.url,
				role: "client",
				token: ACCOUNT_A_TOKEN,
			}),
		);
		client.send({
			t: "client.connect",
			protocolVersion: "relay-v1",
			machineId: "mach_air",
		});
		const connected = await client.waitFor("client.connected");

		// The phone stops reading: exactly what a backgrounded app on a dead
		// cellular link looks like to the relay.
		client.socket.pause();

		const payload = bytesToBase64(new Uint8Array(frameBytes));
		let peak = 0;
		for (let seq = 1; seq <= 200; seq += 1) {
			host.send({
				t: "data",
				channelId: connected.channelId,
				seq,
				payload,
			});
			// Let the event loop flush so bufferedAmount reflects reality.
			await new Promise((resolve) => setImmediate(resolve));
			peak = Math.max(peak, relay.stats().bytesBuffered);
			if (relay.stats().channels === 0) {
				break;
			}
		}

		// 200 x 64 KiB = 12.8 MiB offered. Before the fix every byte of it sat in
		// the relay's send buffer; now the ceiling is the watermark plus the one
		// frame that crossed it.
		expect(peak).toBeLessThan(highWaterMark + frameBytes * 3);
		const closed = await host.waitFor(
			"channel.close",
			(frame) => frame.channelId === connected.channelId,
		);
		expect(closed.code).toBe("backpressure");
		await waitFor(() => relay.stats().channels === 0, "the channel to close");
	});

	it("keeps relaying to a peer that drains", async () => {
		const relay = await startRelay({
			maxPayloadBytes: 64 * 1024,
			sendHighWaterMarkBytes: 256 * 1024,
		});
		const host = track(
			await connectEchoHost({
				relayUrl: relay.url,
				token: ACCOUNT_A_TOKEN,
				machineId: "mach_air",
			}),
		);
		const client = track(
			await connectRawPeer({
				relayUrl: relay.url,
				role: "client",
				token: ACCOUNT_A_TOKEN,
			}),
		);
		client.send({
			t: "client.connect",
			protocolVersion: "relay-v1",
			machineId: "mach_air",
		});
		const connected = await client.waitFor("client.connected");
		for (let seq = 1; seq <= 40; seq += 1) {
			host.send({
				t: "data",
				channelId: connected.channelId,
				seq,
				payload: textToBase64(`frame-${seq}`),
			});
		}
		await waitFor(
			() => client.framesOfType("data").length === 40,
			"all 40 frames to arrive",
		);
		expect(client.closeInfo()).toBeUndefined();
		expect(relay.stats().channels).toBe(1);
	});

	it("pauses the phone rather than buffering for a host that stops draining", async () => {
		const frameBytes = 64 * 1024;
		const highWaterMark = 256 * 1024;
		const relay = await startRelay({
			maxPayloadBytes: frameBytes,
			sendHighWaterMarkBytes: highWaterMark,
			backpressureStallMs: 400,
		});
		const host = track(
			await connectEchoHost({
				relayUrl: relay.url,
				token: ACCOUNT_A_TOKEN,
				machineId: "mach_air",
			}),
		);
		const client = track(
			await connectRawPeer({
				relayUrl: relay.url,
				role: "client",
				token: ACCOUNT_A_TOKEN,
			}),
		);
		client.send({
			t: "client.connect",
			protocolVersion: "relay-v1",
			machineId: "mach_air",
		});
		const connected = await client.waitFor("client.connected");
		// The laptop stops reading. Its tunnel is shared, so the relay pauses THIS
		// phone instead of stalling every other phone on that machine.
		host.socket.pause();

		const payload = bytesToBase64(new Uint8Array(frameBytes));
		let peak = 0;
		for (let seq = 1; seq <= 200; seq += 1) {
			client.send({
				t: "data",
				channelId: connected.channelId,
				seq,
				payload,
			});
			await new Promise((resolve) => setImmediate(resolve));
			peak = Math.max(peak, relay.stats().bytesBuffered);
			if (relay.stats().channels === 0) {
				break;
			}
		}
		expect(peak).toBeLessThan(highWaterMark + frameBytes * 3);
		// Still stalled when the grace period expires: the channel goes.
		const closed = await client.waitForClose();
		expect(closed.code).toBe(RELAY_CLOSE_CODES.backpressure);
	});
});

describe("throughput limits", () => {
	it("enforces a token-bucket byte rate per channel", async () => {
		let now = 1_000;
		const relay = await startRelay({
			maxPayloadBytes: 10,
			now: () => now,
			limits: {
				maxBytesPerSecondPerChannel: 10,
				channelBurstBytes: 10,
				maxBytesPerSecondPerAccount: 100,
				accountBurstBytes: 100,
			},
		});
		const host = track(
			await connectRawPeer({
				relayUrl: relay.url,
				role: "host",
				token: ACCOUNT_A_TOKEN,
				maxPayloadBytes: 10,
			}),
		);
		host.send({
			t: "host.register",
			protocolVersion: "relay-v1",
			machineId: "mach_rate",
		});
		await host.waitFor("host.registered");
		const client = track(
			await connectRawPeer({
				relayUrl: relay.url,
				role: "client",
				token: ACCOUNT_A_TOKEN,
				maxPayloadBytes: 10,
			}),
		);
		client.send({
			t: "client.connect",
			protocolVersion: "relay-v1",
			machineId: "mach_rate",
		});
		const opened = await host.waitFor("channel.open");
		host.send({ t: "channel.ready", channelId: opened.channelId });
		await client.waitFor("client.connected");

		const payload = bytesToBase64(new Uint8Array(6));
		client.send({ t: "data", channelId: opened.channelId, seq: 1, payload });
		await host.waitFor("data", (frame) => frame.seq === 1);

		// One second replenishes the six bytes consumed by the first frame.
		now += 1_000;
		client.send({ t: "data", channelId: opened.channelId, seq: 2, payload });
		await host.waitFor("data", (frame) => frame.seq === 2);

		// The same burst without elapsed time exceeds the remaining four bytes.
		client.send({ t: "data", channelId: opened.channelId, seq: 3, payload });
		const closed = await host.waitFor(
			"channel.close",
			(frame) => frame.channelId === opened.channelId,
		);
		expect(closed.code).toBe("rate_limited");
		expect((await client.waitForClose()).code).toBe(
			RELAY_CLOSE_CODES.rate_limited,
		);
	});

	it("shares the account byte budget across channels", async () => {
		const relay = await startRelay({
			maxPayloadBytes: 10,
			limits: {
				maxBytesPerSecondPerChannel: 100,
				channelBurstBytes: 100,
				maxBytesPerSecondPerAccount: 10,
				accountBurstBytes: 10,
			},
		});
		const host = track(
			await connectRawPeer({
				relayUrl: relay.url,
				role: "host",
				token: ACCOUNT_A_TOKEN,
				maxPayloadBytes: 10,
			}),
		);
		host.send({
			t: "host.register",
			protocolVersion: "relay-v1",
			machineId: "mach_account_rate",
		});
		await host.waitFor("host.registered");

		const openedChannels = new Set<string>();
		const connectClient = async (): Promise<{
			client: RawRelayPeer;
			channelId: string;
		}> => {
			const client = track(
				await connectRawPeer({
					relayUrl: relay.url,
					role: "client",
					token: ACCOUNT_A_TOKEN,
					maxPayloadBytes: 10,
				}),
			);
			client.send({
				t: "client.connect",
				protocolVersion: "relay-v1",
				machineId: "mach_account_rate",
			});
			const opened = await host.waitFor(
				"channel.open",
				(frame) => !openedChannels.has(frame.channelId),
			);
			openedChannels.add(opened.channelId);
			host.send({ t: "channel.ready", channelId: opened.channelId });
			await client.waitFor("client.connected");
			return { client, channelId: opened.channelId };
		};

		const first = await connectClient();
		const second = await connectClient();
		const payload = bytesToBase64(new Uint8Array(6));
		first.client.send({
			t: "data",
			channelId: first.channelId,
			seq: 1,
			payload,
		});
		await host.waitFor("data", (frame) => frame.channelId === first.channelId);
		second.client.send({
			t: "data",
			channelId: second.channelId,
			seq: 1,
			payload,
		});
		expect((await second.client.waitForClose()).code).toBe(
			RELAY_CLOSE_CODES.rate_limited,
		);
		// The first channel remains usable; only the channel that exceeded the
		// shared account budget is closed.
		expect(relay.stats().channels).toBe(1);
	});
});

describe("machine identity ownership", () => {
	it("lets two accounts use the same machineId without collision", async () => {
		const relay = await startRelay();
		const hostA = track(
			await connectEchoHost({
				relayUrl: relay.url,
				token: ACCOUNT_A_TOKEN,
				machineId: "mach_laptop",
				label: "A's laptop",
			}),
		);
		const hostB = track(
			await connectEchoHost({
				relayUrl: relay.url,
				token: ACCOUNT_B_TOKEN,
				machineId: "mach_laptop",
				label: "B's laptop",
			}),
		);
		expect(hostB.framesOfType("host.registered")[0]).toMatchObject({
			machineId: "mach_laptop",
			accountId: "acct_b",
		});
		expect(relay.machinesForAccount("acct_a")).toHaveLength(1);
		expect(relay.machinesForAccount("acct_b")).toHaveLength(1);

		// Each account's client reaches ITS OWN machine of that id.
		for (const [token, label] of [
			[ACCOUNT_A_TOKEN, "A's laptop"],
			[ACCOUNT_B_TOKEN, "B's laptop"],
		] as const) {
			const client = track(
				await connectRawPeer({ relayUrl: relay.url, role: "client", token }),
			);
			client.send({
				t: "client.connect",
				protocolVersion: "relay-v1",
				machineId: "mach_laptop",
			});
			const connected = await client.waitFor("client.connected");
			expect(connected.label).toBe(label);
		}
		void hostA;
	});

	it("cannot be denied to its owner by an attacker who claims the id first", async () => {
		const relay = await startRelay();
		// The attacker registers the victim's id, then goes away.
		const attacker = await connectEchoHost({
			relayUrl: relay.url,
			token: ACCOUNT_B_TOKEN,
			machineId: "mach_victim_laptop",
		});
		attacker.close();
		await attacker.waitForClose();

		const owner = track(
			await connectEchoHost({
				relayUrl: relay.url,
				token: ACCOUNT_A_TOKEN,
				machineId: "mach_victim_laptop",
			}),
		);
		expect(owner.framesOfType("host.registered")[0]).toMatchObject({
			accountId: "acct_a",
		});
		const client = track(
			await connectRawPeer({
				relayUrl: relay.url,
				role: "client",
				token: ACCOUNT_A_TOKEN,
			}),
		);
		client.send({
			t: "client.connect",
			protocolVersion: "relay-v1",
			machineId: "mach_victim_laptop",
		});
		await client.waitFor("client.connected");
	});

	it("does not let the known-machine registry grow without bound", async () => {
		const relay = await startRelay({
			limits: { maxKnownMachinesPerAccount: 4 },
		});
		for (let index = 0; index < 20; index += 1) {
			const host = await connectEchoHost({
				relayUrl: relay.url,
				token: ACCOUNT_A_TOKEN,
				machineId: `mach_throwaway_${index}`,
			});
			host.close();
			await host.waitForClose();
		}
		expect(relay.stats().knownMachines).toBeLessThanOrEqual(4);
	});

	it("forgets an offline machine once its record expires", async () => {
		let clock = 1_000_000;
		const relay = await startRelay({
			machineTtlMs: 5_000,
			now: () => clock,
		});
		const host = await connectEchoHost({
			relayUrl: relay.url,
			token: ACCOUNT_A_TOKEN,
			machineId: "mach_air",
		});
		host.close();
		await host.waitForClose();
		await waitFor(() => relay.stats().hosts === 0, "the host to be forgotten");
		clock += 60_000;

		const client = track(
			await connectRawPeer({
				relayUrl: relay.url,
				role: "client",
				token: ACCOUNT_A_TOKEN,
			}),
		);
		client.send({
			t: "client.connect",
			protocolVersion: "relay-v1",
			machineId: "mach_air",
		});
		const error = await client.waitFor("error");
		expect(error.code).toBe("machine_not_found");
		expect(relay.stats().knownMachines).toBe(0);
	});
});

describe("failure blast radius", () => {
	it("closes only the offending channel when a host sends a bad data frame", async () => {
		const relay = await startRelay({ maxPayloadBytes: 4 * 1024 });
		const host = track(
			await connectEchoHost({
				relayUrl: relay.url,
				token: ACCOUNT_A_TOKEN,
				machineId: "mach_air",
			}),
		);
		const openChannel = async (): Promise<{
			peer: Awaited<ReturnType<typeof connectRawPeer>>;
			channelId: string;
		}> => {
			const peer = track(
				await connectRawPeer({
					relayUrl: relay.url,
					role: "client",
					token: ACCOUNT_A_TOKEN,
				}),
			);
			peer.send({
				t: "client.connect",
				protocolVersion: "relay-v1",
				machineId: "mach_air",
			});
			const connected = await peer.waitFor("client.connected");
			return { peer, channelId: connected.channelId };
		};
		const first = await openChannel();
		const second = await openChannel();
		expect(relay.stats().channels).toBe(2);

		// One oversized frame on the FIRST channel.
		host.send({
			t: "data",
			channelId: first.channelId,
			seq: 1,
			payload: "A".repeat(64 * 1024),
		});

		const firstClosed = await first.peer.waitForClose();
		expect(firstClosed.code).toBe(RELAY_CLOSE_CODES.frame_too_large);
		// The tunnel, and every other channel on it, survives.
		await waitFor(() => relay.stats().channels === 1, "one channel to remain");
		expect(host.closeInfo()).toBeUndefined();
		second.peer.send({
			t: "data",
			channelId: second.channelId,
			seq: 1,
			payload: textToBase64("still alive"),
		});
		const echoed = await second.peer.waitFor("data");
		expect(echoed.payload).toBe(textToBase64("still alive"));
		expect(second.peer.closeInfo()).toBeUndefined();
	});

	it("still drops a host that floods unattributable garbage", async () => {
		const relay = await startRelay();
		const host = track(
			await connectRawPeer({
				relayUrl: relay.url,
				role: "host",
				token: ACCOUNT_A_TOKEN,
			}),
		);
		host.send({
			t: "host.register",
			protocolVersion: "relay-v1",
			machineId: "mach_air",
		});
		await host.waitFor("host.registered");
		for (let index = 0; index < 64; index += 1) {
			host.sendRaw("{not json");
		}
		const closed = await host.waitForClose();
		expect(closed.code).toBe(RELAY_CLOSE_CODES.malformed_frame);
	});
});

describe("error surface", () => {
	it("does not reveal that a machine id exists under another account", async () => {
		const relay = await startRelay();
		track(
			await connectEchoHost({
				relayUrl: relay.url,
				token: ACCOUNT_A_TOKEN,
				machineId: "mach_air",
			}),
		);
		const ask = async (
			machineId: string,
		): Promise<{ code: string; message: string }> => {
			const peer = track(
				await connectRawPeer({
					relayUrl: relay.url,
					role: "client",
					token: ACCOUNT_B_TOKEN,
				}),
			);
			peer.send({
				t: "client.connect",
				protocolVersion: "relay-v1",
				machineId,
			});
			return await peer.waitFor("error");
		};
		const existsElsewhere = await ask("mach_air");
		const neverExisted = await ask("mach_ghost");
		// Identical code AND identical message: no oracle in either field.
		expect(existsElsewhere.code).toBe(neverExisted.code);
		expect(existsElsewhere.code).toBe("machine_not_found");
		expect(
			(existsElsewhere as { message: string }).message.replace("mach_air", "X"),
		).toBe(
			(neverExisted as { message: string }).message.replace("mach_ghost", "X"),
		);
	});

	it("distinguishes a verifier outage from a rejected credential", async () => {
		const events: RelayServerEvent[] = [];
		const relay = await startRelay(
			{
				verifyAccount: () => {
					throw new Error("JWKS fetch failed");
				},
			},
			events,
		);
		await expect(
			connectRawPeer({
				relayUrl: relay.url,
				role: "client",
				token: ACCOUNT_A_TOKEN,
			}),
		).rejects.toThrow(/503/);
		expect(events.some((event) => event.type === "auth.error")).toBe(true);
		expect(events.some((event) => event.type === "auth.rejected")).toBe(false);
	});

	it("sanitises an attacker's close code and reason before they reach a log", async () => {
		const events: RelayServerEvent[] = [];
		const relay = await startRelay({}, events);
		const host = track(
			await connectEchoHost({
				relayUrl: relay.url,
				token: ACCOUNT_A_TOKEN,
				machineId: "mach_air",
			}),
		);
		const client = track(
			await connectRawPeer({
				relayUrl: relay.url,
				role: "client",
				token: ACCOUNT_A_TOKEN,
			}),
		);
		client.send({
			t: "client.connect",
			protocolVersion: "relay-v1",
			machineId: "mach_air",
		});
		const connected = await client.waitFor("client.connected");
		client.sendRaw(
			JSON.stringify({
				t: "channel.close",
				channelId: connected.channelId,
				code: "normal",
				reason: `bye\n[relay 1970-01-01] host registered machine=evil account=acct_root\r\n${"P".repeat(
					5_000,
				)}`,
			}),
		);
		await waitFor(
			() => events.some((event) => event.type === "channel.closed"),
			"the channel.closed event",
		);
		const closed = events.find((event) => event.type === "channel.closed");
		const serialised = JSON.stringify(closed);
		expect(serialised).not.toContain("\\n");
		expect(serialised).not.toContain("\\r");
		expect(serialised.length).toBeLessThan(1_000);
		// The relay also hands that reason to the OTHER peer and to whatever logs
		// it there, so it is sanitised at the point it is parsed.
		const forwarded = await host.waitFor(
			"channel.close",
			(frame) => frame.channelId === connected.channelId,
		);
		const reason = forwarded.reason ?? "";
		const controlChars = [...reason].filter(
			(char) => (char.codePointAt(0) ?? 0) < 0x20,
		);
		expect(controlChars).toEqual([]);
		expect(reason.length).toBeLessThanOrEqual(256);
	});

	it("counts decoded payload bytes rather than base64 characters", async () => {
		const events: RelayServerEvent[] = [];
		const relay = await startRelay({}, events);
		track(
			await connectEchoHost({
				relayUrl: relay.url,
				token: ACCOUNT_A_TOKEN,
				machineId: "mach_air",
			}),
		);
		const client = track(
			await connectRawPeer({
				relayUrl: relay.url,
				role: "client",
				token: ACCOUNT_A_TOKEN,
			}),
		);
		client.send({
			t: "client.connect",
			protocolVersion: "relay-v1",
			machineId: "mach_air",
		});
		const connected = await client.waitFor("client.connected");
		const payload = bytesToBase64(new Uint8Array(300));
		client.send({
			t: "data",
			channelId: connected.channelId,
			seq: 1,
			payload,
		});
		await waitFor(
			() =>
				events.some(
					(event) =>
						event.type === "frame" && event.direction === "client->host",
				),
			"the frame event",
		);
		const frame = events.find(
			(event) => event.type === "frame" && event.direction === "client->host",
		);
		expect(frame && "bytes" in frame ? frame.bytes : -1).toBe(300);
		expect(payload.length).toBe(400);
	});
});

describe("limits and timeouts", () => {
	it("lets the heartbeat close frame reach the peer before terminating", async () => {
		let clock = 1_000_000;
		const relay = await startRelay({
			heartbeatIntervalMs: 20,
			heartbeatTimeoutMs: 1,
			now: () => clock,
		});
		const peer = track(
			await connectRawPeer({
				relayUrl: relay.url,
				role: "host",
				token: ACCOUNT_A_TOKEN,
			}),
		);
		clock += 60_000;
		const closed = await peer.waitForClose();
		expect(closed.code).toBe(RELAY_CLOSE_CODES.heartbeat_timeout);
		expect(closed.reason).toBe("heartbeat_timeout");
	});

	it("raises the websocket frame cap with the payload cap", async () => {
		const payloadBytes = 10 * 1024 * 1024;
		const maxPayloadBytes = 12 * 1024 * 1024;
		const relay = await startRelay({ maxPayloadBytes });
		const host = track(
			await connectEchoHost({
				relayUrl: relay.url,
				token: ACCOUNT_A_TOKEN,
				machineId: "mach_air",
				maxPayloadBytes,
			}),
		);
		const client = track(
			await connectRawPeer({
				relayUrl: relay.url,
				role: "client",
				token: ACCOUNT_A_TOKEN,
				maxPayloadBytes,
			}),
		);
		client.send({
			t: "client.connect",
			protocolVersion: "relay-v1",
			machineId: "mach_air",
		});
		const connected = await client.waitFor("client.connected");
		// Over the 12 MiB RELAY_MAX_FRAME_BYTES default once base64-expanded, but
		// well inside the 12 MiB payload cap this relay was configured with.
		client.send({
			t: "data",
			channelId: connected.channelId,
			seq: 1,
			payload: bytesToBase64(new Uint8Array(payloadBytes)),
		});
		const echoed = await client.waitFor("data");
		expect(echoed.payload.length).toBeGreaterThan(13 * 1024 * 1024);
		void host;
	});
});

describe("channel establishment", () => {
	it("does not report the phone connected until the host confirms its local hub", async () => {
		const relay = await startRelay({ channelReadyTimeoutMs: 300 });
		// A host that accepts channels but never confirms one: what a laptop whose
		// local hub is down looks like.
		const host = track(
			await connectRawPeer({
				relayUrl: relay.url,
				role: "host",
				token: ACCOUNT_A_TOKEN,
			}),
		);
		host.send({
			t: "host.register",
			protocolVersion: "relay-v1",
			machineId: "mach_air",
		});
		await host.waitFor("host.registered");
		const client = track(
			await connectRawPeer({
				relayUrl: relay.url,
				role: "client",
				token: ACCOUNT_A_TOKEN,
			}),
		);
		client.send({
			t: "client.connect",
			protocolVersion: "relay-v1",
			machineId: RELAY_NEWEST_MACHINE,
		});
		await host.waitFor("channel.open");
		const error = await client.waitFor("error");
		expect(error.code).toBe("hub_unreachable");
		// The phone was never told the path existed.
		expect(client.framesOfType("client.connected")).toEqual([]);
		await waitFor(() => relay.stats().channels === 0, "the channel to be gone");
	});

	it("surfaces a host's pre-ready channel.close as a connect failure", async () => {
		const relay = await startRelay();
		const host = track(
			await connectRawPeer({
				relayUrl: relay.url,
				role: "host",
				token: ACCOUNT_A_TOKEN,
			}),
		);
		host.send({
			t: "host.register",
			protocolVersion: "relay-v1",
			machineId: "mach_air",
		});
		await host.waitFor("host.registered");
		host.socket.on("message", (raw: unknown) => {
			const parsed = JSON.parse(String(raw)) as {
				t?: string;
				channelId?: string;
			};
			if (parsed.t === "channel.open" && parsed.channelId) {
				host.send({
					t: "channel.close",
					channelId: parsed.channelId,
					code: "internal",
					reason: "could not connect to the local hub",
				});
			}
		});
		const client = track(
			await connectRawPeer({
				relayUrl: relay.url,
				role: "client",
				token: ACCOUNT_A_TOKEN,
			}),
		);
		client.send({
			t: "client.connect",
			protocolVersion: "relay-v1",
			machineId: "mach_air",
		});
		const error = await client.waitFor("error");
		expect(error.code).toBe("hub_unreachable");
		expect(client.framesOfType("client.connected")).toEqual([]);
	});
});
