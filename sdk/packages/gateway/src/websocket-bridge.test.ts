import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { GatewayServer } from "./server";
import { ScriptedEnginePort, tempDataRoot } from "./test-support";
import { startGatewayWebSocketBridge } from "./websocket-bridge";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function nextMessage(socket: WebSocket): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		socket.once("message", (data) => resolve(JSON.parse(data.toString())));
		socket.once("error", reject);
	});
}

describe("Gateway WebSocket bridge", () => {
	it("authenticates gateway.hello and forwards protocol frames", async () => {
		const dataRoot = tempDataRoot();
		const gateway = await GatewayServer.start({
			dataRoot,
			namespace: "default",
			engine: new ScriptedEnginePort(),
		});
		cleanups.push(() => gateway.stop("graceful"));
		const bridge = await startGatewayWebSocketBridge({
			dataRoot,
			namespace: "default",
			port: 0,
			allowedOrigins: ["https://app.example.com"],
		});
		cleanups.push(() => bridge.stop());

		const socket = new WebSocket(`ws://127.0.0.1:${bridge.port}/`, {
			origin: "https://app.example.com",
		});
		await new Promise<void>((resolve, reject) => {
			socket.once("open", resolve);
			socket.once("error", reject);
		});
		cleanups.push(async () => socket.close());
		const hello = {
			version: 1,
			id: "hello_1",
			method: "gateway.hello",
			params: {
				protocolVersions: [1],
				client: { name: "web-test", version: "0.0.1" },
				auth: gateway.discovery?.auth,
			},
		};
		socket.send(JSON.stringify(hello));
		expect(await nextMessage(socket)).toMatchObject({ id: "hello_1", result: { protocolVersion: 1 } });

		socket.send(JSON.stringify({ version: 1, id: "status_1", method: "gateway.status" }));
		expect(await nextMessage(socket)).toMatchObject({ id: "status_1", result: { state: "serving" } });
	});

	it("rejects untrusted origins before upgrade", async () => {
		const dataRoot = tempDataRoot();
		const bridge = await startGatewayWebSocketBridge({
			dataRoot,
			port: 0,
			allowedOrigins: ["https://app.example.com"],
		});
		cleanups.push(() => bridge.stop());
		const socket = new WebSocket(`ws://127.0.0.1:${bridge.port}/`, {
			origin: "https://evil.example.com",
		});
		await expect(new Promise<void>((resolve, reject) => {
			socket.once("open", resolve);
			socket.once("error", reject);
		})).rejects.toThrow(/403/);
	});

	it("closes unauthenticated clients without opening the Gateway", async () => {
		const dataRoot = tempDataRoot();
		const bridge = await startGatewayWebSocketBridge({
			dataRoot,
			port: 0,
			allowedOrigins: ["https://app.example.com"],
		});
		cleanups.push(() => bridge.stop());
		const socket = new WebSocket(`ws://127.0.0.1:${bridge.port}/`, {
			origin: "https://app.example.com",
		});
		await new Promise<void>((resolve, reject) => {
			socket.once("open", resolve);
			socket.once("error", reject);
		});
		socket.send(JSON.stringify({ version: 1, id: "status_1", method: "gateway.status" }));
		const close = await new Promise<{ code: number; reason: string }>((resolve) => {
			socket.once("close", (code, reason) => resolve({ code, reason: reason.toString() }));
		});
		expect(close).toEqual({ code: 1008, reason: "Unauthorized" });
	});
});
