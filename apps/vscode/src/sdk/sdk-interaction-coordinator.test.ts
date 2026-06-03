import type { AgentEvent } from "@cline/shared"
import { describe, expect, it, vi } from "vitest"
import { MessageTranslatorState, translateSessionEvent } from "./message-translator"
import { SdkInteractionCoordinator } from "./sdk-interaction-coordinator"
import { SdkMessageCoordinator } from "./sdk-message-coordinator"
import { createTaskProxy } from "./task-proxy"
import { DEFAULT_TOOL_APPROVAL_DENIAL_REASON, USER_MESSAGE_TOOL_APPROVAL_DENIAL_REASON } from "./tool-approval-denial"

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
		const recordApprovedToolMessage = vi.fn()
		const coordinator = new SdkInteractionCoordinator({
			messages,
			getSessionId: () => "session-123",
			postStateToWebview,
			recordApprovedToolMessage,
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
		expect(JSON.parse(clineMessages[0].text || "{}")).toMatchObject({ tool: "readFile", path: "README.md" })
		expect(listener).toHaveBeenCalledOnce()

		expect(coordinator.resolvePendingToolApproval(undefined, "yesButtonClicked")).toBe(true)
		expect(recordApprovedToolMessage).toHaveBeenCalledWith("tool-call", clineMessages[0].ts)
		await expect(approvalPromise).resolves.toEqual({ approved: true })
	})

	it("records the real approval row timestamp that the translator reuses", async () => {
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const messages = new SdkMessageCoordinator({ getTask: () => task })
		const state = new MessageTranslatorState()
		const coordinator = new SdkInteractionCoordinator({
			messages,
			getSessionId: () => "session-123",
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			getMinter: () => state.getMinter(),
			recordApprovedToolMessage: (toolCallId, messageTs) => state.recordApprovedToolMessageTs(toolCallId, messageTs),
		})

		const approvalPromise = coordinator.handleRequestToolApproval({
			agentId: "agent",
			conversationId: "conversation",
			iteration: 1,
			toolCallId: "tool-call",
			toolName: "editor",
			input: { path: "calculator.py", old_text: "# comment", new_text: "" },
			policy: { autoApprove: false },
		})
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1))
		const approvalTs = task.messageStateHandler.getClineMessages()[0].ts

		expect(coordinator.resolvePendingToolApproval(undefined, "yesButtonClicked")).toBe(true)
		await expect(approvalPromise).resolves.toEqual({ approved: true })

		const result = translateSessionEvent(
			{
				type: "agent_event",
				payload: {
					sessionId: "session-123",
					event: {
						type: "content_start",
						contentType: "tool",
						toolName: "editor",
						toolCallId: "tool-call",
						input: { path: "calculator.py", old_text: "# comment", new_text: "" },
					} as AgentEvent,
				},
			},
			state,
		)

		expect(result.messages[0]).toMatchObject({ ts: approvalTs, type: "say", say: "tool", partial: true })
	})

	it("resolves denied tool approval with the user reason", async () => {
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const recordApprovedToolMessage = vi.fn()
		const recordDeniedToolApproval = vi.fn()
		const coordinator = new SdkInteractionCoordinator({
			messages: new SdkMessageCoordinator({ getTask: () => task }),
			getSessionId: () => "session-123",
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			recordApprovedToolMessage,
			recordDeniedToolApproval,
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

		const clineMessages = task.messageStateHandler.getClineMessages()
		expect(clineMessages[0]).toMatchObject({ type: "ask", ask: "command", text: "npm test" })

		expect(coordinator.resolvePendingToolApproval("too risky", "noButtonClicked")).toBe(true)
		expect(recordApprovedToolMessage).not.toHaveBeenCalled()
		expect(recordDeniedToolApproval).toHaveBeenCalledWith("tool-call", "execute_command", "too risky")
		await expect(approvalPromise).resolves.toEqual({ approved: false, reason: "too risky" })
	})

	it("routes message responses as follow-ups instead of tool denial text", async () => {
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const setTurnPhase = vi.fn()
		const recordDeniedToolApproval = vi.fn()
		const coordinator = new SdkInteractionCoordinator({
			messages: new SdkMessageCoordinator({ getTask: () => task }),
			getSessionId: () => "session-123",
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			setTurnPhase,
			recordDeniedToolApproval,
		})

		const approvalPromise = coordinator.handleRequestToolApproval({
			agentId: "agent",
			conversationId: "conversation",
			iteration: 1,
			toolCallId: "tool-call",
			toolName: "fetch_web_content",
			input: { requests: [{ url: "https://example.com", prompt: "read it" }] },
			policy: { autoApprove: false },
		})
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1))

		expect(coordinator.resolvePendingToolApproval("just give me an answer", "messageResponse")).toBe(false)
		await expect(approvalPromise).resolves.toEqual({
			approved: false,
			reason: USER_MESSAGE_TOOL_APPROVAL_DENIAL_REASON,
		})
		expect(recordDeniedToolApproval).toHaveBeenCalledWith(
			"tool-call",
			"fetch_web_content",
			USER_MESSAGE_TOOL_APPROVAL_DENIAL_REASON,
		)
		expect(setTurnPhase).toHaveBeenLastCalledWith("streaming")
	})

	it("records generic no-button approval denials for UI suppression", async () => {
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const recordDeniedToolApproval = vi.fn()
		const coordinator = new SdkInteractionCoordinator({
			messages: new SdkMessageCoordinator({ getTask: () => task }),
			getSessionId: () => "session-123",
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			recordDeniedToolApproval,
		})

		const approvalPromise = coordinator.handleRequestToolApproval({
			agentId: "agent",
			conversationId: "conversation",
			iteration: 1,
			toolCallId: "tool-call",
			toolName: "fetch_web_content",
			input: { requests: [{ url: "https://example.com", prompt: "read it" }] },
			policy: { autoApprove: false },
		})
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1))

		expect(coordinator.resolvePendingToolApproval(undefined, "noButtonClicked")).toBe(true)
		await expect(approvalPromise).resolves.toEqual({
			approved: false,
			reason: DEFAULT_TOOL_APPROVAL_DENIAL_REASON,
		})
		expect(recordDeniedToolApproval).toHaveBeenCalledWith(
			"tool-call",
			"fetch_web_content",
			DEFAULT_TOOL_APPROVAL_DENIAL_REASON,
		)
	})

	it("auto-approves without emitting UI when the live settings allow the tool", async () => {
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const postStateToWebview = vi.fn().mockResolvedValue(undefined)
		const recordApprovedToolMessage = vi.fn()
		const coordinator = new SdkInteractionCoordinator({
			messages: new SdkMessageCoordinator({ getTask: () => task }),
			getSessionId: () => "session-123",
			postStateToWebview,
			shouldAutoApproveTool: () => true,
			recordApprovedToolMessage,
		})

		await expect(
			coordinator.handleRequestToolApproval({
				agentId: "agent",
				conversationId: "conversation",
				iteration: 1,
				toolCallId: "tool-call",
				toolName: "run_commands",
				input: { command: "npm test" },
				policy: { autoApprove: false },
			}),
		).resolves.toEqual({ approved: true })

		expect(task.messageStateHandler.getClineMessages()).toHaveLength(0)
		expect(postStateToWebview).not.toHaveBeenCalled()
		expect(recordApprovedToolMessage).not.toHaveBeenCalled()
	})

	it("auto-approves without emitting UI when the SDK policy already allows the tool", async () => {
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const postStateToWebview = vi.fn().mockResolvedValue(undefined)
		const recordApprovedToolMessage = vi.fn()
		const coordinator = new SdkInteractionCoordinator({
			messages: new SdkMessageCoordinator({ getTask: () => task }),
			getSessionId: () => "session-123",
			postStateToWebview,
			shouldAutoApproveTool: () => false,
			recordApprovedToolMessage,
		})

		await expect(
			coordinator.handleRequestToolApproval({
				agentId: "agent",
				conversationId: "conversation",
				iteration: 1,
				toolCallId: "tool-call",
				toolName: "run_commands",
				input: { command: "npm test" },
				policy: { autoApprove: true },
			}),
		).resolves.toEqual({ approved: true })

		expect(task.messageStateHandler.getClineMessages()).toHaveLength(0)
		expect(postStateToWebview).not.toHaveBeenCalled()
		expect(recordApprovedToolMessage).not.toHaveBeenCalled()
	})

	it("emits an MCP approval ask with server, tool, and arguments", async () => {
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const coordinator = new SdkInteractionCoordinator({
			messages: new SdkMessageCoordinator({ getTask: () => task }),
			getSessionId: () => "session-123",
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
		})

		void coordinator.handleRequestToolApproval({
			agentId: "agent",
			conversationId: "conversation",
			iteration: 1,
			toolCallId: "tool-call",
			toolName: "github__search-repos",
			input: { query: "cline" },
			policy: { autoApprove: false },
		})
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1))

		const [message] = task.messageStateHandler.getClineMessages()
		expect(message).toMatchObject({ type: "ask", ask: "use_mcp_server", partial: false })
		expect(JSON.parse(message.text || "{}")).toEqual({
			type: "use_mcp_tool",
			serverName: "github",
			toolName: "search-repos",
			arguments: '{\n  "query": "cline"\n}',
		})
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
