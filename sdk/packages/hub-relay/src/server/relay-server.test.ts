import { afterEach, describe, expect, it } from "vitest";
import {
	bytesToBase64,
	RELAY_CLOSE_CODES,
	RELAY_NEWEST_MACHINE,
} from "../protocol/index";
import { connectEchoHost, connectRawPeer } from "../testing/raw-peer";
import {
	createRelayServer,
	type RelayServer,
	type RelayServerEvent,
	type VerifyAccount,
} from "./server";

const ACCOUNT_A_TOKEN = "dev-token-account-a";
const ACCOUNT_B_TOKEN = "dev-token-account-b";

/** Stand-in for production WorkOS/Cline JWT verification. */
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

function randomBytes(length: number): Uint8Array {
	const bytes = new Uint8Array(length);
	for (let index = 0; index < length; index += 1) {
		bytes[index] = Math.floor(Math.random() * 256);
	}
	return bytes;
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

describe("registration and pairing", () => {
	it("registers a machine and reports it for its own account only", async () => {
		const events: RelayServerEvent[] = [];
		const relay = await startRelay({}, events);
		const host = track(
			await connectEchoHost({
				relayUrl: relay.url,
				token: ACCOUNT_A_TOKEN,
				machineId: "mach_air",
				label: "Example's MacBook Air",
			}),
		);
		const registered = host.framesOfType("host.registered")[0];
		expect(registered).toMatchObject({
			machineId: "mach_air",
			accountId: "acct_a",
			label: "Example's MacBook Air",
		});
		expect(relay.machinesForAccount("acct_a").map((m) => m.machineId)).toEqual([
			"mach_air",
		]);
		expect(relay.machinesForAccount("acct_b")).toEqual([]);
		expect(
			events.filter((event) => event.type === "host.registered"),
		).toHaveLength(1);
	});

	it("pipes opaque bytes both ways without interpreting them", async () => {
		const relay = await startRelay();
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

		// Random bytes: not JSON, not utf8-valid, nothing the relay could parse even
		// if it wanted to. This is what an E2E-encrypted hub frame looks like to it.
		const opaque = randomBytes(2048);
		const payload = bytesToBase64(opaque);
		client.send({
			t: "data",
			channelId: connected.channelId,
			seq: 1,
			payload,
		});
		const echoed = await client.waitFor(
			"data",
			(frame) => frame.seq === 1 && frame.channelId === connected.channelId,
		);
		expect(echoed.payload).toBe(payload);
		expect(relay.stats().framesRelayed).toBe(2);
	});

	it("resolves 'newest' to this account's most recently registered machine", async () => {
		const relay = await startRelay();
		track(
			await connectEchoHost({
				relayUrl: relay.url,
				token: ACCOUNT_A_TOKEN,
				machineId: "mach_old",
			}),
		);
		track(
			await connectEchoHost({
				relayUrl: relay.url,
				token: ACCOUNT_A_TOKEN,
				machineId: "mach_new",
			}),
		);
		// Another account's newer machine must not win the race.
		track(
			await connectEchoHost({
				relayUrl: relay.url,
				token: ACCOUNT_B_TOKEN,
				machineId: "mach_other",
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
			machineId: RELAY_NEWEST_MACHINE,
		});
		const connected = await client.waitFor("client.connected");
		expect(connected.machineId).toBe("mach_new");
	});

	it("gives each of several clients on one machine its own channel", async () => {
		const relay = await startRelay();
		const host = track(
			await connectEchoHost({
				relayUrl: relay.url,
				token: ACCOUNT_A_TOKEN,
				machineId: "mach_air",
			}),
		);
		const channelIds: string[] = [];
		for (let index = 0; index < 3; index += 1) {
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
			channelIds.push((await client.waitFor("client.connected")).channelId);
		}
		expect(new Set(channelIds).size).toBe(3);
		expect(host.framesOfType("channel.open")).toHaveLength(3);
		expect(relay.stats().channels).toBe(3);
		expect(relay.machines()[0]?.channels).toBe(3);
	});
});

describe("account scoping", () => {
	it("refuses a machine that belongs to another account", async () => {
		const relay = await startRelay();
		track(
			await connectEchoHost({
				relayUrl: relay.url,
				token: ACCOUNT_A_TOKEN,
				machineId: "mach_air",
			}),
		);
		const intruder = track(
			await connectRawPeer({
				relayUrl: relay.url,
				role: "client",
				token: ACCOUNT_B_TOKEN,
			}),
		);
		intruder.send({
			t: "client.connect",
			protocolVersion: "relay-v1",
			machineId: "mach_air",
		});
		const error = await intruder.waitFor("error");
		// Machine ids are scoped per account, so another account's id is not
		// "forbidden" — it does not exist at all, and says so indistinguishably
		// from an id nobody ever registered.
		expect(error.code).toBe("machine_not_found");
		const closed = await intruder.waitForClose();
		expect(closed.code).toBe(RELAY_CLOSE_CODES.machine_not_found);
		// No channel was ever created, so not one byte could have crossed.
		expect(intruder.framesOfType("client.connected")).toEqual([]);
		expect(relay.stats().channels).toBe(0);
		expect(relay.stats().framesRelayed).toBe(0);
	});

	it("refuses 'newest' for an account with no machines even while another account has one", async () => {
		const relay = await startRelay();
		track(
			await connectEchoHost({
				relayUrl: relay.url,
				token: ACCOUNT_A_TOKEN,
				machineId: "mach_air",
			}),
		);
		const intruder = track(
			await connectRawPeer({
				relayUrl: relay.url,
				role: "client",
				token: ACCOUNT_B_TOKEN,
			}),
		);
		intruder.send({
			t: "client.connect",
			protocolVersion: "relay-v1",
			machineId: RELAY_NEWEST_MACHINE,
		});
		const error = await intruder.waitFor("error");
		expect(error.code).toBe("machine_not_found");
	});

	it("keeps a host claiming another account's machine id in its own namespace", async () => {
		const relay = await startRelay();
		const owner = track(
			await connectEchoHost({
				relayUrl: relay.url,
				token: ACCOUNT_A_TOKEN,
				machineId: "mach_air",
				label: "the real MacBook Air",
			}),
		);
		const impostor = track(
			await connectEchoHost({
				relayUrl: relay.url,
				token: ACCOUNT_B_TOKEN,
				machineId: "mach_air",
				label: "the impostor",
			}),
		);
		// The claim succeeds — as a DIFFERENT machine. Refusing it instead would
		// hand any account a permanent denial of service over any id it can guess.
		expect(relay.machinesForAccount("acct_a").map((m) => m.label)).toEqual([
			"the real MacBook Air",
		]);
		expect(relay.machinesForAccount("acct_b").map((m) => m.label)).toEqual([
			"the impostor",
		]);

		// And the owner's phone still reaches the owner's machine.
		const phone = track(
			await connectRawPeer({
				relayUrl: relay.url,
				role: "client",
				token: ACCOUNT_A_TOKEN,
			}),
		);
		phone.send({
			t: "client.connect",
			protocolVersion: "relay-v1",
			machineId: "mach_air",
		});
		const connected = await phone.waitFor("client.connected");
		expect(connected.label).toBe("the real MacBook Air");
		phone.send({
			t: "data",
			channelId: connected.channelId,
			seq: 1,
			payload: bytesToBase64(new Uint8Array([1, 2, 3])),
		});
		await phone.waitFor("data");
		// Not one frame reached the impostor's tunnel.
		expect(impostor.framesOfType("data")).toEqual([]);
		void owner;
	});

	it("rejects the upgrade outright without a valid account token", async () => {
		const relay = await startRelay();
		await expect(
			connectRawPeer({
				relayUrl: relay.url,
				role: "client",
				token: "not-a-real-token",
			}),
		).rejects.toThrow(/401/);
		await expect(
			connectRawPeer({
				relayUrl: relay.url,
				role: "host",
				token: "",
				omitAuth: true,
			}),
		).rejects.toThrow(/401/);
	});

	it("accepts either the bearer header or the auth subprotocol", async () => {
		const relay = await startRelay();
		const viaHeader = track(
			await connectRawPeer({
				relayUrl: relay.url,
				role: "host",
				token: ACCOUNT_A_TOKEN,
				authMode: "bearer-header",
			}),
		);
		const viaSubprotocol = track(
			await connectRawPeer({
				relayUrl: relay.url,
				role: "client",
				token: ACCOUNT_A_TOKEN,
				authMode: "relay-subprotocol",
			}),
		);
		expect(viaHeader.socket.readyState).toBe(viaHeader.socket.OPEN);
		expect(viaSubprotocol.socket.readyState).toBe(viaSubprotocol.socket.OPEN);
	});

	it("carries a `workos:<jwt>`-shaped token in the auth subprotocol", async () => {
		// `:` is not legal in a websocket subprotocol, so the credential has to be
		// base64url-encoded or the CLIENT rejects the connection before the relay
		// sees it. This is the production account-token shape.
		const jwtish = "workos:FAKE-header.FAKE-payload.sig";
		const relay = await startRelay({
			verifyAccount: ({ token }) =>
				token === jwtish ? { accountId: "acct_workos" } : undefined,
		});
		const peer = track(
			await connectRawPeer({
				relayUrl: relay.url,
				role: "host",
				token: jwtish,
				authMode: "relay-subprotocol",
			}),
		);
		peer.send({
			t: "host.register",
			protocolVersion: "relay-v1",
			machineId: "mach_workos",
		});
		expect((await peer.waitFor("host.registered")).accountId).toBe(
			"acct_workos",
		);
	});
});

describe("unknown and offline machines", () => {
	it("returns machine_not_found for an id it has never seen", async () => {
		const relay = await startRelay();
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
			machineId: "mach_ghost",
		});
		const error = await client.waitFor("error");
		expect(error.code).toBe("machine_not_found");
		expect((await client.waitForClose()).code).toBe(
			RELAY_CLOSE_CODES.machine_not_found,
		);
	});

	it("returns machine_offline once a known machine's hub goes away", async () => {
		const relay = await startRelay();
		const host = await connectEchoHost({
			relayUrl: relay.url,
			token: ACCOUNT_A_TOKEN,
			machineId: "mach_air",
		});
		host.close();
		await host.waitForClose();
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
		expect(error.code).toBe("machine_offline");
	});

	it("refuses a relay protocol version it does not speak", async () => {
		const relay = await startRelay();
		const client = track(
			await connectRawPeer({
				relayUrl: relay.url,
				role: "client",
				token: ACCOUNT_A_TOKEN,
			}),
		);
		client.send({
			t: "client.connect",
			protocolVersion: "relay-v99",
			machineId: "mach_air",
		});
		const error = await client.waitFor("error");
		expect(error.code).toBe("protocol_version_unsupported");
	});
});

