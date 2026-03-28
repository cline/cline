import { describe, expect, it } from "vitest";
import { defaultMcpToolNameTransform } from "./name-transform";

describe("defaultMcpToolNameTransform", () => {
	it("keeps already valid MCP tool names unchanged", () => {
		expect(
			defaultMcpToolNameTransform({
				serverName: "docs",
				toolName: "search_docs",
			}),
		).toBe("docs__search_docs");
	});

	it("sanitizes invalid characters and appends a stable hash suffix", () => {
		const dotted = defaultMcpToolNameTransform({
			serverName: "github.com/cline/linear-mcp",
			toolName: "list_issues",
		});
		const slashed = defaultMcpToolNameTransform({
			serverName: "github/com/cline/linear-mcp",
			toolName: "list_issues",
		});

		expect(dotted).toMatch(
			/^github_com_cline_linear-mcp__list_issues_[a-f0-9]{8}$/,
		);
		expect(slashed).toMatch(
			/^github_com_cline_linear-mcp__list_issues_[a-f0-9]{8}$/,
		);
		expect(dotted).not.toBe(slashed);
	});

	it("truncates long names to the provider limit while preserving a hash suffix", () => {
		const transformed = defaultMcpToolNameTransform({
			serverName: "server".repeat(16),
			toolName: "tool".repeat(16),
		});

		expect(transformed).toHaveLength(128);
		expect(transformed).toMatch(/_[a-f0-9]{8}$/);
		expect(transformed).toMatch(/^[a-zA-Z0-9_-]{1,128}$/);
	});
});
