import sinon from "sinon"
import { describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	createVscodeRunCommandsTool: vi.fn(() => ({ name: "run_commands" })),
}))

vi.mock("./vscode-run-commands-tool", () => ({
	createVscodeRunCommandsTool: mocks.createVscodeRunCommandsTool,
	VSCODE_RUN_COMMANDS_TIMEOUT_MS: 60 * 60 * 1000,
}))

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

describe("createVscodeExtraTools", () => {
	it("uses the VS Code run_commands timeout in background mode", async () => {
		await createVscodeExtraTools(
			{
				getServers: () => [],
			} as never,
			{
				cwd: "/workspace",
				getTerminalManager: () => {
					throw new Error("terminal manager should not be created during tool construction")
				},
				vscodeTerminalExecutionMode: "backgroundExec",
			},
		)

		expect(mocks.createVscodeRunCommandsTool).toHaveBeenCalledWith(
			expect.objectContaining({
				cwd: "/workspace",
				bashTimeoutMs: 60 * 60 * 1000,
				vscodeTerminalExecutionMode: "backgroundExec",
			}),
		)
	})
})
