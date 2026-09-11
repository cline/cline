import type { ClineMessage } from "@shared/ExtensionMessage"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { StateManager } from "@/core/storage/StateManager"
import { SdkModeCoordinator, type SdkModeCoordinatorOptions } from "./sdk-mode-coordinator"

vi.mock("@/shared/services/Logger", () => ({
	Logger: {
		debug: vi.fn(),
		error: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
	},
}))

vi.mock("@core/storage/disk", () => ({
	saveClineMessages: vi.fn().mockResolvedValue(undefined),
}))

describe("SdkModeCoordinator", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("preserves pending input by returning false when toggling mode without an active session", async () => {
		const { coordinator, state, options } = makeCoordinator({ mode: "act" })

		await expect(coordinator.togglePlanActMode("plan")).resolves.toBe(false)

		expect(state.mode).toBe("plan")
		expect(options.postStateToWebview).toHaveBeenCalledOnce()
	})

	it("returns false without side effects when toggling to the current mode", async () => {
		const { coordinator, options } = makeCoordinator({ mode: "plan" })

		await expect(coordinator.togglePlanActMode("plan")).resolves.toBe(false)

		expect(options.stateManager.setGlobalState).not.toHaveBeenCalled()
		expect(options.postStateToWebview).not.toHaveBeenCalled()
	})

	it("rebuilds an active session for the new mode while preserving the session id", async () => {
		const activeSession = makeActiveSession()
		const task = makeTask("old-session")
		const { coordinator, options } = makeCoordinator({ activeSession, task })

		await coordinator.rebuildSessionForMode("plan")

		expect(options.loadInitialMessages).toHaveBeenCalledWith(activeSession.sdkHost, "old-session")
		expect(options.sessionConfigBuilder.build).toHaveBeenCalledWith({
			cwd: "/workspace",
			mode: "plan",
		})
		expect(options.buildStartSessionInput).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "old-session" }), {
			cwd: "/workspace",
			mode: "plan",
		})
		expect(options.sessions.replaceActiveSession).toHaveBeenCalledWith({
			expectedSession: activeSession,
			startInput: { prompt: "start" },
			initialMessages: [{ role: "user", content: "hello" }],
			disposeReason: "modeChange",
		})
		expect(task.taskId).toBe("new-session")
		expect(options.resetMessageTranslator).toHaveBeenCalledOnce()
		expect(options.sessions.fireAndForgetSend).not.toHaveBeenCalled()
		// Once before the rebuild (responsive toggle) and once after (messages
		// finalized during the rebuild ride on the state post).
		expect(options.postStateToWebview).toHaveBeenCalledTimes(2)
	})

	it("publishes the new mode before active session replacement finishes", async () => {
		const activeSession = makeActiveSession()
		const task = makeTask("old-session")
		const { coordinator, options, state } = makeCoordinator({ activeSession, task })
		let finishReplacement!: () => void
		const replacementGate = new Promise<void>((resolve) => {
			finishReplacement = resolve
		})
		options.sessions.replaceActiveSession.mockImplementationOnce(async () => {
			await replacementGate
			return {
				startResult: { sessionId: "new-session" },
				sdkHost: { send: vi.fn() },
			}
		})

		const toggle = coordinator.togglePlanActMode("act")
		await vi.waitFor(() => expect(options.sessions.replaceActiveSession).toHaveBeenCalledOnce())

		expect(state.mode).toBe("act")
		expect(options.postStateToWebview).toHaveBeenCalledOnce()
		expect(options.postStateToWebview.mock.invocationCallOrder[0]).toBeLessThan(
			options.sessions.replaceActiveSession.mock.invocationCallOrder[0],
		)

		finishReplacement()
		await toggle
	})

	it("rolls the mode back when replacement is refused and the old session is still active", async () => {
		// A queued turn started running between the toggle and the rebuild, so
		// replaceActiveSession refuses; the still-active session has plan tools.
		const activeSession = makeActiveSession()
		const task = makeTask("old-session", planMessages())
		const { coordinator, options, state } = makeCoordinator({ activeSession, task, mode: "plan" })
		options.sessions.replaceActiveSession.mockResolvedValueOnce(undefined)

		await expect(coordinator.togglePlanActMode("act")).resolves.toBe(false)

		expect(state.mode).toBe("plan")
		expect(options.sessions.fireAndForgetSend).not.toHaveBeenCalled()
		// Early post (optimistic act) plus the rollback post.
		expect(options.postStateToWebview).toHaveBeenCalledTimes(2)
	})

	it("keeps the new mode when replacement is refused because another session took over", async () => {
		const activeSession = makeActiveSession()
		const task = makeTask("old-session", planMessages())
		const { coordinator, options, state } = makeCoordinator({ activeSession, task, mode: "plan" })
		options.sessions.replaceActiveSession.mockResolvedValueOnce(undefined)
		// By the time the refusal is observed, a different session is active; the
		// superseding flow owns the mode, so the setting must not be clobbered.
		options.sessions.getActiveSession
			.mockReturnValueOnce(activeSession) // togglePlanActMode gate read
			.mockReturnValueOnce(activeSession) // performRebuild initial read
			.mockReturnValue({ ...makeActiveSession(), sessionId: "other-session" })

		await expect(coordinator.togglePlanActMode("act")).resolves.toBe(false)

		expect(state.mode).toBe("act")
		expect(options.sessions.fireAndForgetSend).not.toHaveBeenCalled()
	})

	it("auto-continues a plan -> act toggle when the agent is idle after presenting its plan", async () => {
		const activeSession = makeActiveSession()
		const task = makeTask("old-session", planMessages())
		const { coordinator, options, state } = makeCoordinator({
			activeSession,
			task,
			mode: "plan",
			turnPhase: "awaiting_followup",
		})

		// No typed input was consumed, so the webview should not clear it.
		await expect(coordinator.togglePlanActMode("act")).resolves.toBe(false)

		expect(state.mode).toBe("act")
		expect(options.sessions.setRunning).toHaveBeenCalledWith(true)
		expect(options.onAutoContinueStarting).toHaveBeenCalledOnce()
		expect(options.sessions.fireAndForgetSend).toHaveBeenCalledWith(
			expect.anything(),
			"new-session",
			"The user approved switching to act mode. Continue with the approved plan now.",
			undefined,
			undefined,
		)
		// Canned prompt is not echoed as a user message.
		expect(options.messages.appendAndEmit).not.toHaveBeenCalled()
	})

	it("auto-continues when completed request bookkeeping trails the presented plan", async () => {
		const activeSession = makeActiveSession()
		const task = makeTask("old-session", [
			{ ts: 1, type: "say", say: "task", text: "Create a plan.", partial: false },
			{ ts: 2, type: "say", say: "api_req_started", text: "{}", partial: false },
			{ ts: 3, type: "say", say: "reasoning", text: "Planning.", partial: false },
			{ ts: 4, type: "say", say: "plan_completion_result", text: "Implement the plan.", partial: false },
			{
				ts: 5,
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({ tokensIn: 10, tokensOut: 5, cost: 0.01 }),
				partial: false,
			},
		])
		const { coordinator, options } = makeCoordinator({
			activeSession,
			task,
			mode: "plan",
			turnPhase: "awaiting_followup",
		})

		await coordinator.togglePlanActMode("act")

		expect(options.sessions.fireAndForgetSend).toHaveBeenCalledWith(
			expect.anything(),
			"new-session",
			"The user approved switching to act mode. Continue with the approved plan now.",
			undefined,
			undefined,
		)
	})

	it("auto-continues a genuine completed plan after the task is reopened", async () => {
		const activeSession = makeActiveSession()
		const task = makeTask("old-session", [
			{ ts: 1, type: "say", say: "task", text: "Create a plan.", partial: false },
			{ ts: 2, type: "say", say: "plan_completion_result", text: "Implement the plan.", partial: false },
			{ ts: 3, type: "ask", ask: "resume_completed_task", text: "", partial: false },
		])
		const { coordinator, options } = makeCoordinator({
			activeSession,
			task,
			mode: "plan",
			turnPhase: "completed",
		})

		await coordinator.togglePlanActMode("act")

		expect(options.sessions.fireAndForgetSend).toHaveBeenCalledWith(
			expect.anything(),
			"new-session",
			"The user approved switching to act mode. Continue with the approved plan now.",
			undefined,
			undefined,
		)
	})

	it("submits typed chatContent as the continuation when toggling plan -> act on a presented plan", async () => {
		const activeSession = makeActiveSession()
		const task = makeTask("old-session", planMessages())
		const { coordinator, options } = makeCoordinator({
			activeSession,
			task,
			mode: "plan",
			turnPhase: "awaiting_followup",
		})

		// Typed input was consumed, so the webview should clear it.
		await expect(
			coordinator.togglePlanActMode("act", {
				message: "  go ahead and implement step 1  ",
				images: [],
				files: [],
			}),
		).resolves.toBe(true)

		expect(options.sessions.fireAndForgetSend).toHaveBeenCalledWith(
			expect.anything(),
			"new-session",
			"go ahead and implement step 1",
			undefined,
			undefined,
		)
		expect(options.messages.appendAndEmit).toHaveBeenCalledWith(
			[expect.objectContaining({ say: "user_feedback", text: "go ahead and implement step 1" })],
			expect.anything(),
		)
	})

	it("forwards attachments alongside the typed message when auto-continuing", async () => {
		const activeSession = makeActiveSession()
		const task = makeTask("old-session", planMessages())
		const { coordinator, options } = makeCoordinator({
			activeSession,
			task,
			mode: "plan",
			turnPhase: "awaiting_followup",
		})

		await expect(
			coordinator.togglePlanActMode("act", {
				message: "use this screenshot",
				images: ["data:image/png;base64,abc"],
				files: ["/tmp/notes.md"],
			}),
		).resolves.toBe(true)

		expect(options.sessions.fireAndForgetSend).toHaveBeenCalledWith(
			expect.anything(),
			"new-session",
			"use this screenshot",
			["data:image/png;base64,abc"],
			["/tmp/notes.md"],
		)
		expect(options.messages.appendAndEmit).toHaveBeenCalledWith(
			[
				expect.objectContaining({
					say: "user_feedback",
					text: "use this screenshot",
					images: ["data:image/png;base64,abc"],
					files: ["/tmp/notes.md"],
				}),
			],
			expect.anything(),
		)
	})

	it("consumes attachment-only chatContent and sends it with the canned prompt", async () => {
		const activeSession = makeActiveSession()
		const task = makeTask("old-session", planMessages())
		const { coordinator, options } = makeCoordinator({
			activeSession,
			task,
			mode: "plan",
			turnPhase: "awaiting_followup",
		})

		// Attachments alone count as consumed content, so the webview clears them.
		await expect(
			coordinator.togglePlanActMode("act", {
				message: undefined,
				images: ["data:image/png;base64,abc"],
				files: [],
			}),
		).resolves.toBe(true)

		expect(options.sessions.fireAndForgetSend).toHaveBeenCalledWith(
			expect.anything(),
			"new-session",
			"The user approved switching to act mode. Continue with the approved plan now.",
			["data:image/png;base64,abc"],
			undefined,
		)
		expect(options.messages.appendAndEmit).toHaveBeenCalledWith(
			[
				expect.objectContaining({
					say: "user_feedback",
					text: "",
					images: ["data:image/png;base64,abc"],
				}),
			],
			expect.anything(),
		)
	})

	it("resets the running state and reports an error phase when the continuation send setup fails", async () => {
		const activeSession = makeActiveSession()
		const task = makeTask("old-session", planMessages())
		const { coordinator, options, state } = makeCoordinator({
			activeSession,
			task,
			mode: "plan",
			turnPhase: "awaiting_followup",
		})
		options.resolveContextMentions.mockRejectedValueOnce(new Error("mention resolution failed"))

		// The send never happened, so the webview must keep the composer content.
		await expect(
			coordinator.togglePlanActMode("act", {
				message: "see @/broken/path",
				images: [],
				files: [],
			}),
		).resolves.toBe(false)

		expect(options.onAutoContinueStarting).toHaveBeenCalledOnce()
		expect(options.sessions.fireAndForgetSend).not.toHaveBeenCalled()
		// The optimistic running flip is undone and the phase moves to error.
		expect(options.sessions.setRunning).toHaveBeenLastCalledWith(false)
		expect(options.onAutoContinueFailed).toHaveBeenCalledOnce()
		// Mentions resolve before the echo, so the unsent message is never
		// echoed into the transcript; only the error message is appended.
		expect(options.messages.appendAndEmit).toHaveBeenCalledOnce()
		expect(options.messages.appendAndEmit).toHaveBeenCalledWith(
			[expect.objectContaining({ say: "error" })],
			expect.anything(),
		)
		// The session WAS replaced with act-mode tools before the throw, so the
		// mode setting must not roll back.
		expect(state.mode).toBe("act")
	})

	it("does not auto-continue while a follow-up question is pending", async () => {
		// handleAskQuestion sets the phase to awaiting_followup but blocks the
		// turn mid-run, so the session is still flagged running.
		const activeSession = makeActiveSession({ isRunning: true })
		const task = makeTask("old-session")
		const { coordinator, options, state } = makeCoordinator({
			activeSession,
			task,
			mode: "plan",
			turnPhase: "awaiting_followup",
		})

		await expect(
			coordinator.togglePlanActMode("act", {
				message: "use postgres",
				images: [],
				files: [],
			}),
		).resolves.toBe(false)

		expect(state.mode).toBe("act")
		expect(options.sessions.fireAndForgetSend).not.toHaveBeenCalled()
		expect(options.onAutoContinueStarting).not.toHaveBeenCalled()
	})

	it("does not auto-continue a plan -> act toggle while a turn is running", async () => {
		const activeSession = makeActiveSession({ isRunning: true })
		const task = makeTask("old-session")
		const { coordinator, options, state } = makeCoordinator({
			activeSession,
			task,
			mode: "plan",
			turnPhase: "streaming",
		})

		await expect(coordinator.togglePlanActMode("act")).resolves.toBe(false)

		expect(state.mode).toBe("act")
		expect(options.sessions.setRunning).not.toHaveBeenCalledWith(true)
		expect(options.sessions.fireAndForgetSend).not.toHaveBeenCalled()
	})

	it("does not auto-continue an awaiting turn whose last message is not a plan", async () => {
		const activeSession = makeActiveSession()
		const task = makeTask("old-session", [
			{ ts: 1, type: "say", say: "completion_result", text: "Finished the previous act turn.", partial: false },
		])
		const { coordinator, options } = makeCoordinator({
			activeSession,
			task,
			mode: "plan",
			turnPhase: "awaiting_followup",
		})

		await expect(
			coordinator.togglePlanActMode("act", {
				message: "  go ahead and implement step 1  ",
				images: [],
				files: [],
			}),
		).resolves.toBe(false)

		expect(options.sessions.fireAndForgetSend).not.toHaveBeenCalled()
	})

	it("does not auto-continue a stale plan when the latest completed assistant result is from act mode", async () => {
		const activeSession = makeActiveSession()
		const task = makeTask("old-session", [
			{ ts: 1, type: "say", say: "plan_completion_result", text: "Old plan.", partial: false },
			{ ts: 2, type: "say", say: "api_req_started", text: JSON.stringify({ cost: 0.01 }), partial: false },
			{ ts: 3, type: "say", say: "completion_result", text: "Act work finished.", partial: false },
			{ ts: 4, type: "say", say: "api_req_started", text: JSON.stringify({ cost: 0.02 }), partial: false },
		])
		const { coordinator, options } = makeCoordinator({
			activeSession,
			task,
			mode: "plan",
			turnPhase: "awaiting_followup",
		})

		await coordinator.togglePlanActMode("act")

		expect(options.sessions.fireAndForgetSend).not.toHaveBeenCalled()
	})

	it("does not auto-continue a reopened completed act result", async () => {
		const activeSession = makeActiveSession()
		const task = makeTask("old-session", [
			{ ts: 1, type: "say", say: "completion_result", text: "Act work finished.", partial: false },
			{ ts: 2, type: "ask", ask: "resume_completed_task", text: "", partial: false },
		])
		const { coordinator, options } = makeCoordinator({
			activeSession,
			task,
			mode: "plan",
			turnPhase: "completed",
		})

		await coordinator.togglePlanActMode("act")

		expect(options.sessions.fireAndForgetSend).not.toHaveBeenCalled()
	})

	it("does not auto-continue an accidental act -> plan -> act round trip on completed act work", async () => {
		const activeSession = makeActiveSession()
		const task = makeTask("old-session", [
			{ ts: 1, type: "say", say: "plan_completion_result", text: "Old plan.", partial: false },
			{ ts: 2, type: "say", say: "completion_result", text: "Latest act result.", partial: false },
			{ ts: 3, type: "ask", ask: "resume_completed_task", text: "", partial: false },
		])
		const { coordinator, options } = makeCoordinator({
			activeSession,
			task,
			mode: "act",
			turnPhase: "completed",
		})

		await coordinator.togglePlanActMode("plan")
		await coordinator.togglePlanActMode("act")

		expect(options.sessions.fireAndForgetSend).not.toHaveBeenCalled()
	})

	it("does not auto-continue a partial plan result", async () => {
		const activeSession = makeActiveSession()
		const task = makeTask("old-session", [
			{ ts: 1, type: "say", say: "plan_completion_result", text: "Still streaming.", partial: true },
			{ ts: 2, type: "say", say: "api_req_started", text: "{}", partial: false },
		])
		const { coordinator, options } = makeCoordinator({
			activeSession,
			task,
			mode: "plan",
			turnPhase: "awaiting_followup",
		})

		await coordinator.togglePlanActMode("act")

		expect(options.sessions.fireAndForgetSend).not.toHaveBeenCalled()
	})

	it("does not auto-continue on act -> plan toggle even when the agent is awaiting followup", async () => {
		const activeSession = makeActiveSession()
		const task = makeTask("old-session")
		const { coordinator, options, state } = makeCoordinator({
			activeSession,
			task,
			mode: "act",
			turnPhase: "awaiting_followup",
		})

		await coordinator.togglePlanActMode("plan", {
			message: "draft message",
			images: [],
			files: [],
		})

		expect(state.mode).toBe("plan")
		expect(options.sessions.fireAndForgetSend).not.toHaveBeenCalled()
	})

	it("does not mark a live continuation as failed when the post-send state post rejects", async () => {
		const activeSession = makeActiveSession()
		const task = makeTask("old-session", planMessages())
		const { coordinator, options } = makeCoordinator({
			activeSession,
			task,
			mode: "plan",
			turnPhase: "awaiting_followup",
		})
		options.postStateToWebview.mockRejectedValueOnce(new Error("webview gone"))

		// The continuation was already handed to the session, so the composer
		// content counts as consumed and the run must not be flagged as failed.
		await expect(
			coordinator.togglePlanActMode("act", {
				message: "go ahead",
				images: [],
				files: [],
			}),
		).resolves.toBe(true)

		expect(options.sessions.fireAndForgetSend).toHaveBeenCalledOnce()
		expect(options.sessions.setRunning).not.toHaveBeenCalledWith(false)
		expect(options.onAutoContinueFailed).not.toHaveBeenCalled()
		// Only the user_feedback echo was emitted, no mode-switch error message.
		expect(options.messages.appendAndEmit).toHaveBeenCalledOnce()
		expect(options.messages.appendAndEmit).toHaveBeenCalledWith(
			[expect.objectContaining({ say: "user_feedback", text: "go ahead" })],
			expect.anything(),
		)
	})

	it("preserves composer content when the rebuild aborts on a cline auth error", async () => {
		const activeSession = makeActiveSession()
		const task = makeTask("old-session", planMessages())
		const { coordinator, options, state } = makeCoordinator({
			activeSession,
			task,
			mode: "plan",
			turnPhase: "awaiting_followup",
			config: {
				providerId: "cline",
				modelId: "cline-model",
				apiKey: undefined,
			},
		})

		// The auth guard returns before the continuation is echoed or sent, so
		// the webview must not clear the typed message or attachments.
		await expect(
			coordinator.togglePlanActMode("act", {
				message: "go ahead but skip step 3",
				images: ["data:image/png;base64,abc"],
				files: [],
			}),
		).resolves.toBe(false)

		expect(options.emitClineAuthError).toHaveBeenCalledOnce()
		expect(options.sessions.fireAndForgetSend).not.toHaveBeenCalled()
		expect(options.messages.appendAndEmit).not.toHaveBeenCalled()
		// The old plan session is still active, so the mode setting rolls back.
		expect(state.mode).toBe("plan")
	})

	it("rolls back the mode when the rebuild fails before the session is replaced", async () => {
		const activeSession = makeActiveSession()
		const task = makeTask("old-session", planMessages())
		const { coordinator, options, state } = makeCoordinator({
			activeSession,
			task,
			mode: "plan",
			turnPhase: "awaiting_followup",
		})
		options.loadInitialMessages.mockRejectedValueOnce(new Error("disk read failed"))

		await expect(
			coordinator.togglePlanActMode("act", {
				message: "go ahead",
				images: [],
				files: [],
			}),
		).resolves.toBe(false)

		expect(state.mode).toBe("plan")
		expect(options.sessions.fireAndForgetSend).not.toHaveBeenCalled()
		expect(options.onAutoContinueFailed).not.toHaveBeenCalled()
		expect(options.messages.appendAndEmit).toHaveBeenCalledWith(
			[expect.objectContaining({ say: "error" })],
			expect.anything(),
		)
	})

	it("emits an auth error and skips replacement when the target cline provider has no token", async () => {
		const activeSession = makeActiveSession()
		const { coordinator, options, state } = makeCoordinator({
			activeSession,
			config: {
				providerId: "cline",
				modelId: "cline-model",
				apiKey: undefined,
			},
		})

		await coordinator.rebuildSessionForMode("act")

		expect(options.emitClineAuthError).toHaveBeenCalledOnce()
		expect(options.sessions.replaceActiveSession).not.toHaveBeenCalled()
		expect(options.postStateToWebview).toHaveBeenCalledTimes(2)
		expect(state.mode).toBe("plan")
	})

	it("cancels and finalizes a running turn before rebuilding for mode change", async () => {
		const activeSession = makeActiveSession({ isRunning: true })
		const task = makeTask("old-session", [{ ts: 1, type: "say", say: "text", text: "partial", partial: true }])
		const { coordinator, options } = makeCoordinator({ activeSession, task })

		await coordinator.rebuildSessionForMode("act")

		expect(options.interactions.clearPending).toHaveBeenCalledWith("Mode changed")
		expect(options.messages.cancelPendingSave).toHaveBeenCalledOnce()
		expect(activeSession.sdkHost.abort).toHaveBeenCalledWith("old-session")
		expect(options.sessions.setRunning).toHaveBeenCalledWith(false)
		expect(options.messages.finalizeMessagesForSave).toHaveBeenCalledWith(task.messageStateHandler.getClineMessages())
		expect(options.messages.appendMessages).toHaveBeenCalledWith([{ ts: 1, type: "say", say: "text", text: "done" }])
		// The finalized messages ride on the state post, so a post must land
		// after the append or the webview keeps showing the aborted partial.
		const appendOrder = (options.messages.appendMessages as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
		const postOrders = (options.postStateToWebview as ReturnType<typeof vi.fn>).mock.invocationCallOrder
		expect(Math.max(...postOrders)).toBeGreaterThan(appendOrder)
	})

	it("settles the aborted turn as resumable so the footer never keeps a stale streaming/approval state", async () => {
		const activeSession = makeActiveSession({ isRunning: true })
		const task = makeTask("old-session", [{ ts: 1, type: "say", say: "text", text: "partial", partial: true }])
		const { coordinator, options } = makeCoordinator({ activeSession, task, turnPhase: "awaiting_approval" })

		await coordinator.rebuildSessionForMode("act")

		// Mirror cancelTask: a resume ask row anchors the Resume Task button.
		const resumeAppend = (options.messages.appendAndEmit as ReturnType<typeof vi.fn>).mock.calls.find(
			([messages]) => messages[0]?.ask === "resume_task",
		)
		expect(resumeAppend).toBeDefined()
		expect(resumeAppend?.[1]).toEqual({
			type: "status",
			payload: { sessionId: "old-session", status: "cancelled" },
		})
		expect(options.setTurnPhase).toHaveBeenCalledWith("resumable", resumeAppend?.[0][0].ts)
		// The aborted turn never auto-continues (the plan was not presented), so
		// nothing may flip the phase back to streaming afterwards.
		expect(options.onAutoContinueStarting).not.toHaveBeenCalled()
		expect(options.sessions.fireAndForgetSend).not.toHaveBeenCalled()
	})

	it("does not touch the turn phase when rebuilding an idle session", async () => {
		const activeSession = makeActiveSession({ isRunning: false })
		const task = makeTask("old-session")
		const { coordinator, options } = makeCoordinator({ activeSession, task })

		await coordinator.rebuildSessionForMode("act")

		expect(options.setTurnPhase).not.toHaveBeenCalled()
		expect(options.messages.appendAndEmit).not.toHaveBeenCalledWith(
			[expect.objectContaining({ ask: "resume_task" })],
			expect.anything(),
		)
	})

	describe("mode switch notices", () => {
		it("records a notice for a manual toggle and consumes it exactly once", async () => {
			const activeSession = makeActiveSession()
			const task = makeTask("old-session")
			const { coordinator } = makeCoordinator({ activeSession, task, mode: "act" })

			await coordinator.togglePlanActMode("plan")

			expect(coordinator.consumeModeSwitchNotice("new-session")).toEqual({ from: "act", to: "plan" })
			expect(coordinator.consumeModeSwitchNotice("new-session")).toBeNull()
		})

		it("makes the notice available before the auto-continue send fires", async () => {
			const activeSession = makeActiveSession()
			const task = makeTask("old-session", planMessages())
			const { coordinator, options } = makeCoordinator({
				activeSession,
				task,
				mode: "plan",
				turnPhase: "awaiting_followup",
			})
			// Mirror the real wiring: SdkSessionLifecycle.fireAndForgetSend
			// consumes the notice at send time, so the continuation message of a
			// user-initiated toggle carries it.
			const consumedAtSend: unknown[] = []
			;(options.sessions.fireAndForgetSend as ReturnType<typeof vi.fn>).mockImplementation(
				(_host: unknown, sessionId: string) => {
					consumedAtSend.push(coordinator.consumeModeSwitchNotice(sessionId))
				},
			)

			await coordinator.togglePlanActMode("act", { message: "go ahead", images: [], files: [] })

			expect(consumedAtSend).toEqual([{ from: "plan", to: "act" }])
			expect(coordinator.consumeModeSwitchNotice("new-session")).toBeNull()
		})

		it("cancels a round trip that returns to the mode the model last saw", async () => {
			const activeSession = makeActiveSession()
			const task = makeTask("old-session")
			const { coordinator } = makeCoordinator({ activeSession, task, mode: "act" })

			await coordinator.togglePlanActMode("plan")
			await coordinator.togglePlanActMode("act")

			expect(coordinator.consumeModeSwitchNotice("new-session")).toBeNull()
		})

		it("keeps the notice pending for its session when another session sends first", async () => {
			const activeSession = makeActiveSession()
			const task = makeTask("old-session")
			const { coordinator } = makeCoordinator({ activeSession, task, mode: "act" })

			await coordinator.togglePlanActMode("plan")

			// A send to a different task/session must neither receive nor clear
			// the notice; mode is global, so the recorded session's transcript
			// still deserves it.
			expect(coordinator.consumeModeSwitchNotice("some-other-task")).toBeNull()
			expect(coordinator.consumeModeSwitchNotice("new-session")).toEqual({ from: "act", to: "plan" })
		})

		it("records no notice when the rebuild fails before the session is replaced", async () => {
			const activeSession = makeActiveSession()
			const task = makeTask("old-session")
			const { coordinator, options } = makeCoordinator({ activeSession, task, mode: "act" })
			options.loadInitialMessages.mockRejectedValueOnce(new Error("disk read failed"))

			await coordinator.togglePlanActMode("plan")

			expect(coordinator.consumeModeSwitchNotice("new-session")).toBeNull()
		})

		it("records no notice when toggling without an active session", async () => {
			const { coordinator } = makeCoordinator({ mode: "act" })

			await coordinator.togglePlanActMode("plan")

			expect(coordinator.consumeModeSwitchNotice("new-session")).toBeNull()
		})
	})
})

