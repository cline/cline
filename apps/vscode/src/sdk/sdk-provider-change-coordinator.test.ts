import { beforeEach, describe, expect, it, vi } from "vitest"
import type { StateManager } from "@/core/storage/StateManager"
import { SdkProviderChangeCoordinator, type SdkProviderChangeCoordinatorOptions } from "./sdk-provider-change-coordinator"

vi.mock("@/shared/services/Logger", () => ({
	Logger: {
		error: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
	},
}))

describe("SdkProviderChangeCoordinator", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("does nothing when the active mode provider did not change", () => {
		const activeSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({ activeSession })

		coordinator.handleApiConfigurationChanged(
			{ actModeApiProvider: "anthropic", planModeApiProvider: "openrouter" },
			{ actModeApiProvider: "anthropic", planModeApiProvider: "deepseek" },
		)

		expect(options.sessions.replaceActiveSession).not.toHaveBeenCalled()
	})

	it("does nothing without an active session", () => {
		const { coordinator, options } = makeCoordinator()

		coordinator.handleApiConfigurationChanged({ actModeApiProvider: "anthropic" }, { actModeApiProvider: "deepseek" })

		expect(options.sessions.replaceActiveSession).not.toHaveBeenCalled()
	})

	it("restarts immediately when the active provider changes while idle", async () => {
		const activeSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({ activeSession })

		coordinator.handleApiConfigurationChanged({ actModeApiProvider: "anthropic" }, { actModeApiProvider: "deepseek" })

		await vi.waitFor(() => expect(options.sessions.replaceActiveSession).toHaveBeenCalledOnce())
		expect(options.sessionConfigBuilder.build).toHaveBeenCalledWith({ cwd: "/workspace", mode: "act" })
		expect(options.loadInitialMessages).toHaveBeenCalledWith(activeSession.sdkHost, "old-session")
		expect(options.buildStartSessionInput).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "old-session" }), {
			cwd: "/workspace",
			mode: "act",
		})
		expect(options.sessions.replaceActiveSession).toHaveBeenCalledWith({
			startInput: { prompt: "start" },
			initialMessages: [{ role: "user", content: "hello" }],
			disposeReason: "providerChange",
		})
		expect(options.postStateToWebview).toHaveBeenCalledOnce()
	})

	it("uses the current plan mode when plan provider changes", async () => {
		const activeSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({ activeSession, mode: "plan" })

		coordinator.handleApiConfigurationChanged(
			{ planModeApiProvider: "anthropic", actModeApiProvider: "deepseek" },
			{ planModeApiProvider: "openrouter", actModeApiProvider: "deepseek" },
		)

		await vi.waitFor(() => expect(options.sessions.replaceActiveSession).toHaveBeenCalledOnce())
		expect(options.sessionConfigBuilder.build).toHaveBeenCalledWith({ cwd: "/workspace", mode: "plan" })
	})

	it("defers the restart while the active session is running", async () => {
		const activeSession = makeActiveSession({ isRunning: true })
		const { coordinator, options } = makeCoordinator({ activeSession })

		coordinator.handleApiConfigurationChanged({ actModeApiProvider: "anthropic" }, { actModeApiProvider: "deepseek" })

		expect(options.sessions.replaceActiveSession).not.toHaveBeenCalled()

		activeSession.isRunning = false
		await coordinator.checkDeferredRestart()

		await vi.waitFor(() => expect(options.sessions.replaceActiveSession).toHaveBeenCalledOnce())
	})

	it("restarts when current provider fields change through an SDK provider alias", async () => {
		const activeSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({
			activeSession,
			apiConfiguration: { actModeApiProvider: "openai" },
		})

		coordinator.handleProviderConfigFieldsChanged("openai-compatible")

		await vi.waitFor(() => expect(options.sessions.replaceActiveSession).toHaveBeenCalledOnce())
		expect(options.sessionConfigBuilder.build).toHaveBeenCalledWith({ cwd: "/workspace", mode: "act" })
	})

	it("can clear a deferred restart before the session becomes idle", async () => {
		const activeSession = makeActiveSession({ isRunning: true })
		const { coordinator, options } = makeCoordinator({ activeSession })

		coordinator.handleApiConfigurationChanged({ actModeApiProvider: "anthropic" }, { actModeApiProvider: "deepseek" })
		coordinator.clearPendingRestart()

		activeSession.isRunning = false
		await coordinator.checkDeferredRestart()

		expect(options.sessions.replaceActiveSession).not.toHaveBeenCalled()
	})

	it("lets pending mode changes replace deferred provider restarts", async () => {
		const activeSession = makeActiveSession({ isRunning: true })
		const { coordinator, options } = makeCoordinator({ activeSession })
		const mode = {
			hasPendingModeChange: vi.fn(() => true),
			applyPendingModeChange: vi.fn().mockResolvedValue(undefined),
		}

		coordinator.handleApiConfigurationChanged({ actModeApiProvider: "anthropic" }, { actModeApiProvider: "deepseek" })
		activeSession.isRunning = false

		await coordinator.handleTurnComplete(mode)
		await coordinator.checkDeferredRestart()

		expect(mode.applyPendingModeChange).toHaveBeenCalledOnce()
		expect(options.sessions.replaceActiveSession).not.toHaveBeenCalled()
	})

	it("checks deferred provider restarts on turn complete when no mode change is pending", async () => {
		const activeSession = makeActiveSession({ isRunning: true })
		const { coordinator, options } = makeCoordinator({ activeSession })
		const mode = {
			hasPendingModeChange: vi.fn(() => false),
			applyPendingModeChange: vi.fn().mockResolvedValue(undefined),
		}

		coordinator.handleApiConfigurationChanged({ actModeApiProvider: "anthropic" }, { actModeApiProvider: "deepseek" })
		activeSession.isRunning = false

		await coordinator.handleTurnComplete(mode)

		expect(mode.applyPendingModeChange).not.toHaveBeenCalled()
		expect(options.sessions.replaceActiveSession).toHaveBeenCalledOnce()
	})

	it("updates the task id when the replacement session id changes", async () => {
		const activeSession = makeActiveSession()
		const task = { taskId: "old-session" }
		const { coordinator, options } = makeCoordinator({ activeSession, task })

		await coordinator.restartActiveSessionForProviderChange()

		expect(task.taskId).toBe("new-session")
		expect(options.postStateToWebview).toHaveBeenCalledOnce()
	})

	it("runs a follow-up restart when another provider change lands during restart", async () => {
		const activeSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({ activeSession })
		let resolveFirstRestart: (() => void) | undefined
		options.sessions.replaceActiveSession.mockReturnValueOnce(
			new Promise((resolve) => {
				resolveFirstRestart = () => {
					resolve({
						startResult: { sessionId: "new-session" },
						sdkHost: { send: vi.fn() },
					})
				}
			}),
		)

		const firstRestart = coordinator.restartActiveSessionForProviderChange()
		await vi.waitFor(() => expect(options.sessions.replaceActiveSession).toHaveBeenCalledOnce())

		const secondRestart = coordinator.restartActiveSessionForProviderChange()
		resolveFirstRestart?.()
		await firstRestart
		await secondRestart

		await vi.waitFor(() => expect(options.sessions.replaceActiveSession).toHaveBeenCalledTimes(2))
	})

	it("emits an error message when restart fails", async () => {
		const activeSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({ activeSession })
		options.sessions.replaceActiveSession.mockRejectedValue(new Error("boom"))

		await coordinator.restartActiveSessionForProviderChange()

		expect(options.messages.appendAndEmit).toHaveBeenCalledWith(
			[
				expect.objectContaining({
					type: "say",
					say: "error",
					text: "Failed to reload provider configuration: boom. The active session may still use the previous provider.",
				}),
			],
			{ type: "status", payload: { sessionId: "old-session", status: "error" } },
		)
		expect(options.postStateToWebview).toHaveBeenCalledOnce()
	})
})

