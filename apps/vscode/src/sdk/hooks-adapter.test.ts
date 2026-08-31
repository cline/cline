// Hook-execution telemetry only fires when the adapter passes a task id into
// HookFactory.create (StdioHookRunner gates every captureHookExecution on it),
// so these tests pin the id threading at every adapter call site.

import { beforeEach, describe, expect, it, vi } from "vitest"
import { buildAgentHooks } from "./hooks-adapter"

const mocks = vi.hoisted(() => ({
	create: vi.fn(),
}))

vi.mock("@/core/hooks/hook-factory", () => ({
	HookFactory: class {
		create = mocks.create
	},
}))

function makeRunner() {
	return {
		isNoOp: false,
		run: vi.fn(async () => ({ cancel: false, contextModification: "", errorMessage: "" })),
	}
}

const snapshot = {
	conversationId: "conv-1",
	runId: "run-1",
	agentId: "agent-1",
	messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
} as never

const stateManager = { getGlobalSettingsKey: vi.fn(() => true) } as never

describe("hooks-adapter task id threading", () => {
	let runner: ReturnType<typeof makeRunner>

	beforeEach(() => {
		mocks.create.mockReset()
		runner = makeRunner()
		mocks.create.mockResolvedValue(runner)
	})

	it("passes the task id and tool name when creating the PreToolUse runner", async () => {
		const hooks = buildAgentHooks(stateManager)
		await hooks.beforeTool?.({ toolCall: { toolName: "read_file" }, input: { path: "a.ts" }, snapshot } as never)

		expect(mocks.create).toHaveBeenCalledWith("PreToolUse", "conv-1", "read_file")
		expect(runner.run).toHaveBeenCalledWith(expect.objectContaining({ taskId: "conv-1" }))
	})

	it("passes the task id and tool name when creating the PostToolUse runner", async () => {
		const hooks = buildAgentHooks(stateManager)
		await hooks.afterTool?.({
			toolCall: { toolName: "write_file" },
			input: {},
			result: { output: "ok", isError: false },
			durationMs: 5,
			snapshot,
		} as never)

		expect(mocks.create).toHaveBeenCalledWith("PostToolUse", "conv-1", "write_file")
		expect(runner.run).toHaveBeenCalledWith(expect.objectContaining({ taskId: "conv-1" }))
	})

	it("passes the task id when creating the TaskStart and UserPromptSubmit runners", async () => {
		const hooks = buildAgentHooks(stateManager)
		await hooks.beforeRun?.({ snapshot } as never)

		expect(mocks.create).toHaveBeenCalledWith("TaskStart", "conv-1")
		expect(mocks.create).toHaveBeenCalledWith("UserPromptSubmit", "conv-1")
	})

	it("passes the task id when creating the TaskComplete runner", async () => {
		const hooks = buildAgentHooks(stateManager)
		await hooks.afterRun?.({ snapshot, result: { status: "completed", outputText: "done" } } as never)

		expect(mocks.create).toHaveBeenCalledWith("TaskComplete", "conv-1")
	})

	it("passes the task id when creating the TaskCancel runner", async () => {
		const hooks = buildAgentHooks(stateManager)
		await hooks.afterRun?.({ snapshot, result: { status: "aborted", outputText: "" } } as never)

		expect(mocks.create).toHaveBeenCalledWith("TaskCancel", "conv-1")
	})

	it("falls back to the run id when the snapshot has no conversation id", async () => {
		const hooks = buildAgentHooks(stateManager)
		await hooks.beforeTool?.({
			toolCall: { toolName: "read_file" },
			input: {},
			snapshot: { ...(snapshot as object), conversationId: undefined },
		} as never)

		expect(mocks.create).toHaveBeenCalledWith("PreToolUse", "run-1", "read_file")
	})
})