function makeCoordinator(input: Partial<MakeCoordinatorInput> = {}) {
	const state = { mode: input.mode ?? "plan" }
	const activeSession = input.activeSession
	const config = {
		providerId: "anthropic",
		modelId: "claude",
		apiKey: "key",
		...input.config,
	}
	const options = {
		stateManager: {
			getGlobalSettingsKey: vi.fn((key: string) => state[key as "mode"]),
			setGlobalState: vi.fn(async (key: string, value: string) => {
				state[key as "mode"] = value as "act" | "plan"
			}),
		} as unknown as StateManager,
		sessions: {
			getActiveSession: vi.fn(() => activeSession),
			replaceActiveSession: vi.fn().mockResolvedValue({
				startResult: { sessionId: "new-session" },
				sdkHost: { send: vi.fn() },
			}),
			fireAndForgetSend: vi.fn(),
			setRunning: vi.fn(),
		},
		interactions: {
			clearPending: vi.fn(),
		},
		messages: {
			appendAndEmit: vi.fn(),
			appendMessages: vi.fn(),
			cancelPendingSave: vi.fn(),
			finalizeMessagesForSave: vi.fn(() => [{ ts: 1, type: "say", say: "text", text: "done" }]),
		},
		sessionConfigBuilder: {
			build: vi.fn().mockResolvedValue(config),
		},
		getTask: vi.fn(() => input.task),
		getWorkspaceRoot: vi.fn().mockResolvedValue("/workspace"),
		loadInitialMessages: vi.fn().mockResolvedValue([{ role: "user", content: "hello" }]),
		buildStartSessionInput: vi.fn(() => ({ prompt: "start" })),
		emitClineAuthError: vi.fn(),
		resetMessageTranslator: vi.fn(),
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		getTurnPhase: vi.fn(() => input.turnPhase ?? "idle"),
		setTurnPhase: vi.fn(),
		resolveContextMentions: vi.fn(async (text: string) => text),
		onAutoContinueStarting: vi.fn(),
		onAutoContinueFailed: vi.fn(),
		rebuilds: {
			runExclusive: vi.fn(async (operation: () => Promise<unknown>) => operation()),
		},
	} as unknown as SdkModeCoordinatorOptions & {
		stateManager: StateManager & {
			getGlobalSettingsKey: ReturnType<typeof vi.fn>
			setGlobalState: ReturnType<typeof vi.fn>
		}
		sessions: SdkModeCoordinatorOptions["sessions"] & {
			getActiveSession: ReturnType<typeof vi.fn>
			fireAndForgetSend: ReturnType<typeof vi.fn>
			replaceActiveSession: ReturnType<typeof vi.fn>
			setRunning: ReturnType<typeof vi.fn>
		}
		interactions: SdkModeCoordinatorOptions["interactions"] & {
			clearPending: ReturnType<typeof vi.fn>
		}
		messages: SdkModeCoordinatorOptions["messages"] & {
			appendAndEmit: ReturnType<typeof vi.fn>
			appendMessages: ReturnType<typeof vi.fn>
			cancelPendingSave: ReturnType<typeof vi.fn>
			finalizeMessagesForSave: ReturnType<typeof vi.fn>
		}
		sessionConfigBuilder: SdkModeCoordinatorOptions["sessionConfigBuilder"] & {
			build: ReturnType<typeof vi.fn>
		}
		getTask: ReturnType<typeof vi.fn>
		getWorkspaceRoot: ReturnType<typeof vi.fn>
		loadInitialMessages: ReturnType<typeof vi.fn>
		buildStartSessionInput: ReturnType<typeof vi.fn>
		emitClineAuthError: ReturnType<typeof vi.fn>
		resetMessageTranslator: ReturnType<typeof vi.fn>
		postStateToWebview: ReturnType<typeof vi.fn>
		getTurnPhase: ReturnType<typeof vi.fn>
		setTurnPhase: ReturnType<typeof vi.fn>
		resolveContextMentions: ReturnType<typeof vi.fn>
		onAutoContinueStarting: ReturnType<typeof vi.fn>
		onAutoContinueFailed: ReturnType<typeof vi.fn>
	}

	return {
		coordinator: new SdkModeCoordinator(options),
		options,
		state,
	}
}

