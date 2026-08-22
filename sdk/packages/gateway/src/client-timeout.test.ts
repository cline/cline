import { createServer } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { GatewayClient } from "./client";

describe("GatewayClient request deadlines", () => {
	it("closes a silent control channel instead of leaving requests pending", async () => {
		const server = createServer((socket) => {
			let buffer = "";
			socket.setEncoding("utf8");
			socket.on("data", (chunk: string) => {
				buffer += chunk;
				for (;;) {
					const newline = buffer.indexOf("\n");
					if (newline < 0) return;
					const line = buffer.slice(0, newline);
					buffer = buffer.slice(newline + 1);
					const request = JSON.parse(line) as { id: string; method: string };
					if (request.method === "gateway.hello") {
						socket.write(
							`${JSON.stringify({
								version: 1,
								id: request.id,
								result: {
									protocolVersion: 1,
									gatewayId: "gw_12345678",
									instanceId: "gwi_12345678",
									clientId: "cli_12345678",
									capabilities: [],
									catalogGeneration: 1,
								},
							})}\n`,
						);
					}
					// Intentionally leave every post-handshake method unanswered.
				}
			});
		});
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", resolve);
		});
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("test server did not bind a TCP port");
		}

		const client = await GatewayClient.connect({
			host: "127.0.0.1",
			port: address.port,
			auth: "x".repeat(40),
			requestTimeoutMs: 25,
		});
		const onClose = vi.fn();
		client.onClose(onClose);

		try {
			await expect(client.getStatus()).rejects.toMatchObject({
				gatewayError: {
					code: "gateway_unreachable",
					retryable: true,
				},
			});
			expect(onClose).toHaveBeenCalledOnce();
			await expect(client.getStatus()).rejects.toMatchObject({
				gatewayError: { code: "gateway_unreachable" },
			});
		} finally {
			client.close();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});
});