describe("teardown", () => {
	it("tears the client down when the host disconnects", async () => {
		const events: RelayServerEvent[] = [];
		const relay = await startRelay({}, events);
		const host = await connectEchoHost({
			relayUrl: relay.url,
			token: ACCOUNT_A_TOKEN,
			machineId: "mach_air",
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
		await client.waitFor("client.connected");

		host.close();
		const channelClose = await client.waitFor("channel.close");
		expect(channelClose.code).toBe("machine_gone");
		const closed = await client.waitForClose();
		expect(closed.code).toBe(RELAY_CLOSE_CODES.machine_gone);
		expect(relay.stats().channels).toBe(0);
		expect(
			events.find((event) => event.type === "host.disconnected"),
		).toMatchObject({ machineId: "mach_air", channelsTornDown: 1 });
	});

	it("tells the host when the client disconnects", async () => {
		const relay = await startRelay();
		const host = track(
			await connectEchoHost({
				relayUrl: relay.url,
				token: ACCOUNT_A_TOKEN,
				machineId: "mach_air",
			}),
		);
		const client = await connectRawPeer({
			relayUrl: relay.url,
			role: "client",
			token: ACCOUNT_A_TOKEN,
		});
		client.send({
			t: "client.connect",
			protocolVersion: "relay-v1",
			machineId: "mach_air",
		});
		const connected = await client.waitFor("client.connected");
		client.close();
		const closed = await host.waitFor(
			"channel.close",
			(frame) => frame.channelId === connected.channelId,
		);
		expect(closed.code).toBe("client_gone");
		// The host survives: only the channel died.
		expect(host.socket.readyState).toBe(host.socket.OPEN);
		expect(relay.stats().channels).toBe(0);
	});

	it("drops a socket that never finishes its handshake", async () => {
		const relay = await startRelay({ handshakeTimeoutMs: 100 });
		const silent = track(
			await connectRawPeer({
				relayUrl: relay.url,
				role: "client",
				token: ACCOUNT_A_TOKEN,
			}),
		);
		const error = await silent.waitFor("error");
		expect(error.code).toBe("handshake_timeout");
	});

	it("drops a socket that stops answering heartbeats", async () => {
		// An injected clock, not a real 75s wait. `ws` auto-answers websocket pings,
		// so liveness is only lost once the clock jumps past the window between two
		// sweeps — exactly what a wedged network path looks like.
		let clock = Date.now();
		const relay = await startRelay({
			heartbeatIntervalMs: 25,
			heartbeatTimeoutMs: 1_000,
			now: () => clock,
		});
		const peer = track(
			await connectRawPeer({
				relayUrl: relay.url,
				role: "client",
				token: ACCOUNT_A_TOKEN,
			}),
		);
		clock += 60_000;
		const closed = await peer.waitForClose();
		expect(closed.code).toBe(RELAY_CLOSE_CODES.heartbeat_timeout);
	});
});

describe("frame caps and abuse control", () => {
	it("refuses an oversized payload with a typed error", async () => {
		const relay = await startRelay({ maxPayloadBytes: 1024 });
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
		client.send({
			t: "data",
			channelId: connected.channelId,
			seq: 1,
			payload: bytesToBase64(randomBytes(4096)),
		});
		const error = await client.waitFor("error");
		expect(error.code).toBe("frame_too_large");
		expect((await client.waitForClose()).code).toBe(
			RELAY_CLOSE_CODES.frame_too_large,
		);
		expect(relay.stats().framesRelayed).toBe(0);
	});

	it("closes the channel on a replayed (non-advancing) seq", async () => {
		const relay = await startRelay();
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
		const frame = {
			t: "data" as const,
			channelId: connected.channelId,
			seq: 1,
			payload: bytesToBase64(randomBytes(16)),
		};
		client.send(frame);
		await client.waitFor("data");
		// Byte-identical replay of a frame the relay already forwarded.
		client.send(frame);
		const channelClose = await client.waitFor("channel.close");
		expect(channelClose.code).toBe("replayed_frame");
		// Both sides are told, so neither leaks a half-open channel.
		expect(
			(
				await host.waitFor(
					"channel.close",
					(f) => f.channelId === frame.channelId,
				)
			).code,
		).toBe("replayed_frame");
		expect(relay.stats().channels).toBe(0);
	});

	it("rejects a data frame naming a channel the socket does not own", async () => {
		const relay = await startRelay();
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
		await client.waitFor("client.connected");
		client.send({
			t: "data",
			channelId: "chn_someone_else",
			seq: 1,
			payload: "",
		});
		const error = await client.waitFor("error");
		expect(error.code).toBe("unknown_channel");
	});

	it("rejects a malformed frame", async () => {
		const relay = await startRelay();
		const client = track(
			await connectRawPeer({
				relayUrl: relay.url,
				role: "client",
				token: ACCOUNT_A_TOKEN,
			}),
		);
		client.sendRaw("this is not a relay frame");
		const error = await client.waitFor("error");
		expect(error.code).toBe("malformed_frame");
	});

	it("enforces the per-account client connection limit", async () => {
		const events: RelayServerEvent[] = [];
		const relay = await startRelay(
			{ limits: { maxClientsPerAccount: 2 } },
			events,
		);
		track(
			await connectRawPeer({
				relayUrl: relay.url,
				role: "client",
				token: ACCOUNT_A_TOKEN,
			}),
		);
		track(
			await connectRawPeer({
				relayUrl: relay.url,
				role: "client",
				token: ACCOUNT_A_TOKEN,
			}),
		);
		await expect(
			connectRawPeer({
				relayUrl: relay.url,
				role: "client",
				token: ACCOUNT_A_TOKEN,
			}),
		).rejects.toThrow(/429/);
		// The cap is per account, so a different account is unaffected.
		track(
			await connectRawPeer({
				relayUrl: relay.url,
				role: "client",
				token: ACCOUNT_B_TOKEN,
			}),
		);
		expect(
			events.find(
				(event) =>
					event.type === "rejected" && event.code === "connection_limit",
			),
		).toBeDefined();
	});

	it("enforces the per-account host limit and the per-machine channel limit", async () => {
		const relay = await startRelay({
			limits: { maxHostsPerAccount: 1, maxChannelsPerMachine: 1 },
		});
		track(
			await connectEchoHost({
				relayUrl: relay.url,
				token: ACCOUNT_A_TOKEN,
				machineId: "mach_air",
			}),
		);
		await expect(
			connectRawPeer({
				relayUrl: relay.url,
				role: "host",
				token: ACCOUNT_A_TOKEN,
			}),
		).rejects.toThrow(/429/);

		const first = track(
			await connectRawPeer({
				relayUrl: relay.url,
				role: "client",
				token: ACCOUNT_A_TOKEN,
			}),
		);
		first.send({
			t: "client.connect",
			protocolVersion: "relay-v1",
			machineId: "mach_air",
		});
		await first.waitFor("client.connected");

		const second = track(
			await connectRawPeer({
				relayUrl: relay.url,
				role: "client",
				token: ACCOUNT_A_TOKEN,
			}),
		);
		second.send({
			t: "client.connect",
			protocolVersion: "relay-v1",
			machineId: "mach_air",
		});
		const error = await second.waitFor("error");
		expect(error.code).toBe("channel_limit");
	});
});

describe("observability", () => {
	it("logs frame metadata only — never payload contents", async () => {
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
		const secret = bytesToBase64(new TextEncoder().encode("TOP-SECRET-PROMPT"));
		client.send({
			t: "data",
			channelId: connected.channelId,
			seq: 1,
			payload: secret,
		});
		await client.waitFor("data");

		const frameEvents = events.filter((event) => event.type === "frame");
		expect(frameEvents.length).toBeGreaterThan(0);
		const serialized = JSON.stringify(events);
		expect(serialized).not.toContain(secret);
		expect(serialized).not.toContain("TOP-SECRET-PROMPT");
		for (const event of frameEvents) {
			expect(Object.keys(event).sort()).toEqual([
				"bytes",
				"channelId",
				"direction",
				"type",
			]);
		}
	});
});
