import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeviceRegistry } from "./pairing";
import { startDeviceBridge } from "./runtime";
import { parseDeviceBridgeStatus } from "./status";

describe("device bridge runtime", () => {
	it("uses the supplied hub and publishes only authenticated device connections", async () => {
		const dir = mkdtempSync(join(tmpdir(), "bridge-runtime-"));
		const registry = new DeviceRegistry(join(dir, "devices.json"));
		const { code } = registry.issueCode();
		const token = registry.pair(code, "test desk device")!;
		const commands: string[] = [];
		const hub = Bun.serve({
			port: 0,
			hostname: "127.0.0.1",
			fetch(req, server) {
				if (server.upgrade(req)) return;
				return new Response(null, { status: 426 });
			},
			websocket: {
				message(ws, raw) {
					const frame = JSON.parse(String(raw));
					if (frame.kind !== "command") return;
					const request = frame.envelope;
					commands.push(request.command);
					ws.send(
						JSON.stringify({
							kind: "reply",
							envelope: {
								version: "v1",
								command: request.command,
								requestId: request.requestId,
								clientId: "test-hub",
								ok: true,
								payload: { sessions: [] },
							},
						}),
					);
				},
			},
		});
		let runtime: Awaited<ReturnType<typeof startDeviceBridge>> | undefined;
		let socket: WebSocket | undefined;
		try {
			const hubUrl = `ws://127.0.0.1:${hub.port}/hub`;
			runtime = await startDeviceBridge({
				hub: { url: hubUrl, authToken: "test-secret" },
				host: "127.0.0.1",
				port: 0,
				web: false,
				mdns: false,
				registry,
				log() {},
			});
			expect(runtime.status()).toMatchObject({
				hubUrl,
				hubConnected: true,
				devices: [],
			});
			runtime.pair();
			const pairing = runtime.pairingCode()!;
			expect(pairing.code).toMatch(/^\d{6}$/);
			const url = runtime.status().deviceEndpoint;
			socket = new WebSocket(url);
			await new Promise<void>((resolve, reject) => {
				socket!.onopen = () => resolve();
				socket!.onerror = () => reject(new Error("connection failed"));
			});
			expect(runtime.status().devices).toEqual([]);
			const welcomed = new Promise<void>((resolve) => {
				socket!.onmessage = (event) => {
					if (JSON.parse(String(event.data)).t === "welcome") resolve();
				};
			});
			socket.send(JSON.stringify({ t: "hello", token }));
			await welcomed;
			expect(runtime.status().devices).toEqual(["test desk device"]);
			const response = await fetch(
				url.replace("ws:", "http:").replace("/device", "/health"),
			);
			const data = await response.json();
			expect(parseDeviceBridgeStatus(data)).toMatchObject({
				hubUrl,
				devices: ["test desk device"],
			});
			expect(JSON.stringify(data)).not.toContain("test-secret");
			expect(JSON.stringify(data)).not.toContain(token);
			expect(JSON.stringify(data)).not.toContain(pairing.code);
			expect(registry.pair(pairing.code, "new device")).toBeDefined();
			expect(runtime.pairingCode()).toBeUndefined();
			expect(commands).toContain("client.register");
			const closed = new Promise<void>((resolve) => {
				socket!.onclose = () => resolve();
			});
			socket.close();
			await closed;
			await Bun.sleep(10);
			expect(runtime.status().devices).toEqual([]);
			await runtime.stop();
			await runtime.stop();
			expect(runtime.status().hubConnected).toBe(false);
			const replacement = Bun.serve({
				port: Number(new URL(url).port),
				hostname: "127.0.0.1",
				fetch: () => new Response("released"),
			});
			await replacement.stop(true);
		} finally {
			socket?.close();
			await runtime?.stop();
			hub.stop(true);
			rmSync(dir, { recursive: true, force: true });
		}
	});
	it("rejects malformed status and executable endpoint URLs", () => {
		expect(
			parseDeviceBridgeStatus({
				service: "cline-device-bridge",
				hubUrl: "ws://localhost/hub",
				hubConnected: true,
				deviceEndpoint: "ws://localhost/device",
				browserEndpoint: "javascript:alert(1)",
				devices: [],
			}),
		).toBeUndefined();
		expect(parseDeviceBridgeStatus({ ok: true, v: 1 })).toBeUndefined();
	});
});

describe("dashboard pairing code lifecycle", () => {
	it("expires codes and invalidates consumed codes", () => {
		const dir = mkdtempSync(join(tmpdir(), "bridge-pairing-"));
		let now = 1000;
		const registry = new DeviceRegistry(join(dir, "devices.json"), () => now);
		try {
			const first = registry.issueCode();
			expect(registry.pairingCode()).toEqual(first);
			now = first.expiresAt;
			expect(registry.pairingCode()).toBeUndefined();
			expect(registry.pair(first.code, "expired")).toBeUndefined();
			const next = registry.issueCode();
			expect(registry.pairingCode()).toEqual(next);
			expect(registry.pair(next.code, "paired")).toBeDefined();
			expect(registry.pairingCode()).toBeUndefined();
			expect(registry.pair(next.code, "reused")).toBeUndefined();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
