import { describe, expect, it } from "vitest";
import {
	GITHUB_MCP_MARKETPLACE_ENTRY_KEY,
	isOfficialGitHubMcpUrl,
} from "./github-mcp";

describe("GitHub MCP identity", () => {
	it("matches the official endpoint with or without a trailing slash", () => {
		expect(isOfficialGitHubMcpUrl("https://api.githubcopilot.com/mcp/")).toBe(
			true,
		);
		expect(isOfficialGitHubMcpUrl("https://api.githubcopilot.com/mcp")).toBe(
			true,
		);
		expect(GITHUB_MCP_MARKETPLACE_ENTRY_KEY).toBe("mcp:github");
	});

	it("rejects lookalike endpoints", () => {
		expect(isOfficialGitHubMcpUrl("https://example.com/mcp")).toBe(false);
		expect(
			isOfficialGitHubMcpUrl("https://api.githubcopilot.com/mcp/insiders"),
		).toBe(false);
		expect(
			isOfficialGitHubMcpUrl("https://api.githubcopilot.com/mcp/?tenant=other"),
		).toBe(false);
	});
});
