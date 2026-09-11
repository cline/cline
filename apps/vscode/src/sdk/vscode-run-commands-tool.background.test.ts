import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	createShellExecutor: vi.fn(() => vi.fn(async () => "background-ok")),
	getGlobalSettingsKey: vi.fn(() => "default"),
}))

vi.mock("@cline/core", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@cline/core")>()
	return {
		...actual,
		createShellExecutor: mocks.createShellExecutor,
	}
})

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: () => ({ getGlobalSettingsKey: mocks.getGlobalSettingsKey }),
	},
}))

vi.mock("@services/telemetry", () => ({
	TerminalUserInterventionAction: { PROCESS_WHILE_RUNNING: "process_while_running" },
	telemetryService: {
		captureTerminalUserIntervention: () => {},
		captureTerminalExecution: () => {},
	},
}))

import { createVscodeRunCommandsTool, VSCODE_RUN_COMMANDS_TIMEOUT_MS } from "./vscode-run-commands-tool"

afterEach(() => {
	mocks.createShellExecutor.mockReset()
	mocks.createShellExecutor.mockReturnValue(vi.fn(async () => "background-ok"))
	mocks.getGlobalSettingsKey.mockReset()
	mocks.getGlobalSettingsKey.mockReturnValue("default")
})

describe("createVscodeRunCommandsTool background mode", () => {
	it("passes the configured timeout to the SDK shell executor", async () => {
		const backgroundExecutor = vi.fn(async () => "background-ok")
		mocks.createShellExecutor.mockReturnValue(backgroundExecutor)
		const tool = createVscodeRunCommandsTool({
			cwd: "/workspace",
			getTerminalManager: () => {
				throw new Error("terminal manager should not be created for background execution")
			},
			bashTimeoutMs: VSCODE_RUN_COMMANDS_TIMEOUT_MS,
			vscodeTerminalExecutionMode: "backgroundExec",
		})

		const result = await tool.execute(
			{ commands: ["echo ok"] },
			{ agentId: "agent-1", conversationId: "conversation-1", iteration: 1 },
		)

		expect(mocks.createShellExecutor).toHaveBeenCalledWith(
			expect.objectContaining({
				timeoutMs: VSCODE_RUN_COMMANDS_TIMEOUT_MS,
				shell: expect.any(String),
				env: expect.objectContaining({
					SHELL: expect.any(String),
				}),
			}),
		)
		expect(backgroundExecutor).toHaveBeenCalledWith("echo ok", "/workspace", expect.any(Object))
		expect(result).toEqual([expect.objectContaining({ result: "background-ok", success: true })])
	})
})
