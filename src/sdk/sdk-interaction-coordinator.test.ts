import { describe, expect, it, vi } from "vitest"
import { SdkInteractionCoordinator } from "./sdk-interaction-coordinator"
import { SdkMessageCoordinator } from "./sdk-message-coordinator"
import { createTaskProxy } from "./task-proxy"

vi.mock("./message-translator", () => ({
	sdkToolToClineSayTool: vi.fn((toolName: string, input: unknown) => ({ tool: toolName, input })),
}))

vi.mock("./webview-grpc-bridge", () => ({
	pushMessageToWebview: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@core/storage/disk", () => ({
	saveClineMessages: vi.fn().mockResolvedValue(undefined),
}))

describe("SdkInteractionCoordinator", () => {
	it("emits a tool approval ask and resolves approval from askResponse state", async () => {
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const messages = new SdkMessageCoordinator({ getTask: () => task })
		const listener = vi.fn()
		const postStateToWebview = vi.fn().mockResolvedValue(undefined)
		const coordinator = new SdkInteractionCoordinator({
			messages,
			getSessionId: () => "session-123",
			postStateToWebview,
		})
		messages.onSessionEvent(listener)

		const approvalPromise = coordinator.handleRequestToolApproval({
			agentId: "agent",
			conversationId: "conversation",
			iteration: 1,
			toolCallId: "tool-call",
			toolName: "read_files",
			input: { path: "README.md" },
			policy: { autoApprove: false },
		})
		await vi.waitFor(() => expect(postStateToWebview).toHaveBeenCalled())

		const clineMessages = task.messageStateHandler.getClineMessages()
		expect(clineMessages).toHaveLength(1)
		expect(clineMessages[0].type).toBe("ask")
		expect(clineMessages[0].ask).toBe("tool")
		expect(listener).toHaveBeenCalledOnce()

		expect(coordinator.resolvePendingToolApproval(undefined, "yesButtonClicked")).toBe(true)
		await expect(approvalPromise).resolves.toEqual({ approved: true })
	})

	it("resolves denied tool approval with the user reason", async () => {
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const coordinator = new SdkInteractionCoordinator({
			messages: new SdkMessageCoordinator({ getTask: () => task }),
			getSessionId: () => "session-123",
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
		})

		const approvalPromise = coordinator.handleRequestToolApproval({
			agentId: "agent",
			conversationId: "conversation",
			iteration: 1,
			toolCallId: "tool-call",
			toolName: "execute_command",
			input: { command: "npm test" },
			policy: { autoApprove: false },
		})
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1))

		expect(coordinator.resolvePendingToolApproval("too risky", "noButtonClicked")).toBe(true)
		await expect(approvalPromise).resolves.toEqual({ approved: false, reason: "too risky" })
	})

	it("emits ask_question and resolves it with rendered user feedback", async () => {
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const messages = new SdkMessageCoordinator({ getTask: () => task })
		const coordinator = new SdkInteractionCoordinator({
			messages,
			getSessionId: () => "session-123",
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
		})

		const answerPromise = coordinator.handleAskQuestion("Continue?", ["Yes"], undefined)
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1))

		await new Promise((resolve) => setTimeout(resolve, 1))
		expect(coordinator.resolvePendingAskQuestion("yes")).toBe(true)
		await expect(answerPromise).resolves.toBe("yes")
		expect(task.messageStateHandler.getClineMessages()).toMatchObject([
			{ type: "ask", ask: "followup" },
			{ type: "say", say: "user_feedback", text: "yes" },
		])
	})

	it("clears pending tool approvals as rejected", async () => {
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const coordinator = new SdkInteractionCoordinator({
			messages: new SdkMessageCoordinator({ getTask: () => task }),
			getSessionId: () => "session-123",
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
		})

		const approvalPromise = coordinator.handleRequestToolApproval({
			agentId: "agent",
			conversationId: "conversation",
			iteration: 1,
			toolCallId: "tool-call",
			toolName: "read_files",
			input: {},
			policy: { autoApprove: false },
		})
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1))

		coordinator.clearPending("Task cancelled")

		await expect(approvalPromise).resolves.toEqual({ approved: false, reason: "Task cancelled" })
		expect(coordinator.resolvePendingToolApproval(undefined, "yesButtonClicked")).toBe(false)
	})
})
