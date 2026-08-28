import { describe, expect, it } from "vitest";
import { createMcpOAuthTransportBinding } from "./oauth-transport-binding";

describe("MCP OAuth transport binding", () => {
	it("is stable across header order, name casing, and omitted empty headers", () => {
		const reordered = createMcpOAuthTransportBinding({
			type: "streamableHttp",
			url: "https://mcp.example.test/mcp",
			headers: { "X-Tenant": "engineering", Authorization: "Bearer secret" },
		});
		const canonical = createMcpOAuthTransportBinding({
			type: "streamableHttp",
			url: "https://mcp.example.test/mcp",
			headers: { authorization: "Bearer secret", "x-tenant": "engineering" },
		});
		expect(reordered).toBe(canonical);
		expect(
			createMcpOAuthTransportBinding({
				type: "sse",
				url: "https://mcp.example.test/sse",
			}),
		).toBe(
			createMcpOAuthTransportBinding({
				type: "sse",
				url: "https://mcp.example.test/sse",
				headers: {},
			}),
		);
		expect(canonical).toMatch(/^sha256:[a-f\d]{64}$/);
		expect(canonical).not.toContain("secret");
	});

	it("changes for transport type, exact URL, header name, or header value", () => {
		const baseline = createMcpOAuthTransportBinding({
			type: "streamableHttp",
			url: "https://mcp.example.test/mcp",
			headers: { "X-Tenant": "engineering" },
		});
		const variants = [
			createMcpOAuthTransportBinding({
				type: "sse",
				url: "https://mcp.example.test/mcp",
				headers: { "X-Tenant": "engineering" },
			}),
			createMcpOAuthTransportBinding({
				type: "streamableHttp",
				url: "https://mcp.example.test/mcp/",
				headers: { "X-Tenant": "engineering" },
			}),
			createMcpOAuthTransportBinding({
				type: "streamableHttp",
				url: "https://mcp.example.test/mcp",
				headers: { "X-Workspace": "engineering" },
			}),
			createMcpOAuthTransportBinding({
				type: "streamableHttp",
				url: "https://mcp.example.test/mcp",
				headers: { "X-Tenant": "support" },
			}),
		];
		expect(new Set([baseline, ...variants]).size).toBe(5);
	});

	it("rejects duplicate case-insensitive header names with ambiguous HTTP semantics", () => {
		expect(() =>
			createMcpOAuthTransportBinding({
				type: "streamableHttp",
				url: "https://mcp.example.test/mcp",
				headers: {
					Authorization: "Bearer first",
					authorization: "Bearer second",
				},
			}),
		).toThrow("must be unique case-insensitively");
	});
});