interface MakeCoordinatorInput {
	mode: "act" | "plan"
	activeSession: ReturnType<typeof makeActiveSession>
	config: {
		providerId: string
		modelId: string
		apiKey: string | undefined
	}
	task: ReturnType<typeof makeTask>
	turnPhase: string
}

function makeActiveSession(input: { isRunning?: boolean } = {}) {
	return {
		sessionId: "old-session",
		sdkHost: {
			abort: vi.fn().mockResolvedValue(undefined),
			send: vi.fn(),
			stop: vi.fn().mockResolvedValue(undefined),
			dispose: vi.fn().mockResolvedValue(undefined),
		},
		unsubscribe: vi.fn(),
		startResult: { sessionId: "old-session" },
		isRunning: input.isRunning ?? false,
	}
}

function makeTask(taskId: string, messages: Array<Partial<ClineMessage>> = []) {
	return {
		taskId,
		messageStateHandler: {
			getClineMessages: vi.fn(() => messages as ClineMessage[]),
		},
	} as unknown as {
		taskId: string
		messageStateHandler: { getClineMessages: () => ClineMessage[] }
	}
}

function planMessages(): Array<Partial<ClineMessage>> {
	return [{ ts: 1, type: "say", say: "plan_completion_result", text: "Implement the approved change.", partial: false }]
}
