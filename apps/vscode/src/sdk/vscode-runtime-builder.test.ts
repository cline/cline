import sinon from "sinon"
import { describe, expect, it } from "vitest"
import { createVscodeExtraTools, McpHubToolProvider } from "./vscode-runtime-builder"

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

	it("keeps MCP Apps tool metadata and server annotations", async () => {
		const getServers = sinon.stub().returns([
			{
				name: "weather",
				tools: [
					{
						name: "show_weather",
						inputSchema: { type: "object" },
						annotations: { readOnlyHint: true },
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
				annotations: { readOnlyHint: true },
				_meta: { ui: { resourceUri: "ui://weather/view.html" } },
			},
			{ name: "plain", description: undefined, inputSchema: { type: "object" } },
		])
	})

	it("stamps the session mode on MCP tool calls", async () => {
		const callTool = sinon.stub().resolves({ content: [] })
		const provider = new McpHubToolProvider({ callTool } as never, { mode: "plan" })

		await provider.callTool({ serverName: "weather", toolName: "show_weather" })

		expect(callTool.firstCall.args[5]).toBe("plan")
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

	it("registers a name that two servers produce once, for the tool an approval names", async () => {
		const tool = (name: string) => ({ name, inputSchema: { type: "object" } })
		const first = { name: "a", config: "{}", tools: [tool("b__c"), tool("d")] }
		const second = { name: "a__b", config: "{}", tools: [tool("c"), tool("e")] }

		for (const servers of [
			[first, second],
			[second, first],
		]) {
			const callTool = sinon.stub().resolves({ content: [] })
			const tools = await createVscodeExtraTools({ getServers: () => servers, callTool } as never, {})

			expect(tools.map((registered) => registered.name).sort()).toEqual(["a__b__c", "a__b__e", "a__d"])
			await tools
				.find((registered) => registered.name === "a__b__c")
				?.execute({}, { agentId: "agent", iteration: 1 } as never)
			expect(callTool.firstCall.args.slice(0, 2)).toEqual([servers[0].name, servers[0].tools[0].name])
		}
	})
})