function makeCoordinator(input: Partial<MakeCoordinatorInput> = {}) {
	const activeSession = input.activeSession
	const config = {
		providerId: "deepseek",
		modelId: "deepseek-v4-flash",
		apiKey: "key",
	}
	const options = {
		stateManager: {
			getGlobalSettingsKey: vi.fn(() => input.mode ?? "act"),
			getApiConfiguration: vi.fn(() => input.apiConfiguration ?? { actModeApiProvider: "anthropic" }),
		} as unknown as StateManager,
		sessions: {
			getActiveSession: vi.fn(() => activeSession),
			replaceActiveSession: vi.fn().mockResolvedValue({
				startResult: { sessionId: "new-session" },
				sdkHost: { send: vi.fn() },
			}),
		},
		messages: {
			appendAndEmit: vi.fn(),
		},
		sessionConfigBuilder: {
			build: vi.fn().mockResolvedValue(config),
		},
		getTask: vi.fn(() => input.task),
		getWorkspaceRoot: vi.fn().mockResolvedValue("/workspace"),
		loadInitialMessages: vi.fn().mockResolvedValue([{ role: "user", content: "hello" }]),
		buildStartSessionInput: vi.fn(() => ({ prompt: "start" })),
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
	} as unknown as SdkProviderChangeCoordinatorOptions & {
		stateManager: StateManager & { getGlobalSettingsKey: ReturnType<typeof vi.fn> }
		sessions: SdkProviderChangeCoordinatorOptions["sessions"] & {
			getActiveSession: ReturnType<typeof vi.fn>
			replaceActiveSession: ReturnType<typeof vi.fn>
		}
		messages: SdkProviderChangeCoordinatorOptions["messages"] & { appendAndEmit: ReturnType<typeof vi.fn> }
		sessionConfigBuilder: SdkProviderChangeCoordinatorOptions["sessionConfigBuilder"] & {
			build: ReturnType<typeof vi.fn>
		}
		getTask: ReturnType<typeof vi.fn>
		getWorkspaceRoot: ReturnType<typeof vi.fn>
		loadInitialMessages: ReturnType<typeof vi.fn>
		buildStartSessionInput: ReturnType<typeof vi.fn>
		postStateToWebview: ReturnType<typeof vi.fn>
	}

	return {
		coordinator: new SdkProviderChangeCoordinator(options),
		options,
	}
}

interface MakeCoordinatorInput {
	activeSession: ReturnType<typeof makeActiveSession>
	mode: "act" | "plan"
	task: { taskId: string }
	apiConfiguration: Record<string, unknown>
}

function makeActiveSession(input: { isRunning?: boolean } = {}) {
	return {
		sessionId: "old-session",
		sdkHost: {
			send: vi.fn(),
			stop: vi.fn().mockResolvedValue(undefined),
			dispose: vi.fn().mockResolvedValue(undefined),
		},
		unsubscribe: vi.fn(),
		startResult: { sessionId: "old-session" },
		isRunning: input.isRunning ?? false,
	}
}
