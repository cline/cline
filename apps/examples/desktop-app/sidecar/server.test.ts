import { describe, expect, it, vi } from "vitest";
import { createFetchHandler } from "./server";
import type { SidecarContext } from "./types";

function createTestServer() {
	return {
		port: 3126,
		upgrade: vi.fn(() => true),
	};
}

function createHandler(onShutdown = vi.fn()) {
	return createFetchHandler({} as SidecarContext, onShutdown);
}

describe("sidecar HTTP origin checks", () => {
	it("rejects cross-origin shutdown preflight requests", async () => {
		const server = createTestServer();
		const response = await createHandler()(
			new Request("http://127.0.0.1:3126/shutdown", {
				method: "OPTIONS",
				headers: {
					origin: "https://attacker.example",
					"access-control-request-method": "POST",
				},
			}),
			server,
		);

		expect(response?.status).toBe(403);
		expect(response?.headers.get("access-control-allow-origin")).toBeNull();
	});

	it("rejects cross-origin shutdown POST requests", async () => {
		const onShutdown = vi.fn();
		const server = createTestServer();
		const response = await createHandler(onShutdown)(
			new Request("http://127.0.0.1:3126/shutdown", {
				method: "POST",
				headers: {
					origin: "https://attacker.example",
				},
			}),
			server,
		);

		expect(response?.status).toBe(403);
		expect(onShutdown).not.toHaveBeenCalled();
	});

	it("rejects cross-origin websocket upgrades", async () => {
		const server = createTestServer();
		const response = await createHandler()(
			new Request("http://127.0.0.1:3126/transport", {
				headers: {
					origin: "https://attacker.example",
				},
			}),
			server,
		);

		expect(response?.status).toBe(404);
		expect(server.upgrade).not.toHaveBeenCalled();
	});

	it("allows desktop webview origins in preflight responses", async () => {
		const server = createTestServer();
		const response = await createHandler()(
			new Request("http://127.0.0.1:3126/api/marketplace/catalog", {
				method: "OPTIONS",
				headers: {
					origin: "tauri://localhost",
					"access-control-request-method": "GET",
				},
			}),
			server,
		);

		expect(response?.status).toBe(204);
		expect(response?.headers.get("access-control-allow-origin")).toBe(
			"tauri://localhost",
		);
	});
});
