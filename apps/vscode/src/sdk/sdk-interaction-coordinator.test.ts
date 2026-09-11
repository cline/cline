import type { AgentEvent } from "@cline/shared"
import type { ClineSayAutoRecovery, TurnPhase } from "@shared/ExtensionMessage"
import { describe, expect, it, vi } from "vitest"
import { MessageIdMinter } from "./message-id-minter"
import { MessageTranslatorState, translateSessionEvent } from "./message-translator"
import { SdkInteractionCoordinator } from "./sdk-interaction-coordinator"
import { SdkMessageCoordinator } from "./sdk-message-coordinator"
import { createTaskProxy } from "./task-proxy"
import { DEFAULT_TOOL_APPROVAL_DENIAL_REASON, EDIT_TOOL_APPROVAL_DENIAL_REASON } from "./tool-approval-denial"

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
		const messages = new SdkMessageCoordinator({ getTask: () => task })
		const coordinator = new SdkInteractionCoordinator({
			messages,
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

		expect(coordinator.resolvePendingToolApproval("too risky", "noButtonClicked", ["image.png"], ["a.ts"])).toBe(true)
		expect(recordApprovedToolMessage).not.toHaveBeenCalled()
		const expectedReason = `${DEFAULT_TOOL_APPROVAL_DENIAL_REASON} The user provided the following feedback:\n<feedback>\ntoo risky\n</feedback>`
		expect(recordDeniedToolApproval).toHaveBeenCalledWith("tool-call", "execute_command", expectedReason)
		expect(task.messageStateHandler.getClineMessages()[1]).toMatchObject({
			type: "say",
			say: "user_feedback",
			text: "too risky",
			images: ["image.png"],
			files: ["a.ts"],
			partial: false,
		})
		await expect(approvalPromise).resolves.toEqual({ approved: false, reason: expectedReason })
	})

	it("denies edit tools with an explicit file-was-not-modified reason", async () => {
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
			toolName: "editor",
			input: { path: "a.ts", old_text: "a", new_text: "b" },
			policy: { autoApprove: false },
		})
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1))

		// Feedback typed into the approval row denies the edit; the model-facing reason must
		// state the file is unchanged, or it will treat the feedback as iteration on an
		// applied edit and target old_text at content that never landed on disk.
		expect(coordinator.resolvePendingToolApproval("make them bigger", "noButtonClicked")).toBe(true)
		const result = await approvalPromise
		expect(result.approved).toBe(false)
		expect(result.reason).toContain("The file was NOT modified")
		expect(result.reason).toContain("<feedback>\nmake them bigger\n</feedback>")

		// Plain rejection (no feedback) also carries the file-unchanged statement.
		const secondApproval = coordinator.handleRequestToolApproval({
			agentId: "agent",
			conversationId: "conversation",
			iteration: 2,
			toolCallId: "tool-call-2",
			toolName: "editor",
			input: { path: "a.ts", old_text: "a", new_text: "b" },
			policy: { autoApprove: false },
		})
		// Prior messages: ask #1 + the user_feedback say from the first denial.
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages().length).toBeGreaterThanOrEqual(3))
		expect(coordinator.resolvePendingToolApproval(undefined, "noButtonClicked")).toBe(true)
		await expect(secondApproval).resolves.toEqual({ approved: false, reason: EDIT_TOOL_APPROVAL_DENIAL_REASON })
	})

	it("routes message responses as queued follow-ups without resolving pending tool approval", async () => {
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
		expect(recordDeniedToolApproval).not.toHaveBeenCalled()
		expect(setTurnPhase).toHaveBeenLastCalledWith("awaiting_approval", task.messageStateHandler.getClineMessages()[0].ts)

		expect(coordinator.resolvePendingToolApproval(undefined, "yesButtonClicked")).toBe(true)
		await expect(approvalPromise).resolves.toEqual({ approved: true })
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
		expect(task.messageStateHandler.getClineMessages()).toHaveLength(1)
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

	it("continues with a re-injected error log on the first six mistake-limit hits", async () => {
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const messages = new SdkMessageCoordinator({ getTask: () => task })
		const sleep = vi.fn().mockResolvedValue(undefined)
		// Shared id authority (production wiring): minted ids must not collide
		// with the seeded row's id, or the handler's row would merge with it.
		const minter = new MessageIdMinter()
		const coordinator = new SdkInteractionCoordinator({
			messages,
			getSessionId: () => "session-123",
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			getMinter: () => minter,
			sleep,
			isSessionActive: () => true,
		})
		// Seed a real error row so the consolidated report has content.
		messages.appendAndEmit(
			[{ ts: minter.nextId(), type: "say", say: "error", text: "Error: Executing command failed: boom", partial: false }],
			{ type: "status", payload: { sessionId: "session-123", status: "running" } },
		)

		for (let attempt = 1; attempt <= 6; attempt += 1) {
			const decision = await coordinator.handleConsecutiveMistakeLimitReached({
				iteration: attempt,
				consecutiveMistakes: 6,
				maxConsecutiveMistakes: 6,
				reason: "tool_execution_failed",
				details: "bad arguments",
			})
			expect(decision.action).toBe("continue")
			if (decision.action === "continue") {
				expect(decision.guidance).toContain("[mistake_limit_reached]")
				expect(decision.guidance).toContain("Error: Executing command failed: boom")
				expect(decision.guidance).toContain("Do NOT repeat the same tool call")
			}
		}

		// Fibonacci pacing: 3, 5, 8, 13, 21, 34 seconds.
		expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([3000, 5000, 8000, 13000, 21000, 34000])

		// ONE updatable countdown marker: every attempt re-emits the SAME row (same
		// ts, merged in place) instead of appending a new error row each time.
		const rows = task.messageStateHandler.getClineMessages()
		const recoveryRows = rows.filter((m) => m.type === "say" && m.say === "auto_recovery")
		expect(recoveryRows).toHaveLength(1)
		const payload = JSON.parse(recoveryRows[0]!.text as string) as ClineSayAutoRecovery
		expect(payload.kind).toBe("mistake")
		expect(payload.delaySeconds).toBe(34) // last backoff scheduled (Fibonacci #6)
		expect(payload.status).toBe("retrying") // last countdown ended; the retry is going out
		expect(payload.retryAt).toBeUndefined()
		// The seeded error row is untouched — recovery notices never render as say:"error".
		const errorRows = rows.filter((m) => m.type === "say" && m.say === "error")
		expect(errorRows).toHaveLength(1)
		expect(rows.some((m) => m.type === "ask")).toBe(false)
	})

	it("stops with a resume affordance and a persisted notice after six failed recoveries", async () => {
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const setTurnPhase = vi.fn()
		const recordPersistedTaskNotice = vi.fn()
		const coordinator = new SdkInteractionCoordinator({
			messages: new SdkMessageCoordinator({ getTask: () => task }),
			getSessionId: () => "session-123",
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			setTurnPhase,
			sleep: vi.fn().mockResolvedValue(undefined),
			isSessionActive: () => true,
			recordPersistedTaskNotice,
		})

		for (let i = 0; i < 6; i += 1) {
			await coordinator.handleConsecutiveMistakeLimitReached({
				iteration: i + 1,
				consecutiveMistakes: 6,
				maxConsecutiveMistakes: 6,
				reason: "tool_execution_failed",
			})
		}

		// No details: the summary falls back to the iteration.
		const decision = await coordinator.handleConsecutiveMistakeLimitReached({
			iteration: 42,
			consecutiveMistakes: 6,
			maxConsecutiveMistakes: 6,
			reason: "tool_execution_failed",
		})
		expect(decision).toEqual({
			action: "stop",
			reason: "mistake_limit_reached: tool_execution_failed at iteration 42",
		})

		const rows = task.messageStateHandler.getClineMessages()
		// The single countdown marker settled — the gave-up details live in the
		// persisted task notice and the resume affordance, not the marker payload.
		const recoveryRows = rows.filter((m) => m.type === "say" && m.say === "auto_recovery")
		expect(recoveryRows).toHaveLength(1)
		const finalPayload = JSON.parse(recoveryRows.at(-1)!.text as string) as ClineSayAutoRecovery
		expect(finalPayload.status).toBe("settled")

		const askRows = rows.filter((m) => m.type === "ask")
		expect(askRows).toHaveLength(1)
		expect(askRows[0]?.ask).toBe("resume_task")
		expect(setTurnPhase).toHaveBeenCalledWith("resumable", askRows[0]?.ts)
		expect(recordPersistedTaskNotice).toHaveBeenCalledWith(
			"session-123",
			expect.objectContaining({ text: expect.stringContaining("gave up after 6 attempts") }),
		)
	})

	it("stops when the session ends during the recovery backoff", async () => {
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const coordinator = new SdkInteractionCoordinator({
			messages: new SdkMessageCoordinator({ getTask: () => task }),
			getSessionId: () => "session-123",
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			sleep: vi.fn().mockResolvedValue(undefined),
			isSessionActive: () => false,
		})

		await expect(
			coordinator.handleConsecutiveMistakeLimitReached({
				iteration: 1,
				consecutiveMistakes: 6,
				maxConsecutiveMistakes: 6,
				reason: "tool_execution_failed",
				details: "boom",
			}),
		).resolves.toEqual({
			action: "stop",
			reason: "mistake_limit_reached: session ended during recovery backoff (tool_execution_failed: boom)",
		})

		// The countdown marker settled — no stale ring left behind.
		const recoveryRows = task.messageStateHandler
			.getClineMessages()
			.filter((m) => m.type === "say" && m.say === "auto_recovery")
		expect(recoveryRows).toHaveLength(1)
		const payload = JSON.parse(recoveryRows[0]!.text as string) as ClineSayAutoRecovery
		expect(payload.status).toBe("settled")
	})

	it("holds the retrying phase during the backoff and returns to streaming afterwards", async () => {
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const setTurnPhase = vi.fn()
		let phase: TurnPhase = "streaming"
		const getTurnPhase = vi.fn((): TurnPhase => phase)
		setTurnPhase.mockImplementation((next: TurnPhase) => {
			phase = next
		})
		const coordinator = new SdkInteractionCoordinator({
			messages: new SdkMessageCoordinator({ getTask: () => task }),
			getSessionId: () => "session-123",
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			setTurnPhase,
			getTurnPhase,
			sleep: vi.fn().mockResolvedValue(undefined),
			isSessionActive: () => true,
		})

		const decision = await coordinator.handleConsecutiveMistakeLimitReached({
			iteration: 1,
			consecutiveMistakes: 6,
			maxConsecutiveMistakes: 6,
			reason: "tool_execution_failed",
		})
		expect(decision.action).toBe("continue")
		// The countdown held the "retrying" phase (stable Cancel, no streaming
		// indicator), then handed the UI back to "streaming" once it ended.
		expect(setTurnPhase).toHaveBeenCalledWith("retrying", expect.any(Number))
		expect(setTurnPhase).toHaveBeenLastCalledWith("streaming")
	})

	it("keeps a terminal phase that landed while the backoff slept", async () => {
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const setTurnPhase = vi.fn()
		// The run completed mid-countdown: the phase is no longer ours to change.
		const getTurnPhase = vi.fn((): TurnPhase => "completed")
		const coordinator = new SdkInteractionCoordinator({
			messages: new SdkMessageCoordinator({ getTask: () => task }),
			getSessionId: () => "session-123",
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			setTurnPhase,
			getTurnPhase,
			sleep: vi.fn().mockResolvedValue(undefined),
			isSessionActive: () => true,
		})

		await coordinator.handleConsecutiveMistakeLimitReached({
			iteration: 1,
			consecutiveMistakes: 6,
			maxConsecutiveMistakes: 6,
			reason: "tool_execution_failed",
		})
		expect(setTurnPhase).toHaveBeenCalledWith("retrying", expect.any(Number))
		expect(setTurnPhase).not.toHaveBeenCalledWith("streaming")
	})

	it("shares one countdown row across API retry attempts and settles it when stopped", () => {
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const setTurnPhase = vi.fn()
		const coordinator = new SdkInteractionCoordinator({
			messages: new SdkMessageCoordinator({ getTask: () => task }),
			getSessionId: () => "session-123",
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			setTurnPhase,
		})

		expect(coordinator.isAutoRecoveryActive("api")).toBe(false)

		coordinator.beginAutoRecoveryCountdown({
			kind: "api",
			delaySeconds: 3,
		})
		expect(coordinator.isAutoRecoveryActive("api")).toBe(true)
		expect(coordinator.isAutoRecoveryActive("mistake")).toBe(false)
		expect(setTurnPhase).toHaveBeenCalledWith("retrying", expect.any(Number))

		// Second attempt of the same streak: the SAME row (same ts) is updated.
		const firstTs = task.messageStateHandler.getClineMessages().find((m) => m.say === "auto_recovery")?.ts
		coordinator.beginAutoRecoveryCountdown({
			kind: "api",
			delaySeconds: 5,
		})
		const recoveryRows = task.messageStateHandler
			.getClineMessages()
			.filter((m) => m.type === "say" && m.say === "auto_recovery")
		expect(recoveryRows).toHaveLength(1)
		expect(recoveryRows[0]!.ts).toBe(firstTs)
		let payload = JSON.parse(recoveryRows[0]!.text as string) as ClineSayAutoRecovery
		expect(payload.kind).toBe("api")
		expect(payload.delaySeconds).toBe(5)
		expect(payload.status).toBe("countdown")
		expect(payload.retryAt).toBeGreaterThan(Date.now())

		coordinator.markAutoRecoveryRetrying()
		payload = JSON.parse(
			task.messageStateHandler.getClineMessages().find((m) => m.say === "auto_recovery")!.text as string,
		) as ClineSayAutoRecovery
		expect(payload.status).toBe("retrying")
		expect(payload.retryAt).toBeUndefined()

		// Settling retires the streak: no row is active anymore.
		coordinator.settleAutoRecovery()
		expect(coordinator.isAutoRecoveryActive("api")).toBe(false)
		payload = JSON.parse(
			task.messageStateHandler.getClineMessages().find((m) => m.say === "auto_recovery")!.text as string,
		) as ClineSayAutoRecovery
		expect(payload.status).toBe("settled")
	})

	it("resets the recovery streak after a completed turn", async () => {
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const sleep = vi.fn().mockResolvedValue(undefined)
		const coordinator = new SdkInteractionCoordinator({
			messages: new SdkMessageCoordinator({ getTask: () => task }),
			getSessionId: () => "session-123",
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			sleep,
			isSessionActive: () => true,
		})
		const context = {
			consecutiveMistakes: 6,
			maxConsecutiveMistakes: 6,
			reason: "tool_execution_failed" as const,
		}

		await coordinator.handleConsecutiveMistakeLimitReached({ ...context, iteration: 1 })
		await coordinator.handleConsecutiveMistakeLimitReached({ ...context, iteration: 2 })
		expect(sleep).toHaveBeenCalledTimes(2)

		// A productive turn (see SdkController.handleTurnSettled) breaks the streak.
		coordinator.resetMistakeEscalation()
		await coordinator.handleConsecutiveMistakeLimitReached({ ...context, iteration: 3 })
		expect(sleep).toHaveBeenCalledTimes(3)
		// The streak restarted at attempt 1 (3s delay), not attempt 3 (8s).
		expect(sleep.mock.calls[2]?.[0]).toBe(3000)
		const recoveryRows = task.messageStateHandler
			.getClineMessages()
			.filter((m) => m.type === "say" && m.say === "auto_recovery")
		// First streak's marker settled; the new streak minted a fresh marker row.
		expect(recoveryRows).toHaveLength(2)
		const firstPayload = JSON.parse(recoveryRows[0]!.text as string) as ClineSayAutoRecovery
		const secondPayload = JSON.parse(recoveryRows[1]!.text as string) as ClineSayAutoRecovery
		expect(firstPayload.status).toBe("settled")
		expect(secondPayload.status).toBe("retrying")
		expect(recoveryRows[1]!.ts).not.toBe(recoveryRows[0]!.ts)
	})

	it("clears pending tool approvals as rejected", async () => {
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
			toolName: "read_files",
			input: {},
			policy: { autoApprove: false },
		})
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1))

		coordinator.clearPending("Task cancelled")

		await expect(approvalPromise).resolves.toEqual({ approved: false, reason: "Task cancelled" })
		expect(recordDeniedToolApproval).toHaveBeenCalledWith("tool-call", "read_files", "Task cancelled")
		expect(coordinator.resolvePendingToolApproval(undefined, "yesButtonClicked")).toBe(false)
	})

	it("awaits onToolApprovalAsk before emitting the approval ask", async () => {
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const events: string[] = []
		let releaseHook: () => void = () => {}
		const onToolApprovalAsk = vi.fn().mockImplementation(async () => {
			events.push("hook-start")
			await new Promise<void>((resolve) => {
				releaseHook = resolve
			})
			events.push("hook-end")
		})
		const coordinator = new SdkInteractionCoordinator({
			messages: new SdkMessageCoordinator({ getTask: () => task }),
			getSessionId: () => "session-123",
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			onToolApprovalAsk,
		})

		const approvalPromise = coordinator.handleRequestToolApproval({
			agentId: "agent",
			conversationId: "conversation",
			iteration: 1,
			toolCallId: "tool-call",
			toolName: "editor",
			input: { path: "a.ts", old_text: "a", new_text: "b" },
			policy: { autoApprove: false },
		})

		await vi.waitFor(() => expect(events).toEqual(["hook-start"]))
		// The ask message must not exist while the diff preview is still opening.
		expect(task.messageStateHandler.getClineMessages()).toHaveLength(0)

		releaseHook()
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1))
		expect(onToolApprovalAsk).toHaveBeenCalledWith(expect.objectContaining({ toolCallId: "tool-call", toolName: "editor" }))

		expect(coordinator.resolvePendingToolApproval(undefined, "yesButtonClicked")).toBe(true)
		await expect(approvalPromise).resolves.toEqual({ approved: true })
	})

	it("does not invoke onToolApprovalAsk for auto-approved tools", async () => {
		const onToolApprovalAsk = vi.fn().mockResolvedValue(undefined)
		const coordinator = new SdkInteractionCoordinator({
			messages: new SdkMessageCoordinator({ getTask: () => createTaskProxy("session-123", vi.fn(), vi.fn()) }),
			getSessionId: () => "session-123",
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			shouldAutoApproveTool: () => true,
			onToolApprovalAsk,
		})

		await expect(
			coordinator.handleRequestToolApproval({
				agentId: "agent",
				conversationId: "conversation",
				iteration: 1,
				toolCallId: "tool-call",
				toolName: "editor",
				input: { path: "a.ts", old_text: "a", new_text: "b" },
				policy: { autoApprove: false },
			}),
		).resolves.toEqual({ approved: true })
		expect(onToolApprovalAsk).not.toHaveBeenCalled()
	})

	it("still shows the approval ask when onToolApprovalAsk throws", async () => {
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const coordinator = new SdkInteractionCoordinator({
			messages: new SdkMessageCoordinator({ getTask: () => task }),
			getSessionId: () => "session-123",
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			onToolApprovalAsk: vi.fn().mockRejectedValue(new Error("preview failed")),
		})

		const approvalPromise = coordinator.handleRequestToolApproval({
			agentId: "agent",
			conversationId: "conversation",
			iteration: 1,
			toolCallId: "tool-call",
			toolName: "editor",
			input: { path: "a.ts", old_text: "a", new_text: "b" },
			policy: { autoApprove: false },
		})

		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1))
		expect(coordinator.resolvePendingToolApproval(undefined, "yesButtonClicked")).toBe(true)
		await expect(approvalPromise).resolves.toEqual({ approved: true })
	})
})
