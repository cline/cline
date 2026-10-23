import { describe, expect, it } from "vitest";
import { resolveLocalTransport } from "./local-transport";

describe("resolveLocalTransport", () => {
	it("rejects a saved bearer-token connection over plaintext LAN WebSockets", async () => {
		await expect(
			resolveLocalTransport({
				mode: "local",
				url: "ws://192.168.1.20:4599/hub",
				authToken: "durable-secret",
				credentialKind: "hub-token",
			}),
		).rejects.toThrow(/use wss:\/\//i);
	});

	it("keeps loopback development connections working", async () => {
		await expect(
			resolveLocalTransport({
				mode: "local",
				url: "ws://127.0.0.1:4599/hub",
				authToken: "local-secret",
			}),
		).resolves.toMatchObject({
			authMode: "hub-subprotocol",
			authToken: "local-secret",
		});
	});

	it("allows authenticated remote hubs over TLS", async () => {
		await expect(
			resolveLocalTransport({
				mode: "local",
				url: "wss://hub.example.test/hub",
				authToken: "remote-secret",
			}),
		).resolves.toMatchObject({ authMode: "hub-subprotocol" });
	});
});
