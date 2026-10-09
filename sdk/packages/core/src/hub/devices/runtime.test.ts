import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { NativeHubTransport } from "../server/native-transport";
import { DeviceRegistry } from "./pairing";
import { startDeviceService } from "./runtime";
import { parseDeviceServiceStatus } from "./status";

it("runs inside the hub through native commands, exposes no pairing secrets over HTTP, and releases listeners", async () => {
	const dir = mkdtempSync(join(tmpdir(), "hub-devices-"));
	const registry = new DeviceRegistry(join(dir, "devices.json"));
	const token = registry.pair(registry.issueCode().code, "desk")!;
	const commands: string[] = [];
	const transport: NativeHubTransport = {
		subscribe: () => () => {},
		handleCommand: async (envelope) => {
			commands.push(envelope.command);
			return {
				version: "v1",
				ok: true,
				requestId: envelope.requestId,
				payload: { sessions: [] },
			};
		},
	};
	const runtime = await startDeviceService({
		transport,
		hubUrl: "ws://localhost/hub",
		host: "127.0.0.1",
		port: 0,
		web: false,
		mdns: false,
		dataDir: dir,
		registry,
		log: () => {},
	});
	let socket: WebSocket | undefined;
	try {
		runtime.pair();
		const pairing = runtime.pairingCode()!;
		socket = new WebSocket(runtime.status().deviceEndpoint);
		await new Promise<void>((resolve, reject) => {
			socket!.onopen = () => resolve();
			socket!.onerror = reject;
		});
		const welcomed = new Promise<void>((resolve) => {
			socket!.onmessage = (event) => {
				if (JSON.parse(String(event.data)).t === "welcome") resolve();
			};
		});
		socket.send(JSON.stringify({ t: "hello", token }));
		await welcomed;
		expect(runtime.status().devices).toEqual(["desk"]);
		const response = await fetch(
			runtime
				.status()
				.deviceEndpoint.replace("ws:", "http:")
				.replace("/device", "/health"),
		);
		const data = await response.json();
		expect(parseDeviceServiceStatus(data)).toMatchObject({
			devices: ["desk"],
			service: "cline-device-service",
		});
		expect(JSON.stringify(data)).not.toContain(token);
		expect(JSON.stringify(data)).not.toContain(pairing.code);
		expect(commands).toContain("client.register");
		expect(commands).toContain("session.list");
		await runtime.stop();
		await runtime.stop();
		expect(runtime.status().hubConnected).toBe(false);
		expect(commands.filter((c) => c === "client.unregister")).toHaveLength(1);
	} finally {
		socket?.close();
		await runtime.stop();
		rmSync(dir, { recursive: true, force: true });
	}
});
it("rejects executable endpoint URLs", () => {
	expect(
		parseDeviceServiceStatus({
			service: "cline-device-service",
			hubUrl: "ws://localhost/hub",
			hubConnected: true,
			deviceEndpoint: "ws://localhost/device",
			browserEndpoint: "javascript:alert(1)",
			devices: [],
		}),
	).toBeUndefined();
});
describe("pairing lifecycle", () => {
	it("expires and consumes codes", () => {
		const dir = mkdtempSync(join(tmpdir(), "hub-pair-"));
		let now = 1000;
		try {
			const registry = new DeviceRegistry(join(dir, "devices.json"), () => now);
			const first = registry.issueCode();
			now += 300001;
			expect(registry.pairingCode()).toBeUndefined();
			expect(registry.pair(first.code, "expired")).toBeUndefined();
			const next = registry.issueCode();
			expect(registry.pair(next.code, "desk")).toBeDefined();
			expect(registry.pairingCode()).toBeUndefined();
			expect(registry.pair(next.code, "again")).toBeUndefined();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
