import { afterEach, describe, expect, it } from "vitest";
import { resolveHubWebSocketRuntime } from "./hub-websocket-server";

describe("hub websocket runtime selection", () => {
	const original = process.env.CLINE_HUB_WEBSOCKET_RUNTIME;
	afterEach(() => {
		if (original === undefined) {
			delete process.env.CLINE_HUB_WEBSOCKET_RUNTIME;
		} else {
			process.env.CLINE_HUB_WEBSOCKET_RUNTIME = original;
		}
	});

	it("honors an explicit node/bun override, case-insensitively", () => {
		process.env.CLINE_HUB_WEBSOCKET_RUNTIME = "node";
		expect(resolveHubWebSocketRuntime()).toBe("node");
		process.env.CLINE_HUB_WEBSOCKET_RUNTIME = "BUN";
		expect(resolveHubWebSocketRuntime()).toBe("bun");
	});

	it("ignores an unrecognized override and falls back to the host runtime", () => {
		process.env.CLINE_HUB_WEBSOCKET_RUNTIME = "deno";
		const expected =
			typeof (globalThis as { Bun?: unknown }).Bun !== "undefined"
				? "bun"
				: "node";
		expect(resolveHubWebSocketRuntime()).toBe(expected);
	});

	it("defaults to the runtime that owns the process", () => {
		delete process.env.CLINE_HUB_WEBSOCKET_RUNTIME;
		const expected =
			typeof (globalThis as { Bun?: unknown }).Bun !== "undefined"
				? "bun"
				: "node";
		expect(resolveHubWebSocketRuntime()).toBe(expected);
	});
});
