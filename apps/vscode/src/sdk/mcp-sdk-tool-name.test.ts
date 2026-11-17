import type { McpServer } from "@shared/mcp"
import { describe, expect, it } from "vitest"
import { findMcpTools, getMcpSdkToolName } from "./mcp-sdk-tool-name"

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
				const matches = findMcpTools(getMcpSdkToolName(serverName, toolName), servers)
				expect(matches.map(({ server, tool }) => [server.name, tool.name])).toEqual([[serverName, toolName]])
			}
		}
	})

	it("keeps a rewritten name within a provider's length limit, which can drop the separator", () => {
		const rewritten = getMcpSdkToolName("github.com/modelcontextprotocol/servers/tree/main/src/filesystem", "read_file")

		expect(rewritten.length).toBeLessThanOrEqual(64)
		expect(rewritten).not.toContain("__")
		expect(rewritten).not.toBe(
			getMcpSdkToolName("github.com/modelcontextprotocol/servers/tree/main/src/filesystem", "write_file"),
		)
	})

	it("returns every tool when two servers produce the same name", () => {
		const colliding = [server("a", "b__c"), server("a__b", "c")]

		expect(findMcpTools("a__b__c", colliding).map(({ server }) => server.name)).toEqual(["a", "a__b"])
	})

	it("finds nothing for a name no server has", () => {
		expect(findMcpTools("ide__missing", servers)).toEqual([])
		expect(findMcpTools("read_files", servers)).toEqual([])
	})
})
