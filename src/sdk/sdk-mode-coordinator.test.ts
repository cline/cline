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

	it("applies a queued switch_to_act_mode change", async () => {
		const activeSession = makeActiveSession()
		const { coordinator, state, options } = makeCoordinator({ activeSession })

		coordinator.queueSwitchToActMode()
		expect(coordinator.hasPendingModeChange()).toBe(true)

		await coordinator.applyPendingModeChange()

		expect(coordinator.hasPendingModeChange()).toBe(false)
		expect(state.mode).toBe("act")
		expect(options.sessions.setRunning).toHaveBeenCalledWith(true)
		expect(options.sessions.fireAndForgetSend).toHaveBeenCalledWith(
			expect.objectContaining({ send: expect.any(Function) }),
			"new-session",
			"The user approved switching to act mode. Continue with the approved plan now.",
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

		expect(options.loadInitialMessages).toHaveBeenCalledWith(activeSession.sessionManager, "old-session")
		expect(options.sessionConfigBuilder.build).toHaveBeenCalledWith({ cwd: "/workspace", mode: "plan" })
		expect(options.buildStartSessionInput).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "old-session" }), {
			cwd: "/workspace",
			mode: "plan",
		})
		expect(options.sessions.replaceActiveSession).toHaveBeenCalledWith({
			startInput: { prompt: "start" },
			initialMessages: [{ role: "user", content: "hello" }],
			disposeReason: "modeChange",
		})
		expect(task.taskId).toBe("new-session")
		expect(options.resetMessageTranslator).toHaveBeenCalledOnce()
		expect(options.sessions.fireAndForgetSend).not.toHaveBeenCalled()
		expect(options.postStateToWebview).toHaveBeenCalledOnce()
	})

	it("emits an auth error and skips replacement when the target cline provider has no token", async () => {
		const activeSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({
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
	})

	it("cancels and finalizes a running turn before rebuilding for mode change", async () => {
		const activeSession = makeActiveSession({ isRunning: true })
		const task = makeTask("old-session", [{ ts: 1, type: "say", say: "text", text: "partial", partial: true }])
		const { coordinator, options } = makeCoordinator({ activeSession, task })

		await coordinator.rebuildSessionForMode("act")

		expect(options.interactions.clearPending).toHaveBeenCalledWith("Mode changed")
		expect(options.messages.cancelPendingSave).toHaveBeenCalledOnce()
		expect(activeSession.sessionManager.abort).toHaveBeenCalledWith("old-session")
		expect(options.sessions.setRunning).toHaveBeenCalledWith(false)
		expect(options.messages.finalizeMessagesForSave).toHaveBeenCalledWith(task.messageStateHandler.getClineMessages())
		expect(options.messages.appendMessages).toHaveBeenCalledWith([{ ts: 1, type: "say", say: "text", text: "done" }], {
			save: false,
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
				sessionManager: { send: vi.fn() },
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
		interactions: SdkModeCoordinatorOptions["interactions"] & { clearPending: ReturnType<typeof vi.fn> }
		messages: SdkModeCoordinatorOptions["messages"] & {
			appendAndEmit: ReturnType<typeof vi.fn>
			appendMessages: ReturnType<typeof vi.fn>
			cancelPendingSave: ReturnType<typeof vi.fn>
			finalizeMessagesForSave: ReturnType<typeof vi.fn>
		}
		sessionConfigBuilder: SdkModeCoordinatorOptions["sessionConfigBuilder"] & { build: ReturnType<typeof vi.fn> }
		getTask: ReturnType<typeof vi.fn>
		getWorkspaceRoot: ReturnType<typeof vi.fn>
		loadInitialMessages: ReturnType<typeof vi.fn>
		buildStartSessionInput: ReturnType<typeof vi.fn>
		emitClineAuthError: ReturnType<typeof vi.fn>
		resetMessageTranslator: ReturnType<typeof vi.fn>
		postStateToWebview: ReturnType<typeof vi.fn>
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
}

function makeActiveSession(input: { isRunning?: boolean } = {}) {
	return {
		sessionId: "old-session",
		sessionManager: {
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
	} as unknown as { taskId: string; messageStateHandler: { getClineMessages: () => ClineMessage[] } }
}
