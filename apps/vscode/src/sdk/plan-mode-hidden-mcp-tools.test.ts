import type { McpServer } from "@shared/mcp"
import { describe, expect, it } from "vitest"
import { getMcpSdkToolName } from "./mcp-sdk-tool-name"
import { describeMcpToolsHiddenInPlanMode } from "./plan-mode-hidden-mcp-tools"

function server(name: string, tools: McpServer["tools"], allowAllInPlanMode = false): McpServer {
	return { name, config: "{}", status: "connected", tools, allowAllInPlanMode }
}

describe("describeMcpToolsHiddenInPlanMode", () => {
	it("counts and names the tools each server declares as modifying", () => {
		const result = describeMcpToolsHiddenInPlanMode([
			server("ide", [
				{ name: "read", annotations: { readOnlyHint: true } },
				{ name: "rename", annotations: { readOnlyHint: false } },
				{ name: "delete", annotations: { readOnlyHint: false } },
				{ name: "run" },
			]),
			server("db", [{ name: "migrate", annotations: { readOnlyHint: false } }]),
		])

		expect(result.servers).toEqual([
			{ serverName: "ide", hiddenCount: 2, toolCount: 4 },
			{ serverName: "db", hiddenCount: 1, toolCount: 1 },
		])
		// The model is told the names it will see in Act mode.
		expect(result.promptSection).toContain("ide__rename, ide__delete, db__migrate")
		expect(result.promptSection).not.toContain("ide__read")
		expect(result.promptSection).not.toContain("ide__run")
	})

	it("names a tool as the session will, also when the SDK rewrites the name", () => {
		const result = describeMcpToolsHiddenInPlanMode([
			server("github.com/acme/db-mcp", [{ name: "migrate", annotations: { readOnlyHint: false } }]),
		])

		expect(result.servers).toEqual([{ serverName: "github.com/acme/db-mcp", hiddenCount: 1, toolCount: 1 }])
		expect(result.promptSection).toContain(getMcpSdkToolName("github.com/acme/db-mcp", "migrate"))
		expect(result.promptSection).not.toContain("github.com/acme/db-mcp__migrate")
	})

	it("leaves out a tool whose name another server's tool has, since no session offers it", () => {
		const result = describeMcpToolsHiddenInPlanMode([
			server("a", [{ name: "b__c" }]),
			server("a__b", [{ name: "c", annotations: { readOnlyHint: false } }]),
		])

		expect(result).toEqual({ servers: [], promptSection: undefined })
	})

	it("says nothing when Plan mode hides no tool", () => {
		const result = describeMcpToolsHiddenInPlanMode([
			server("docs", [{ name: "search", annotations: { readOnlyHint: true } }, { name: "fetch" }]),
			server("allowed-tool", [{ name: "write", annotations: { readOnlyHint: false }, allowInPlanMode: true }]),
			server("allowed-server", [{ name: "write", annotations: { readOnlyHint: false } }], true),
			server("empty", undefined),
		])

		expect(result).toEqual({ servers: [], promptSection: undefined })
	})
})
