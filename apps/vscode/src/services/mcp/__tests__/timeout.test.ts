import { describe, expect, it } from "bun:test"
import { DEFAULT_MCP_CONNECT_TIMEOUT_MS } from "@cline/core"
import { resolveMcpConnectTimeoutMs, resolveMcpServerTimeoutMs } from "../timeout"

/**
 * Connect vs request timeout resolution. The connect/initialize step follows
 * SDK core policy: a stdio server with no explicit `timeout` gets the short
 * DEFAULT_MCP_CONNECT_TIMEOUT_MS budget, while an explicit `timeout` overrides
 * it in either direction. Post-connect requests always resolve through the
 * shared 60s default regardless of transport.
 */

describe("resolveMcpConnectTimeoutMs", () => {
	it("uses the shared 3s connect budget for a stdio server with no timeout", () => {
		const config = JSON.stringify({ type: "stdio", command: "node" })
		expect(resolveMcpConnectTimeoutMs(config)).toBe(DEFAULT_MCP_CONNECT_TIMEOUT_MS)
		expect(resolveMcpConnectTimeoutMs(config)).toBe(3_000)
	})

	it("lets an explicit timeout override the budget downward", () => {
		const config = JSON.stringify({ type: "stdio", command: "node", timeout: 2 })
		expect(resolveMcpConnectTimeoutMs(config)).toBe(2_000)
	})

	it("lets an explicit timeout override the budget upward", () => {
		const config = JSON.stringify({ type: "stdio", command: "node", timeout: 30 })
		expect(resolveMcpConnectTimeoutMs(config)).toBe(30_000)
	})

	it("clamps an explicit timeout below the minimum", () => {
		const config = JSON.stringify({ type: "stdio", command: "node", timeout: 0 })
		expect(resolveMcpConnectTimeoutMs(config)).toBe(1_000)
	})

	it("treats a malformed timeout value as unconfigured (stdio gets the budget)", () => {
		const config = JSON.stringify({ type: "stdio", command: "node", timeout: "not-a-number" })
		expect(resolveMcpConnectTimeoutMs(config)).toBe(DEFAULT_MCP_CONNECT_TIMEOUT_MS)
	})

	it("keeps the 60s default for remote servers with no timeout, as SDK core does", () => {
		expect(resolveMcpConnectTimeoutMs(JSON.stringify({ type: "sse", url: "https://example.com/sse" }))).toBe(60_000)
		expect(resolveMcpConnectTimeoutMs(JSON.stringify({ type: "streamableHttp", url: "https://example.com/mcp" }))).toBe(
			60_000,
		)
	})

	it("applies an explicit timeout to remote servers too", () => {
		const config = JSON.stringify({ type: "sse", url: "https://example.com/sse", timeout: 5 })
		expect(resolveMcpConnectTimeoutMs(config)).toBe(5_000)
	})

	it("falls back to the 60s default on malformed config JSON", () => {
		expect(resolveMcpConnectTimeoutMs("{not json")).toBe(60_000)
	})
})

describe("resolveMcpServerTimeoutMs", () => {
	it("resolves the 60s request default for a stdio server with no timeout", () => {
		const config = JSON.stringify({ type: "stdio", command: "node" })
		expect(resolveMcpServerTimeoutMs(config)).toBe(60_000)
	})

	it("resolves an explicit timeout in seconds to milliseconds", () => {
		const config = JSON.stringify({ type: "stdio", command: "node", timeout: 120 })
		expect(resolveMcpServerTimeoutMs(config)).toBe(120_000)
	})

	it("falls back to the 60s default on malformed config JSON", () => {
		expect(resolveMcpServerTimeoutMs("{not json")).toBe(60_000)
	})
})
