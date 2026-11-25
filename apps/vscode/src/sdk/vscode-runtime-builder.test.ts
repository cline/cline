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

	describe("in a Plan-mode session", () => {
		const getServers = sinon.stub().returns([
			{
				name: "ide",
				tools: [
					{ name: "read", inputSchema: {}, annotations: { readOnlyHint: true } },
					{ name: "rename", inputSchema: {}, annotations: { readOnlyHint: false } },
					{ name: "run", inputSchema: {} },
					{ name: "format", inputSchema: {}, annotations: { readOnlyHint: false }, allowInPlanMode: true },
				],
			},
			{
				name: "trusted",
				allowAllInPlanMode: true,
				tools: [{ name: "write", inputSchema: {}, annotations: { readOnlyHint: false } }],
			},
		])
		const names = async (mode: "plan" | "act", serverName: string) =>
			(await new McpHubToolProvider({ getServers } as never, { mode, limitMcpInPlanMode: true }).listTools(serverName)).map(
				(tool) => tool.name,
			)

		it("leaves out the tools the server declares as modifying", async () => {
			expect(await names("plan", "ide")).toEqual(["read", "run", "format"])
		})

		it("keeps every tool of a server the user allowed", async () => {
			expect(await names("plan", "trusted")).toEqual(["write"])
		})

		it("does not apply to an Act-mode session", async () => {
			expect(await names("act", "ide")).toEqual(["read", "rename", "run", "format"])
		})

		it("keeps every tool while the limits are not turned on", async () => {
			const provider = new McpHubToolProvider({ getServers } as never, { mode: "plan" })

			expect((await provider.listTools("ide")).map((tool) => tool.name)).toEqual(["read", "rename", "run", "format"])
		})
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

	it("keeps a name with the tool that has it when Plan mode hides that tool", async () => {
		const getServers = () => [
			{ name: "a", config: "{}", tools: [{ name: "b__c", annotations: { readOnlyHint: false } }] },
			{ name: "a__b", config: "{}", tools: [{ name: "c" }] },
		]
		const provider = new McpHubToolProvider({ getServers } as never, { mode: "plan", limitMcpInPlanMode: true })

		expect(await provider.listTools("a")).toEqual([])
		// Otherwise an approval of a__b__c would name server `a` and offer to allow its tools.
		expect(await provider.listTools("a__b")).toEqual([])
	})
})
