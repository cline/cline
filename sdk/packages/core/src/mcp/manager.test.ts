import { describe, expect, it, vi } from "vitest";
import { InMemoryMcpManager } from "./manager";
import type { McpServerClient, McpToolDescriptor } from "./types";

function createClient(overrides?: Partial<McpServerClient>): McpServerClient {
	return {
		connect: vi.fn(async () => {}),
		disconnect: vi.fn(async () => {}),
		listTools: vi.fn(async () => []),
		callTool: vi.fn(async () => ({ ok: true })),
		...overrides,
	};
}

describe("InMemoryMcpManager", () => {
	it("registers servers, connects on demand, and calls tools", async () => {
		const toolDescriptors: readonly McpToolDescriptor[] = [
			{
				name: "search",
				inputSchema: {
					type: "object",
					properties: { q: { type: "string" } },
					required: ["q"],
				},
			},
		];
		const client = createClient({
			listTools: vi.fn(async () => toolDescriptors),
		});
		const manager = new InMemoryMcpManager({
			clientFactory: vi.fn(async () => client),
		});

		await manager.registerServer({
			name: "docs",
			transport: {
				type: "streamableHttp",
				url: "https://mcp.example.test",
			},
		});

		const tools = await manager.listTools("docs");
		expect(tools).toHaveLength(1);

		await manager.callTool({
			serverName: "docs",
			toolName: "search",
			arguments: { q: "oauth flow" },
		});

		expect(client.connect).toHaveBeenCalledTimes(1);
		expect(client.callTool).toHaveBeenCalledWith({
			name: "search",
			arguments: { q: "oauth flow" },
			context: undefined,
		});
	});

	it("uses tool list cache to avoid repeated listTools round trips", async () => {
		const toolDescriptors: readonly McpToolDescriptor[] = [
			{
				name: "echo",
				inputSchema: { type: "object", properties: {} },
			},
		];
		const client = createClient({
			listTools: vi.fn(async () => toolDescriptors),
		});
		const manager = new InMemoryMcpManager({
			clientFactory: async () => client,
			toolsCacheTtlMs: 60_000,
		});

		await manager.registerServer({
			name: "cache-test",
			transport: {
				type: "stdio",
				command: "node",
				args: ["./mcp.js"],
			},
		});

		await manager.listTools("cache-test");
		await manager.listTools("cache-test");
		expect(client.listTools).toHaveBeenCalledTimes(1);
	});

	it("prevents tool calls on disabled servers", async () => {
		const manager = new InMemoryMcpManager({
			clientFactory: async () => createClient(),
		});
		await manager.registerServer({
			name: "disabled",
			transport: { type: "sse", url: "https://example.test/sse" },
			disabled: true,
		});

		await expect(
			manager.callTool({
				serverName: "disabled",
				toolName: "anything",
			}),
		).rejects.toThrow(/disabled/i);
	});
});
