import { describe, it } from "mocha"
import "should"
import sinon from "sinon"
import { McpHub } from "../McpHub"

function createMcpHub(config: string) {
	const client = {
		request: sinon.stub().rejects(new Error("stop after recording request options")),
	}

	const connection = {
		server: {
			name: "test-server",
			config,
			status: "connected",
			disabled: false,
		},
		client,
		transport: {},
	}

	const hub = Object.create(McpHub.prototype) as McpHub
	;(hub as any).connections = [connection]

	return { hub, client }
}

describe("McpHub MCP discovery requests", () => {
	it("should use the configured MCP server timeout for tools/list requests", async () => {
		const { hub, client } = createMcpHub(JSON.stringify({ type: "stdio", command: "test", timeout: 20 }))

		await (hub as any).fetchToolsList("test-server")

		client.request.calledOnce.should.be.true()
		client.request.firstCall.args[0].method.should.equal("tools/list")
		client.request.firstCall.args[2].timeout.should.equal(20_000)
	})

	it("should use the configured MCP server timeout for resource and prompt discovery requests", async () => {
		const config = JSON.stringify({ type: "stdio", command: "test", timeout: 30 })
		const methods = [
			{ call: "fetchResourcesList", method: "resources/list" },
			{ call: "fetchResourceTemplatesList", method: "resources/templates/list" },
			{ call: "fetchPromptsList", method: "prompts/list" },
		]

		for (const { call, method } of methods) {
			const { hub, client } = createMcpHub(config)

			await (hub as any)[call]("test-server")

			client.request.calledOnce.should.be.true()
			client.request.firstCall.args[0].method.should.equal(method)
			client.request.firstCall.args[2].timeout.should.equal(30_000)
		}
	})
})
