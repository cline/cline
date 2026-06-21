import { strict as assert } from "node:assert"
import { ClineDefaultTool } from "@shared/tools"
import { afterEach, describe, it } from "mocha"
import sinon from "sinon"
import type { TaskConfig } from "../../types/TaskConfig"
import { createUIHelpers } from "../../types/UIHelpers"
import { UseMcpToolHandler } from "../UseMcpToolHandler"

const SERVER_NAME = "ado"
const TOOL_NAME = "repo_create_pull_request_thread"

function createConfig(options?: {
	useMcp?: boolean
	toolAutoApprove?: boolean
	yoloModeToggled?: boolean
	autoApproveAllToggled?: boolean
	askResponse?: "yesButtonClicked" | "noButtonClicked"
}) {
	const useMcp = options?.useMcp ?? false
	const toolAutoApprove = options?.toolAutoApprove ?? false

	const callTool = sinon.stub().resolves({ isError: false, content: [{ type: "text", text: "ok" }] })

	const callbacks = {
		say: sinon.stub().resolves(undefined),
		ask: sinon.stub().resolves({ response: options?.askResponse ?? "yesButtonClicked" }),
		removeLastPartialMessageIfExistsWithType: sinon.stub().resolves(),
		// shouldAutoApproveTool for MCP_USE returns the global useMcp action value
		shouldAutoApproveTool: sinon.stub().returns(useMcp),
	}

	const config = {
		ulid: "ulid-1",
		yoloModeToggled: options?.yoloModeToggled ?? false,
		isSubagentExecution: false,
		taskState: { consecutiveMistakeCount: 0, didRejectTool: false, userMessageContent: [] },
		api: {
			getModel: () => ({ id: "anthropic/claude", info: { supportsImages: false } }),
		},
		autoApprovalSettings: {
			enableNotifications: false,
			actions: { useMcp },
		},
		services: {
			stateManager: {
				getGlobalSettingsKey: (key: string) => {
					if (key === "autoApproveAllToggled") {
						return options?.autoApproveAllToggled ?? false
					}
					if (key === "mode") {
						return "act"
					}
					if (key === "hooksEnabled") {
						return false
					}
					return undefined
				},
				getApiConfiguration: () => ({
					planModeApiProvider: "anthropic",
					actModeApiProvider: "anthropic",
				}),
			},
			mcpHub: {
				connections: [
					{
						server: {
							name: SERVER_NAME,
							tools: [{ name: TOOL_NAME, autoApprove: toolAutoApprove }],
						},
					},
				],
				callTool,
				getPendingNotifications: sinon.stub().returns([]),
			},
		},
		callbacks,
	} as unknown as TaskConfig

	return { config, callbacks, callTool }
}

function partialBlock() {
	return {
		type: "tool_use" as const,
		name: ClineDefaultTool.MCP_USE,
		params: {
			server_name: SERVER_NAME,
			tool_name: TOOL_NAME,
			arguments: "{}",
		},
		partial: true,
	}
}

describe("UseMcpToolHandler auto-approval gating", () => {
	afterEach(() => {
		sinon.restore()
	})

	it("requires manual approval when global useMcp is ON but the tool toggle is OFF", async () => {
		// Regression test for #10499: the per-tool Auto-approve OFF toggle must be honored.
		const { config, callbacks } = createConfig({ useMcp: true, toolAutoApprove: false })
		const handler = new UseMcpToolHandler()

		await handler.handlePartialBlock(partialBlock(), createUIHelpers(config))

		sinon.assert.calledOnce(callbacks.ask)
		sinon.assert.calledWithExactly(callbacks.removeLastPartialMessageIfExistsWithType, "say", "use_mcp_server")
	})

	it("auto-approves when global useMcp is ON and the tool toggle is ON", async () => {
		const { config, callbacks } = createConfig({ useMcp: true, toolAutoApprove: true })
		const handler = new UseMcpToolHandler()

		await handler.handlePartialBlock(partialBlock(), createUIHelpers(config))

		sinon.assert.calledOnce(callbacks.say)
		sinon.assert.notCalled(callbacks.ask)
		sinon.assert.calledWithExactly(callbacks.removeLastPartialMessageIfExistsWithType, "ask", "use_mcp_server")
	})

	it("requires manual approval when global useMcp is OFF even if the tool toggle is ON", async () => {
		const { config, callbacks } = createConfig({ useMcp: false, toolAutoApprove: true })
		const handler = new UseMcpToolHandler()

		await handler.handlePartialBlock(partialBlock(), createUIHelpers(config))

		sinon.assert.calledOnce(callbacks.ask)
		sinon.assert.notCalled(callbacks.say)
	})

	it("auto-approves when YOLO mode is ON regardless of the tool toggle", async () => {
		const { config, callbacks } = createConfig({ useMcp: false, toolAutoApprove: false, yoloModeToggled: true })
		const handler = new UseMcpToolHandler()

		await handler.handlePartialBlock(partialBlock(), createUIHelpers(config))

		sinon.assert.calledOnce(callbacks.say)
		sinon.assert.notCalled(callbacks.ask)
	})

	it("auto-approves when auto-approve-all is ON regardless of the tool toggle", async () => {
		const { config, callbacks } = createConfig({ useMcp: false, toolAutoApprove: false, autoApproveAllToggled: true })
		const handler = new UseMcpToolHandler()

		await handler.handlePartialBlock(partialBlock(), createUIHelpers(config))

		sinon.assert.calledOnce(callbacks.say)
		sinon.assert.notCalled(callbacks.ask)
	})
})

function completeBlock() {
	return {
		type: "tool_use" as const,
		name: ClineDefaultTool.MCP_USE,
		params: {
			server_name: SERVER_NAME,
			tool_name: TOOL_NAME,
			arguments: "{}",
		},
		partial: false,
	}
}

// execute() is the actual enforcement gate (handlePartialBlock only drives UI state).
// These cover the two highest-risk paths directly so a future refactor that splits the
// two functions' logic cannot silently regress the gate.
describe("UseMcpToolHandler execute() enforcement", () => {
	afterEach(() => {
		sinon.restore()
	})

	it("does NOT execute the tool when global useMcp is ON, the tool toggle is OFF, and the user rejects", async () => {
		// Regression test for #10499 at the enforcement boundary.
		const { config, callbacks, callTool } = createConfig({
			useMcp: true,
			toolAutoApprove: false,
			askResponse: "noButtonClicked",
		})
		const handler = new UseMcpToolHandler()

		const result = await handler.execute(config, completeBlock())

		sinon.assert.calledOnce(callbacks.ask)
		sinon.assert.notCalled(callTool)
		assert.match(String(result), /denied/i)
	})

	it("executes the tool without asking when YOLO mode is ON", async () => {
		const { config, callbacks, callTool } = createConfig({
			useMcp: false,
			toolAutoApprove: false,
			yoloModeToggled: true,
		})
		const handler = new UseMcpToolHandler()

		await handler.execute(config, completeBlock())

		sinon.assert.notCalled(callbacks.ask)
		sinon.assert.calledOnce(callTool)
	})
})
