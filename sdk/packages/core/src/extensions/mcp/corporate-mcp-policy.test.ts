import { describe, expect, it } from "vitest";
import { createDefaultMcpServerClientFactory } from "./client";

describe("corporate MCP policy", () => {
	it.each([
		"sse",
		"streamableHttp",
	] as const)("blocks %s before any remote connection is attempted", async (type) => {
		const factory = createDefaultMcpServerClientFactory({
			fetch: async () => {
				throw new Error("network must not be reached");
			},
		});
		const client = await factory({
			name: "remote-test",
			transport: {
				type,
				url: "https://example.com/mcp",
			},
		});
		await expect(client.connect()).rejects.toThrow(
			/disabled by the corporate egress policy/i,
		);
	});
});
