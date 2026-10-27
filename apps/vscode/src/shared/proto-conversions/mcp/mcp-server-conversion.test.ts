import { describe, it } from "bun:test"
import "should"
import type { McpServer } from "../../mcp"
import { convertMcpServersToProtoMcpServers, convertProtoMcpServersToMcpServers } from "./mcp-server-conversion"

function serverWithTools(tools: McpServer["tools"]): McpServer {
	return { name: "jetbrains", config: "{}", status: "connected", tools }
}

describe("MCP tool annotations over the proto boundary", () => {
	it("survive a round trip to the webview", () => {
		const [server] = convertProtoMcpServersToMcpServers(
			convertMcpServersToProtoMcpServers([
				serverWithTools([
					{
						name: "get_file_text",
						inputSchema: { type: "object" },
						annotations: { title: "Get file text", readOnlyHint: true, destructiveHint: false },
					},
				]),
			]),
		)

		server.tools?.[0].annotations?.should.deepEqual({
			title: "Get file text",
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: undefined,
			openWorldHint: undefined,
		})
	})

	it("stay absent for a tool the server left undeclared", () => {
		const [server] = convertProtoMcpServersToMcpServers(
			convertMcpServersToProtoMcpServers([serverWithTools([{ name: "execute_code", inputSchema: { type: "object" } }])]),
		)

		;(server.tools?.[0].annotations === undefined).should.be.true()
	})
})
