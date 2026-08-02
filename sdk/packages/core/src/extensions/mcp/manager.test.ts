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

	it("retains and disconnects a client whose initialization fails", async () => {
		const connectError = new Error("initialize failed");
		const client = createClient({
			connect: vi.fn(async () => {
				throw connectError;
			}),
		});
		const manager = new InMemoryMcpManager({
			clientFactory: async () => client,
		});
		await manager.registerServer({
			name: "slow-start",
			transport: { type: "stdio", command: "node" },
		});

		await expect(manager.connectServer("slow-start")).rejects.toBe(
			connectError,
		);
		expect(client.disconnect).toHaveBeenCalledTimes(1);

		await manager.dispose();
		expect(client.disconnect).toHaveBeenCalledTimes(2);
	});

	it("replaces the client when its timeout snapshot changes", async () => {
		const firstClient = createClient();
		const secondClient = createClient();
		const clientFactory = vi
			.fn()
			.mockResolvedValueOnce(firstClient)
			.mockResolvedValueOnce(secondClient);
		const manager = new InMemoryMcpManager({ clientFactory });
		const registration = {
			name: "timeout-change",
			transport: {
				type: "stdio" as const,
				command: "node",
			},
		};

		await manager.registerServer(registration);
		await manager.connectServer(registration.name);
		await manager.registerServer({ ...registration, timeoutSeconds: 60 });

		expect(firstClient.disconnect).toHaveBeenCalledTimes(1);
		await manager.connectServer(registration.name);
		expect(clientFactory).toHaveBeenCalledTimes(2);
		expect(secondClient.connect).toHaveBeenCalledTimes(1);
	});

	it("preserves the client when re-registration keeps the same timeout snapshot", async () => {
		const client = createClient();
		const clientFactory = vi.fn(async () => client);
		const manager = new InMemoryMcpManager({ clientFactory });
		const registration = {
			name: "same-timeout",
			transport: {
				type: "stdio" as const,
				command: "node",
			},
			timeoutSeconds: 60_000,
		};

		await manager.registerServer(registration);
		await manager.connectServer(registration.name);
		await manager.registerServer({ ...registration, timeoutSeconds: 3_600 });

		expect(client.disconnect).not.toHaveBeenCalled();
		await manager.connectServer(registration.name);
		expect(clientFactory).toHaveBeenCalledTimes(1);
	});
});
