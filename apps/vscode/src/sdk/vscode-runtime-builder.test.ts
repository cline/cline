import sinon from "sinon"
import { describe, expect, it } from "vitest"
import { McpHubToolProvider } from "./vscode-runtime-builder"

describe("McpHubToolProvider", () => {
	it("forwards the agent abort signal to McpHub", async () => {
		const callTool = sinon.stub().resolves({ content: [] })
		const provider = new McpHubToolProvider({ callTool } as never)
		const controller = new AbortController()

		await provider.callTool({
			serverName: "server",
			toolName: "slow-tool",
			context: {
				agentId: "agent",
				iteration: 1,
				signal: controller.signal,
			},
		})

		expect(callTool.calledOnce).toBe(true)
		expect(callTool.firstCall.args[4]).toBe(controller.signal)
	})

	it("keeps MCP Apps tool metadata", async () => {
		const getServers = sinon.stub().returns([
			{
				name: "weather",
				tools: [
					{
						name: "show_weather",
						inputSchema: { type: "object" },
						_meta: { ui: { resourceUri: "ui://weather/view.html" } },
					},
					{ name: "plain", inputSchema: { type: "object" } },
				],
			},
		])
		const provider = new McpHubToolProvider({ getServers } as never)

		expect(await provider.listTools("weather")).toEqual([
			{
				name: "show_weather",
				description: undefined,
				inputSchema: { type: "object" },
				_meta: { ui: { resourceUri: "ui://weather/view.html" } },
			},
			{ name: "plain", description: undefined, inputSchema: { type: "object" } },
		])
	})

	it("forwards resource reads with the agent abort signal", async () => {
		const readResource = sinon.stub().resolves({ contents: [] })
		const provider = new McpHubToolProvider({ readResource } as never)
		const controller = new AbortController()

		await provider.readResource({
			serverName: "weather",
			uri: "ui://weather/view.html",
			context: { agentId: "agent", iteration: 1, signal: controller.signal },
		})

		expect(readResource.firstCall.args).toEqual(["weather", "ui://weather/view.html", controller.signal])
	})
})
