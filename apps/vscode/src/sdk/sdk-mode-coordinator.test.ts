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

	it("applies a queued switch_to_act_mode change and auto-continues the task", async () => {
		const activeSession = makeActiveSession()
		const { coordinator, state, options } = makeCoordinator({ activeSession })

		coordinator.queueSwitchToActMode()
		expect(coordinator.hasPendingModeChange()).toBe(true)

		await coordinator.applyPendingModeChange()

		expect(coordinator.hasPendingModeChange()).toBe(false)
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
		expect(options.postStateToWebview).toHaveBeenCalledOnce()
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
		expect(options.postStateToWebview).toHaveBeenCalledOnce()
	})

	it("auto-continues a plan -> act toggle when the agent is idle after presenting its plan", async () => {
		const activeSession = makeActiveSession()
		const task = makeTask("old-session")
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

	it("submits typed chatContent as the continuation when toggling plan -> act on a presented plan", async () => {
		const activeSession = makeActiveSession()
		const task = makeTask("old-session")
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
		const task = makeTask("old-session")
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
		const task = makeTask("old-session")
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
		const task = makeTask("old-session")
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

	it("preserves typed chatContent when the agent has not presented a plan", async () => {
		const activeSession = makeActiveSession()
		const task = makeTask("old-session")
		const { coordinator, options } = makeCoordinator({
			activeSession,
			task,
			mode: "plan",
			turnPhase: "completed",
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
		const task = makeTask("old-session")
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
		const task = makeTask("old-session")
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
		const task = makeTask("old-session")
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
		expect(options.postStateToWebview).toHaveBeenCalledOnce()
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
		expect(options.messages.finalizeMessagesForSave).toHaveBeenCalledWith(
			task.messageStateHandler.getClineMessages(),
			"mode_changed",
		)
		expect(options.messages.appendMessages).toHaveBeenCalledWith([{ ts: 1, type: "say", say: "text", text: "done" }])
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
			const task = makeTask("old-session")
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

		it("does not record a notice for a switch_to_act_mode-initiated change", async () => {
			// Matches the CLI: the tool result and canned continuation prompt
			// already announce the switch, so no <mode_notice> is stamped.
			const activeSession = makeActiveSession()
			const task = makeTask("old-session")
			const { coordinator } = makeCoordinator({ activeSession, task, mode: "plan" })

			coordinator.queueSwitchToActMode()
			await coordinator.applyPendingModeChange()

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
