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

	it("redacts secret-bearing connection diagnostics", async () => {
		const manager = new InMemoryMcpManager({
			clientFactory: async () =>
				createClient({
					connect: vi.fn(async () => {
						throw new Error("Failed with access_token=token-secret");
					}),
				}),
		});
		await manager.registerServer({
			name: "secret-error",
			transport: { type: "sse", url: "https://example.test/sse" },
		});

		await expect(manager.connectServer("secret-error")).rejects.toThrow(
			"Failed with access_token=[REDACTED]",
		);

		expect(manager.listServers()[0]?.lastError).toBe(
			"Failed with access_token=[REDACTED]",
		);
	});

	it("preserves error identity and metadata while redacting diagnostics", async () => {
		class CodedMcpError extends Error {
			readonly code = "MCP_AUTH_FAILED";
		}

		const cause = new Error("cause password=cause-secret");
		const originalError = new CodedMcpError(
			"request failed: Bearer caller-secret",
			{ cause },
		);
		const manager = new InMemoryMcpManager({
			clientFactory: async () =>
				createClient({
					listTools: vi.fn(async () => {
						throw originalError;
					}),
				}),
		});
		await manager.registerServer({
			name: "typed-error",
			transport: { type: "stdio", command: "mcp-server" },
		});

		let caught: unknown;
		try {
			await manager.listTools("typed-error");
		} catch (error) {
			caught = error;
		}

		expect(caught).toBe(originalError);
		expect(caught).toBeInstanceOf(CodedMcpError);
		expect((caught as CodedMcpError).code).toBe("MCP_AUTH_FAILED");
		expect((caught as Error).message).toBe("request failed: Bearer [REDACTED]");
		expect((caught as Error).stack).not.toContain("caller-secret");
		expect((caught as Error).cause).toBe(cause);
		expect(cause.message).toBe("cause password=[REDACTED]");
		expect(cause.stack).not.toContain("cause-secret");
	});

	it.each([
		[
			"tool call",
			"request failed: Bearer tool-call-secret",
			"request failed: Bearer [REDACTED]",
		],
		[
			"disconnect",
			"disconnect failed: session_token=session-secret",
			"disconnect failed: session_token=[REDACTED]",
		],
	] as const)("redacts secret-bearing %s errors returned to callers", async (operation, rawError, expectedError) => {
		const failingOperation = vi.fn(async () => {
			throw new Error(rawError);
		});
		const manager = new InMemoryMcpManager({
			clientFactory: async () =>
				createClient(
					operation === "tool call"
						? { callTool: failingOperation }
						: { disconnect: failingOperation },
				),
		});
		await manager.registerServer({
			name: "operation-error",
			transport: { type: "stdio", command: "mcp-server" },
		});

		if (operation === "disconnect") {
			await manager.connectServer("operation-error");
		}
		const result =
			operation === "tool call"
				? manager.callTool({
						serverName: "operation-error",
						toolName: "search",
					})
				: manager.disconnectServer("operation-error");

		await expect(result).rejects.toThrow(expectedError);
	});
});
