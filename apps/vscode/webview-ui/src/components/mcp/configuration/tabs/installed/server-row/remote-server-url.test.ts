import { describe, expect, it } from "vitest"
import { mcpEndpointUrlsMatch } from "./remote-server-url"

describe("mcpEndpointUrlsMatch", () => {
	it("matches a projected URL to a query-bearing enterprise URL", () => {
		expect(
			mcpEndpointUrlsMatch(
				"https://mcp.example.com/connect?[REDACTED]",
				"https://mcp.example.com/connect?tenant=acme&routing=west",
			),
		).toBe(true)
	})

	it("matches URLs with redacted and raw hashes", () => {
		expect(
			mcpEndpointUrlsMatch("https://mcp.example.com/connect#[REDACTED]", "https://mcp.example.com/connect#oauth-state"),
		).toBe(true)
	})

	it("does not match a different origin or pathname", () => {
		expect(mcpEndpointUrlsMatch("https://mcp.example.com/connect", "https://other.example.com/connect")).toBe(false)
		expect(mcpEndpointUrlsMatch("https://mcp.example.com/connect", "https://mcp.example.com/admin")).toBe(false)
	})

	it("does not match missing or malformed URLs", () => {
		expect(mcpEndpointUrlsMatch(undefined, "https://mcp.example.com/connect")).toBe(false)
		expect(mcpEndpointUrlsMatch("not-a-url", "not-a-url")).toBe(false)
		expect(mcpEndpointUrlsMatch("file:///tmp/mcp", "file:///tmp/mcp")).toBe(false)
	})
})
