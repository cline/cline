import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { RuntimeHost } from "../../runtime/host/runtime-host";
import { HubUIClient } from "../client/ui-client";
import { startHubWebSocketServer } from "./hub-websocket-server";

it("shares one device service across app clients, survives app disconnect, and shuts down with the hub", async () => {
	const dir = mkdtempSync(join(tmpdir(), "hub-device-api-"));
	const sessionHost = {
		subscribe: vi.fn(() => () => {}),
		listSessions: vi.fn(async () => []),
		dispose: vi.fn(async () => {}),
		getSession: vi.fn(async () => undefined),
	} as unknown as RuntimeHost;
	const server = await startHubWebSocketServer({
		host: "127.0.0.1",
		port: 0,
		owner: { ownerId: "device-api-test", discoveryPath: join(dir, "hub.json") },
		sessionHost,
		runtimeHandlers: {
			startSession: vi.fn(async () => ({ sessionId: "test-session" })),
			sendSession: vi.fn(async () => ({ result: { text: "" } })),
			abortSession: vi.fn(async () => ({ applied: true })),
			stopSession: vi.fn(async () => ({ applied: true })),
		},
		eventLog: false,
		runQueue: false,
		devices: {
			host: "127.0.0.1",
			port: 0,
			web: false,
			mdns: false,
			dataDir: dir,
			log: () => {},
		},
	});
	const desktop = new HubUIClient({
		address: server.url,
		authToken: server.authToken,
		clientType: "desktop-test",
	});
	const vscode = new HubUIClient({
		address: server.url,
		authToken: server.authToken,
		clientType: "vscode-test",
	});
	let endpoint: string | undefined;
	try {
		await Promise.all([desktop.connect(), vscode.connect()]);
		const first = await desktop.devices();
		endpoint = first.deviceEndpoint;
		expect(first.status).toBe("running");
		expect(endpoint).toBeDefined();
		const other = await vscode.devices("start");
		expect(other.deviceEndpoint).toBe(endpoint);
		const observed = new Promise<void>((resolve) => {
			const unsubscribe = vscode.subscribeDevices((state) => {
				if (state.pairing) {
					unsubscribe();
					resolve();
				}
			});
		});
		const pairing = await desktop.devices("pair");
		await observed;
		expect(pairing.pairing?.code).toMatch(/^\d{6}$/);
		desktop.close();
		expect((await vscode.devices()).status).toBe("running");
		await vscode.devices("stop");
		expect((await vscode.devices()).status).toBe("stopped");
		await vscode.devices("start");
		endpoint = (await vscode.devices()).deviceEndpoint;
	} finally {
		await desktop.dispose();
		await vscode.dispose();
		await server.close();
		rmSync(dir, { recursive: true, force: true });
	}
	await expect(
		fetch(endpoint!.replace("ws:", "http:").replace("/device", "/health")),
	).rejects.toThrow();
});
