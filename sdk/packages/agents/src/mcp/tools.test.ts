import { describe, expect, it, vi } from "vitest";
import { createMcpTools } from "./tools.js";
import type { McpToolDescriptor, McpToolProvider } from "./types.js";

describe("createMcpTools", () => {
	it("converts MCP tools into agent tools and delegates execution", async () => {
		const descriptors: readonly McpToolDescriptor[] = [
			{
				name: "search_docs",
				description: "Search documentation",
				inputSchema: {
					type: "object",
					properties: { query: { type: "string" } },
					required: ["query"],
				},
			},
		];
		const provider: McpToolProvider = {
			listTools: vi.fn(async () => descriptors),
			callTool: vi.fn(async (request) => ({ ok: true, request })),
		};

		const tools = await createMcpTools({
			serverName: "docs",
			provider,
			timeoutMs: 12000,
		});

		expect(tools).toHaveLength(1);
		expect(tools[0].name).toBe("docs__search_docs");
		expect(tools[0].description).toBe("Search documentation");
		expect(tools[0].inputSchema.required).toEqual(["query"]);
		expect(tools[0].timeoutMs).toBe(12000);

		const result = await tools[0].execute(
			{ query: "mcp auth" },
			{
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			},
		);

		expect(result).toMatchObject({ ok: true });
		expect(provider.callTool).toHaveBeenCalledWith(
			expect.objectContaining({
				serverName: "docs",
				toolName: "search_docs",
				arguments: { query: "mcp auth" },
			}),
		);
	});

	it("supports custom MCP tool name transforms", async () => {
		const provider: McpToolProvider = {
			listTools: async () => [
				{
					name: "list_files",
					inputSchema: {
						type: "object",
						properties: {},
					},
				},
			],
			callTool: async () => ({ ok: true }),
		};

		const tools = await createMcpTools({
			serverName: "workspace",
			provider,
			nameTransform: ({ serverName, toolName }) => `${toolName}@${serverName}`,
		});

		expect(tools[0].name).toBe("list_files@workspace");
	});

	it("sanitizes default MCP tool names for provider APIs with stricter validation", async () => {
		const provider: McpToolProvider = {
			listTools: async () => [
				{
					name: "list_issues",
					inputSchema: {
						type: "object",
						properties: {},
					},
				},
			],
			callTool: async () => ({ ok: true }),
		};

		const tools = await createMcpTools({
			serverName: "github.com/cline/linear-mcp",
			provider,
		});

		expect(tools[0].name).toMatch(
			/^github_com_cline_linear-mcp__list_issues_[a-f0-9]{8}$/,
		);
		expect(tools[0].name).toHaveLength(49);
	});
});
