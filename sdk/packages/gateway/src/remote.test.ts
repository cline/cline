import { afterEach, describe, expect, it } from "vitest";
import { GatewayClient } from "./client";
import { validateRemoteOptions } from "./remote";
import { GatewayServer } from "./server";
import { ScriptedEnginePort, tempDataRoot } from "./test-support";

const REMOTE_TOKEN = "remote-test-token-000000000000000000000000";
const servers: GatewayServer[] = [];
const clients: GatewayClient[] = [];

afterEach(async () => {
	for (const client of clients.splice(0)) client.close();
	for (const server of servers.splice(0)) await server.stop("graceful");
});

async function startRemoteServer() {
	const server = await GatewayServer.start({
		dataRoot: tempDataRoot("clinegate-remote-"),
		engine: new ScriptedEnginePort(),
		remote: {
			host: "127.0.0.1",
			port: 0,
			accessToken: REMOTE_TOKEN,
		},
	});
	servers.push(server);
	const remote = server.remoteAddress();
	if (!remote) throw new Error("remote listener was not started");
	return { server, remote };
}

describe("remote Gateway transport", () => {
	it("connects over WebSocket and exposes only the public endpoint", async () => {
		const { server, remote } = await startRemoteServer();
		const client = await GatewayClient.connectRemote({
			url: remote.url,
			auth: REMOTE_TOKEN,
			clientName: "remote-test",
		});
		clients.push(client);
		const status = (await client.request("gateway.status")) as {
			remote: { url: string; secure: boolean };
		};
		expect(client.hello.instanceId).toBe(server.instanceId);
		expect(status.remote).toEqual(
			expect.objectContaining({ url: remote.url, secure: false }),
		);
		expect(JSON.stringify(status)).not.toContain(REMOTE_TOKEN);
		expect(JSON.stringify(status)).not.toContain(server.discovery?.auth);
	});

	it("keeps local discovery and remote credentials in separate trust domains", async () => {
		const { server, remote } = await startRemoteServer();
		await expect(
			GatewayClient.connectRemote({
				url: remote.url,
				auth: server.discovery?.auth ?? "",
			}),
		).rejects.toMatchObject({ gatewayError: { code: "unauthorized" } });
		await expect(
			GatewayClient.connectRemote({ url: remote.url, auth: "x".repeat(40) }),
		).rejects.toMatchObject({ gatewayError: { code: "unauthorized" } });
	});

	it("requires TLS for non-loopback listeners unless explicitly overridden", () => {
		expect(() =>
			validateRemoteOptions({
				host: "0.0.0.0",
				port: 443,
				accessToken: REMOTE_TOKEN,
			}),
		).toThrow(/requires TLS/);
		expect(() =>
			validateRemoteOptions({
				host: "0.0.0.0",
				port: 8080,
				accessToken: REMOTE_TOKEN,
				allowInsecure: true,
			}),
		).not.toThrow();
	});

	it("rejects short remote access tokens", () => {
		expect(() =>
			validateRemoteOptions({
				port: 0,
				accessToken: "too-short",
			}),
		).toThrow(/at least 32 bytes/);
	});
});
