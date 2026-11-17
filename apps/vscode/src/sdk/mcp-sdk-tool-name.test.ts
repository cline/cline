import type { McpServer } from "@shared/mcp"
import { describe, expect, it } from "vitest"
import { findMcpTool, getMcpSdkToolName, getMcpToolsBySdkName } from "./mcp-sdk-tool-name"

function server(name: string, ...toolNames: string[]): McpServer {
	return { name, config: "{}", status: "connected", tools: toolNames.map((toolName) => ({ name: toolName })) }
}

describe("MCP tool names in an SDK session", () => {
	const servers = [
		server("ide", "run"),
		server("github.com/upstash/context7-mcp", "resolve-library-id"),
		server("Home Assistant", "turn on"),
		server("github.com/modelcontextprotocol/servers/tree/main/src/filesystem", "read_file", "write_file"),
		server("a__b", "c"),
	]

	it("keeps server__tool when a model provider accepts it", () => {
		expect(getMcpSdkToolName("ide", "run")).toBe("ide__run")
		expect(getMcpSdkToolName("a__b", "c")).toBe("a__b__c")
	})

	it("finds the tool behind every name, including the ones the SDK rewrites", () => {
		for (const { name: serverName, tools } of servers) {
			for (const { name: toolName } of tools ?? []) {
				const match = findMcpTool(getMcpSdkToolName(serverName, toolName), servers)
				expect([match?.server.name, match?.tool.name]).toEqual([serverName, toolName])
			}
		}
		expect(getMcpToolsBySdkName(servers).size).toBe(6)
	})

	it("keeps a rewritten name within a provider's length limit, which can drop the separator", () => {
		const rewritten = getMcpSdkToolName("github.com/modelcontextprotocol/servers/tree/main/src/filesystem", "read_file")

		expect(rewritten.length).toBeLessThanOrEqual(64)
		expect(rewritten).not.toContain("__")
		expect(rewritten).not.toBe(
			getMcpSdkToolName("github.com/modelcontextprotocol/servers/tree/main/src/filesystem", "write_file"),
		)
	})

	it("gives a name that two servers produce to the first of them", () => {
		const first = server("a", "b__c")
		const second = server("a__b", "c")

		for (const colliding of [
			[first, second],
			[second, first],
		]) {
			expect(findMcpTool("a__b__c", colliding)?.server).toBe(colliding[0])
			expect([...getMcpToolsBySdkName(colliding).values()].map((named) => named.server)).toEqual([colliding[0]])
		}
	})

	it("finds nothing for a name no server has", () => {
		expect(findMcpTool("ide__missing", servers)).toBeUndefined()
		expect(findMcpTool("read_files", servers)).toBeUndefined()
	})
})
