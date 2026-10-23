import { afterEach, describe, expect, it } from "vitest";
import {
	connectEchoHost,
	connectRawPeer,
	type RawRelayPeer,
} from "../testing/raw-peer";
import { createRelayServer, type RelayServer } from "./server";

describe("machine-scoped relay accounts", () => {
	let relay: RelayServer | undefined;
	const peers: RawRelayPeer[] = [];

	afterEach(async () => {
		for (const peer of peers) peer.close();
		await relay?.close();
	});

	it("rejects a host registration for another machine", async () => {
		relay = await createRelayServer({
			verifyAccount: () => ({
				accountId: "usr-local",
				machineId: "machine-allowed",
			}),
		});
		const host = await connectRawPeer({
			relayUrl: relay.url,
			role: "host",
			token: "ticket",
		});
		peers.push(host);
		host.send({
			t: "host.register",
			protocolVersion: "relay-v1",
			machineId: "machine-other",
		});
		await expect(host.waitFor("error")).resolves.toMatchObject({
			code: "unauthorized",
		});
	});

	it("rejects a client connect for another machine", async () => {
		relay = await createRelayServer({
			verifyAccount: () => ({
				accountId: "usr-local",
				machineId: "machine-allowed",
			}),
		});
		const host = await connectEchoHost({
			relayUrl: relay.url,
			token: "host-ticket",
			machineId: "machine-allowed",
		});
		peers.push(host);
		const client = await connectRawPeer({
			relayUrl: relay.url,
			role: "client",
			token: "client-ticket",
		});
		peers.push(client);
		client.send({
			t: "client.connect",
			protocolVersion: "relay-v1",
			machineId: "newest",
		});
		await expect(client.waitFor("error")).resolves.toMatchObject({
			code: "unauthorized",
		});
	});
});
