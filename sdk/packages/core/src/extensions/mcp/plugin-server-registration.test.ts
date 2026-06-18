import { describe, expect, it } from "vitest";
import { normalizePluginMcpServerRegistration } from "./plugin-server-registration";

describe("plugin MCP server registration", () => {
	it("normalizes streamable HTTP plugin MCP servers", () => {
		const result = normalizePluginMcpServerRegistration({
			name: "remote",
			transport: {
				type: "streamableHttp",
				url: "https://example.com/mcp",
				headers: {
					Authorization: "Bearer token",
				},
			},
		});

		expect(result.loadError).toBeUndefined();
		expect(result.registration).toEqual({
			name: "remote",
			transport: {
				type: "streamableHttp",
				url: "https://example.com/mcp",
				headers: {
					Authorization: "Bearer token",
				},
			},
		});
	});

	it("normalizes SSE plugin MCP servers", () => {
		const result = normalizePluginMcpServerRegistration({
			name: "remote-sse",
			transport: {
				type: "sse",
				url: "https://example.com/sse",
			},
		});

		expect(result.loadError).toBeUndefined();
		expect(result.registration).toEqual({
			name: "remote-sse",
			transport: {
				type: "sse",
				url: "https://example.com/sse",
			},
		});
	});

	it("keeps top-level env scoped to stdio transports", () => {
		const result = normalizePluginMcpServerRegistration({
			name: "remote",
			transport: {
				type: "streamableHttp",
				url: "https://example.com/mcp",
			},
			env: {
				TOKEN: {
					fromEnv: "TOKEN",
					required: true,
				},
			},
		});

		expect(result.registration).toBeUndefined();
		expect(result.loadError).toContain(
			"top-level env is only supported for stdio MCP transports",
		);
	});

	it("reports missing stdio command before missing required env", () => {
		const result = normalizePluginMcpServerRegistration({
			name: "local",
			transport: {
				type: "stdio",
				command: "",
			},
			env: {
				MISSING_TOKEN: {
					fromEnv: "CLINE_TEST_MISSING_PLUGIN_MCP_TOKEN",
					required: true,
				},
			},
		});

		expect(result.registration).toBeUndefined();
		expect(result.loadError).toBe("stdio MCP transport requires command");
	});

	it("normalizes whitespace-only server names to empty-name errors", () => {
		const result = normalizePluginMcpServerRegistration({
			name: "   ",
			transport: {
				type: "stdio",
				command: "node",
			},
		});

		expect(result.registration).toBeUndefined();
		expect(result).toEqual({
			name: "",
			loadError: "empty MCP server name",
		});
	});
});
