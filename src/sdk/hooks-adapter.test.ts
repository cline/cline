import type { ClineMessage } from "@shared/ExtensionMessage"
import { describe, expect, it, vi } from "vitest"
import { SdkMessageCoordinator } from "./sdk-message-coordinator"
import { createTaskProxy } from "./task-proxy"

vi.mock("./webview-grpc-bridge", () => ({
	pushMessageToWebview: vi.fn().mockResolvedValue(undefined),
}))

/**
 * These tests verify that the hook status message update-in-place mechanism
 * works correctly. When a hook emits a "running" message followed by a
 * "completed"/"failed"/"cancelled" message with the same timestamp, the
 * second message should UPDATE the first one rather than appending a duplicate.
 *
 * This is the core fix for ENG-1871: hooks UI duplicates instead of updating.
 */
describe("hooks-adapter: emitHookMessage update-in-place via timestamp reuse", () => {
	function setup() {
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const coordinator = new SdkMessageCoordinator({ getTask: () => task })
		return { task, coordinator }
	}

	it("emitHookMessage with same ts updates in-place instead of appending", () => {
		const { task, coordinator } = setup()

		const ts = Date.now()

		// Emit "running" message
		const runningMessage: ClineMessage = {
			ts,
			type: "say",
			say: "hook_status",
			text: JSON.stringify({ hookName: "TaskStart", status: "running" }),
			partial: false,
		}
		coordinator.emitHookMessage(runningMessage)

		// Verify one message exists
		let messages = task.messageStateHandler.getClineMessages()
		expect(messages).toHaveLength(1)
		expect(JSON.parse(messages[0].text ?? "{}").status).toBe("running")

		// Emit "completed" message with the SAME timestamp
		const completedMessage: ClineMessage = {
			ts, // same timestamp — should update in-place
			type: "say",
			say: "hook_status",
			text: JSON.stringify({ hookName: "TaskStart", status: "completed" }),
			partial: false,
		}
		coordinator.emitHookMessage(completedMessage)

		// Verify still one message, now with "completed" status
		messages = task.messageStateHandler.getClineMessages()
		expect(messages).toHaveLength(1)
		expect(JSON.parse(messages[0].text ?? "{}").status).toBe("completed")
	})

	it("emitHookMessage with different ts appends (bug behavior before fix)", () => {
		const { task, coordinator } = setup()

		// Emit "running" message
		const runningMessage: ClineMessage = {
			ts: 1000,
			type: "say",
			say: "hook_status",
			text: JSON.stringify({ hookName: "TaskStart", status: "running" }),
			partial: false,
		}
		coordinator.emitHookMessage(runningMessage)

		// Emit "completed" message with a DIFFERENT timestamp (old buggy behavior)
		const completedMessage: ClineMessage = {
			ts: 1001, // different timestamp — appends instead of updating
			type: "say",
			say: "hook_status",
			text: JSON.stringify({ hookName: "TaskStart", status: "completed" }),
			partial: false,
		}
		coordinator.emitHookMessage(completedMessage)

		// With different timestamps, we get 2 messages (the bug)
		const messages = task.messageStateHandler.getClineMessages()
		expect(messages).toHaveLength(2)
	})

	it("emitHookMessage with same ts updates for failed status too", () => {
		const { task, coordinator } = setup()

		const ts = Date.now()

		coordinator.emitHookMessage({
			ts,
			type: "say",
			say: "hook_status",
			text: JSON.stringify({ hookName: "PreToolUse", toolName: "editor", status: "running" }),
			partial: false,
		})

		coordinator.emitHookMessage({
			ts, // same timestamp
			type: "say",
			say: "hook_status",
			text: JSON.stringify({ hookName: "PreToolUse", toolName: "editor", status: "failed" }),
			partial: false,
		})

		const messages = task.messageStateHandler.getClineMessages()
		expect(messages).toHaveLength(1)
		expect(JSON.parse(messages[0].text ?? "{}").status).toBe("failed")
	})

	it("multiple hooks with different timestamps coexist correctly", () => {
		const { task, coordinator } = setup()

		const ts1 = 1000
		const ts2 = 2000

		// Hook 1: running
		coordinator.emitHookMessage({
			ts: ts1,
			type: "say",
			say: "hook_status",
			text: JSON.stringify({ hookName: "TaskStart", status: "running" }),
			partial: false,
		})

		// Hook 2: running (different ts)
		coordinator.emitHookMessage({
			ts: ts2,
			type: "say",
			say: "hook_status",
			text: JSON.stringify({ hookName: "PreToolUse", toolName: "editor", status: "running" }),
			partial: false,
		})

		// Hook 1: completed (same ts as hook 1 running)
		coordinator.emitHookMessage({
			ts: ts1,
			type: "say",
			say: "hook_status",
			text: JSON.stringify({ hookName: "TaskStart", status: "completed" }),
			partial: false,
		})

		// Hook 2: completed (same ts as hook 2 running)
		coordinator.emitHookMessage({
			ts: ts2,
			type: "say",
			say: "hook_status",
			text: JSON.stringify({ hookName: "PreToolUse", toolName: "editor", status: "completed" }),
			partial: false,
		})

		const messages = task.messageStateHandler.getClineMessages()
		expect(messages).toHaveLength(2)
		expect(JSON.parse(messages[0].text ?? "{}").status).toBe("completed")
		expect(JSON.parse(messages[0].text ?? "{}").hookName).toBe("TaskStart")
		expect(JSON.parse(messages[1].text ?? "{}").status).toBe("completed")
		expect(JSON.parse(messages[1].text ?? "{}").hookName).toBe("PreToolUse")
	})
})
