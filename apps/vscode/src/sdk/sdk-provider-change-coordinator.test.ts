import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { StateManager } from "@/core/storage/StateManager"
import { parseProviderId } from "./model-catalog/provider-id"
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
		vi.useRealTimers()
		vi.clearAllMocks()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("does nothing when the active mode provider did not change", () => {
		const activeSession = makeActiveSession({ isRunning: true })
		const { coordinator, options } = makeCoordinator({ activeSession })

		coordinator.handleApiConfigurationChanged(
			{ actModeApiProvider: "anthropic", planModeApiProvider: "openrouter" },
			{ actModeApiProvider: "anthropic", planModeApiProvider: "deepseek" },
		)

		expect(options.sessions.replaceActiveSession).not.toHaveBeenCalled()
	})

	it("does nothing when only the provider spelling changes", () => {
		const activeSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({ activeSession })

		// Stale snapshots can hold the SDK spelling (`openai-compatible`)
		// while new writes use the legacy spelling (`openai`); this is the
		// same provider, not a provider switch.
		coordinator.handleApiConfigurationChanged(
			{ actModeApiProvider: "openai-compatible" as never },
			{ actModeApiProvider: "openai" },
		)

		expect(options.sessions.replaceActiveSession).not.toHaveBeenCalled()
	})

	it("does nothing without an active session", () => {
		const { coordinator, options } = makeCoordinator()

		coordinator.handleApiConfigurationChanged({ actModeApiProvider: "anthropic" }, { actModeApiProvider: "deepseek" })

		expect(options.sessions.replaceActiveSession).not.toHaveBeenCalled()
	})

	it("restarts when active provider fields change while idle", async () => {
		vi.useFakeTimers()
		const activeSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({ activeSession, activeProvider: "lmstudio" })

		coordinator.handleProviderConfigFieldsChanged(parseProviderId("lmstudio"))

		expect(options.rebuilds.request).not.toHaveBeenCalled()
		vi.runOnlyPendingTimers()
		await Promise.resolve()

		expect(options.sessionConfigBuilder.build).toHaveBeenCalledWith({ cwd: "/workspace", mode: "act" })
		expect(options.rebuilds.request).toHaveBeenCalledWith("provider", expect.any(Function))
	})

	it("coalesces repeated active provider field changes", async () => {
		vi.useFakeTimers()
		const activeSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({ activeSession, activeProvider: "lmstudio" })

		coordinator.handleProviderConfigFieldsChanged(parseProviderId("lmstudio"))
		coordinator.handleProviderConfigFieldsChanged(parseProviderId("lmstudio"))
		coordinator.handleProviderConfigFieldsChanged(parseProviderId("lmstudio"))

		expect(options.rebuilds.request).not.toHaveBeenCalled()
		vi.runOnlyPendingTimers()

		expect(options.rebuilds.request).toHaveBeenCalledTimes(1)
	})

	it("flushes a pending field-change restart without letting its timer fire again", () => {
		vi.useFakeTimers()
		const activeSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({ activeSession, activeProvider: "lmstudio" })

		coordinator.handleProviderConfigFieldsChanged(parseProviderId("lmstudio"))
		coordinator.flushPendingProviderFieldsRebuild()

		expect(options.rebuilds.request).toHaveBeenCalledTimes(1)
		vi.runAllTimers()
		expect(options.rebuilds.request).toHaveBeenCalledTimes(1)
	})

	it("drops a debounced field restart when the active session is replaced", () => {
		vi.useFakeTimers()
		const activeSession = makeActiveSession()
		const replacementSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({ activeSession, activeProvider: "lmstudio" })

		coordinator.handleProviderConfigFieldsChanged(parseProviderId("lmstudio"))
		options.sessions.getActiveSession.mockReturnValue(replacementSession)
		vi.runOnlyPendingTimers()

		expect(options.rebuilds.request).not.toHaveBeenCalled()
	})

	it("drops a queued field restart when the active session is replaced", async () => {
		vi.useFakeTimers()
		const activeSession = makeActiveSession({ isRunning: true })
		const replacementSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({ activeSession, activeProvider: "lmstudio" })

		coordinator.handleProviderConfigFieldsChanged(parseProviderId("lmstudio"))
		vi.runOnlyPendingTimers()
		const queuedRebuild = vi.mocked(options.rebuilds.request).mock.calls[0]?.[1]
		expect(queuedRebuild).toBeTypeOf("function")

		options.sessions.getActiveSession.mockReturnValue(replacementSession)
		await queuedRebuild?.()

		expect(options.sessionConfigBuilder.build).not.toHaveBeenCalled()
		expect(options.sessions.replaceActiveSession).not.toHaveBeenCalled()
	})

	it("does nothing when fields change for an inactive provider", () => {
		const activeSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({ activeSession, activeProvider: "lmstudio" })

		coordinator.handleProviderConfigFieldsChanged(parseProviderId("ollama"))

		expect(options.rebuilds.request).not.toHaveBeenCalled()
		expect(options.sessions.replaceActiveSession).not.toHaveBeenCalled()
	})

	it("schedules a field-change restart while the active session is running", async () => {
		vi.useFakeTimers()
		const activeSession = makeActiveSession({ isRunning: true })
		const { coordinator, options } = makeCoordinator({ activeSession, activeProvider: "lmstudio" })

		coordinator.handleProviderConfigFieldsChanged(parseProviderId("lmstudio"))

		expect(options.sessions.replaceActiveSession).not.toHaveBeenCalled()
		expect(options.rebuilds.request).not.toHaveBeenCalled()
		vi.runOnlyPendingTimers()

		expect(options.rebuilds.request).toHaveBeenCalledWith("provider", expect.any(Function))
	})

	it("hot-applies pending connection fields before a suspended interaction resumes", async () => {
		vi.useFakeTimers()
		const activeSession = makeActiveSession({ isRunning: true })
		const { coordinator, options } = makeCoordinator({ activeSession, activeProvider: "lmstudio" })
		options.sessionConfigBuilder.build.mockResolvedValue({
			providerId: "lmstudio",
			modelId: "local-model",
			apiKey: "new-key",
			baseUrl: "http://localhost:1234/v1",
			providerConfig: { providerId: "lmstudio", modelId: "local-model" },
			thinking: false,
		})

		coordinator.handleProviderConfigFieldsChanged(parseProviderId("lmstudio"))
		await coordinator.applyPendingConnectionUpdateBeforeModelRequest()

		expect(activeSession.sdkHost.updateSuspendedSessionConnection).toHaveBeenCalledWith("old-session", {
			apiKey: "new-key",
			baseUrl: "http://localhost:1234/v1",
			headers: {},
			providerConfig: { providerId: "lmstudio", modelId: "local-model" },
			thinking: false,
			reasoningEffort: null,
			thinkingBudgetTokens: null,
		})
		// The full rebuild remains pending for fields that cannot be changed in
		// place, and will run after the resumed turn becomes idle.
		expect(options.rebuilds.request).not.toHaveBeenCalled()
		vi.runOnlyPendingTimers()
		expect(options.rebuilds.request).toHaveBeenCalledWith("provider", expect.any(Function))
	})

	it("uses an explicit provider-default reset when a custom base URL is cleared", async () => {
		const activeSession = makeActiveSession({ isRunning: true })
		const { coordinator, options } = makeCoordinator({ activeSession, activeProvider: "lmstudio" })
		options.sessionConfigBuilder.build.mockResolvedValue({
			providerId: "lmstudio",
			modelId: "local-model",
			apiKey: "new-key",
			baseUrl: undefined,
			providerConfig: { providerId: "lmstudio", modelId: "local-model" },
		})

		coordinator.handleProviderConfigFieldsChanged(parseProviderId("lmstudio"))
		await coordinator.applyPendingConnectionUpdateBeforeModelRequest()

		expect(activeSession.sdkHost.updateSuspendedSessionConnection).toHaveBeenCalledWith(
			"old-session",
			expect.objectContaining({
				baseUrl: null,
				providerConfig: { providerId: "lmstudio", modelId: "local-model" },
			}),
		)
	})

	it("serializes concurrent suspended connection applies", async () => {
		const activeSession = makeActiveSession({ isRunning: true })
		const { coordinator, options } = makeCoordinator({ activeSession, activeProvider: "lmstudio" })
		options.sessionConfigBuilder.build.mockResolvedValue({
			providerId: "lmstudio",
			modelId: "local-model",
			apiKey: "new-key",
		})
		let releaseUpdate: (() => void) | undefined
		activeSession.sdkHost.updateSuspendedSessionConnection.mockReturnValueOnce(
			new Promise<void>((resolve) => {
				releaseUpdate = resolve
			}),
		)

		coordinator.handleProviderConfigFieldsChanged(parseProviderId("lmstudio"))
		const first = coordinator.applyPendingConnectionUpdateBeforeModelRequest()
		const second = coordinator.applyPendingConnectionUpdateBeforeModelRequest()

		await vi.waitFor(() => expect(activeSession.sdkHost.updateSuspendedSessionConnection).toHaveBeenCalledOnce())
		releaseUpdate?.()
		await Promise.all([first, second])

		expect(activeSession.sdkHost.updateSuspendedSessionConnection).toHaveBeenCalledOnce()
	})

	it("applies the latest same-provider edit when it supersedes an in-flight config build", async () => {
		const activeSession = makeActiveSession({ isRunning: true })
		const { coordinator, options } = makeCoordinator({ activeSession, activeProvider: "lmstudio" })
		let resolveFirstBuild: ((config: { providerId: string; modelId: string; apiKey: string }) => void) | undefined
		options.sessionConfigBuilder.build
			.mockReturnValueOnce(
				new Promise((resolve) => {
					resolveFirstBuild = resolve
				}),
			)
			.mockResolvedValueOnce({
				providerId: "lmstudio",
				modelId: "local-model",
				apiKey: "v2-key",
			})

		coordinator.handleProviderConfigFieldsChanged(parseProviderId("lmstudio"))
		const apply = coordinator.applyPendingConnectionUpdateBeforeModelRequest()
		await vi.waitFor(() => expect(options.sessionConfigBuilder.build).toHaveBeenCalledOnce())

		coordinator.handleProviderConfigFieldsChanged(parseProviderId("lmstudio"))
		resolveFirstBuild?.({ providerId: "lmstudio", modelId: "local-model", apiKey: "v1-key" })
		await apply

		expect(options.sessionConfigBuilder.build).toHaveBeenCalledTimes(2)
		expect(activeSession.sdkHost.updateSuspendedSessionConnection).toHaveBeenCalledOnce()
		expect(activeSession.sdkHost.updateSuspendedSessionConnection).toHaveBeenCalledWith(
			"old-session",
			expect.objectContaining({ apiKey: "v2-key" }),
		)
	})

	it("does not hot-apply a provider switch that lands while config is building", async () => {
		const activeSession = makeActiveSession({ isRunning: true })
		const { coordinator, options } = makeCoordinator({ activeSession, activeProvider: "lmstudio" })
		let resolveBuild: ((config: { providerId: string; modelId: string; apiKey: string }) => void) | undefined
		options.sessionConfigBuilder.build.mockReturnValueOnce(
			new Promise((resolve) => {
				resolveBuild = resolve
			}),
		)

		coordinator.handleProviderConfigFieldsChanged(parseProviderId("lmstudio"))
		const apply = coordinator.applyPendingConnectionUpdateBeforeModelRequest()
		await vi.waitFor(() => expect(options.sessionConfigBuilder.build).toHaveBeenCalledOnce())

		options.stateManager.getApiConfiguration.mockReturnValue({ actModeApiProvider: "deepseek" })
		coordinator.handleApiConfigurationChanged({ actModeApiProvider: "lmstudio" }, { actModeApiProvider: "deepseek" })
		resolveBuild?.({ providerId: "lmstudio", modelId: "local-model", apiKey: "stale-key" })
		await apply

		expect(activeSession.sdkHost.updateSuspendedSessionConnection).not.toHaveBeenCalled()
		expect(options.rebuilds.request).toHaveBeenCalledWith("provider", expect.any(Function))
	})

	it("does not hot-apply newly selected provider credentials to the previous provider session", async () => {
		vi.useFakeTimers()
		const activeSession = makeActiveSession({ isRunning: true, provider: "anthropic" })
		const replacementSession = {
			...makeActiveSession({ isRunning: true, provider: "deepseek" }),
			sessionId: "deepseek-session",
			startResult: { sessionId: "deepseek-session" },
		}
		const { coordinator, options } = makeCoordinator({
			activeSession,
			activeProvider: "deepseek",
			activeSessionProvider: "anthropic",
		})
		options.sessionConfigBuilder.build.mockResolvedValue({
			providerId: "deepseek",
			modelId: "deepseek-v4-flash",
			apiKey: "deepseek-key",
		})

		coordinator.handleApiConfigurationChanged({ actModeApiProvider: "anthropic" }, { actModeApiProvider: "deepseek" })
		coordinator.handleProviderConfigFieldsChanged(parseProviderId("deepseek"))
		await coordinator.applyPendingConnectionUpdateBeforeModelRequest()

		expect(options.sessionConfigBuilder.build).not.toHaveBeenCalled()
		expect(activeSession.sdkHost.updateSuspendedSessionConnection).not.toHaveBeenCalled()
		expect(options.rebuilds.request).toHaveBeenCalledWith("provider", expect.any(Function))

		coordinator.handleActiveSessionReplacementStarted(
			activeSession as unknown as Parameters<typeof coordinator.handleActiveSessionReplacementStarted>[0],
		)
		options.sessions.getActiveSession.mockReturnValue(replacementSession)
		coordinator.handleActiveSessionReplacementFinished(
			replacementSession as unknown as Parameters<typeof coordinator.handleActiveSessionReplacementFinished>[0],
		)
		await coordinator.applyPendingConnectionUpdateBeforeModelRequest()

		expect(replacementSession.sdkHost.updateSuspendedSessionConnection).toHaveBeenCalledWith(
			"deepseek-session",
			expect.objectContaining({ apiKey: "deepseek-key" }),
		)
	})

	it("keeps provider switches immediate and cancels a pending field-change restart", async () => {
		vi.useFakeTimers()
		const activeSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({ activeSession, activeProvider: "anthropic" })

		coordinator.handleProviderConfigFieldsChanged(parseProviderId("anthropic"))
		coordinator.handleApiConfigurationChanged({ actModeApiProvider: "anthropic" }, { actModeApiProvider: "deepseek" })

		expect(options.rebuilds.request).toHaveBeenCalledTimes(1)
		vi.runAllTimers()
		expect(options.rebuilds.request).toHaveBeenCalledTimes(1)
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
			expectedSession: activeSession,
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

	it("schedules the restart while the active session is running", () => {
		const activeSession = makeActiveSession({ isRunning: true })
		const { coordinator, options } = makeCoordinator({ activeSession })

		coordinator.handleApiConfigurationChanged({ actModeApiProvider: "anthropic" }, { actModeApiProvider: "deepseek" })

		expect(options.sessions.replaceActiveSession).not.toHaveBeenCalled()
		expect(options.rebuilds.request).toHaveBeenCalledWith("provider", expect.any(Function))
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

	it("does not mark a newer field edit applied when an older restart completes", async () => {
		const activeSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({ activeSession, activeProvider: "lmstudio" })
		options.sessionConfigBuilder.build.mockResolvedValue({
			providerId: "lmstudio",
			modelId: "local-model",
			apiKey: "latest-key",
		})
		let resolveRestart: (() => void) | undefined
		options.sessions.replaceActiveSession.mockReturnValueOnce(
			new Promise((resolve) => {
				resolveRestart = () => {
					resolve({
						startResult: { sessionId: "new-session" },
						sdkHost: { send: vi.fn() },
					})
				}
			}),
		)

		coordinator.handleProviderConfigFieldsChanged(parseProviderId("lmstudio"))
		const restart = coordinator.restartActiveSessionForProviderChange()
		await vi.waitFor(() => expect(options.sessions.replaceActiveSession).toHaveBeenCalledOnce())
		coordinator.handleProviderConfigFieldsChanged(parseProviderId("lmstudio"))
		resolveRestart?.()
		await restart

		await coordinator.applyPendingConnectionUpdateBeforeModelRequest()

		expect(activeSession.sdkHost.updateSuspendedSessionConnection).toHaveBeenCalledWith(
			"old-session",
			expect.objectContaining({ apiKey: "latest-key" }),
		)
	})

	it("carries a provider edit across the active-session replacement gap", async () => {
		vi.useFakeTimers()
		const activeSession = makeActiveSession({ isRunning: true })
		const replacementSession = {
			...makeActiveSession({ isRunning: true, provider: "lmstudio" }),
			sessionId: "new-session",
			// Same-id history resumes can expose the previous provider in the
			// persisted manifest; startConfig above is the live replacement identity.
			startResult: { sessionId: "new-session", manifest: { provider: "anthropic" } },
		}
		const { coordinator, options } = makeCoordinator({ activeSession, activeProvider: "lmstudio" })
		options.sessionConfigBuilder.build
			.mockResolvedValueOnce({
				providerId: "lmstudio",
				modelId: "local-model",
				apiKey: "snapshotted-key",
			})
			.mockResolvedValueOnce({
				providerId: "lmstudio",
				modelId: "local-model",
				apiKey: "latest-key",
			})
		let installedSession: ReturnType<typeof makeActiveSession> | undefined = activeSession
		let replacementStarted: (() => void) | undefined
		const didStartReplacement = new Promise<void>((resolve) => {
			replacementStarted = resolve
		})
		let finishReplacement: (() => void) | undefined
		const mayFinishReplacement = new Promise<void>((resolve) => {
			finishReplacement = resolve
		})
		options.sessions.getActiveSession.mockImplementation(() => installedSession)
		options.sessions.replaceActiveSession.mockImplementationOnce(async () => {
			installedSession = undefined
			replacementStarted?.()
			await mayFinishReplacement
			installedSession = replacementSession
			return {
				startResult: { sessionId: "new-session" },
				sdkHost: replacementSession.sdkHost,
			}
		})
		options.postStateToWebview.mockRejectedValueOnce(new Error("state post failed")).mockResolvedValueOnce(undefined)

		coordinator.handleProviderConfigFieldsChanged(parseProviderId("lmstudio"))
		const restart = coordinator.restartActiveSessionForProviderChange()
		await didStartReplacement

		coordinator.handleProviderConfigFieldsChanged(parseProviderId("lmstudio"))
		finishReplacement?.()
		await restart
		await coordinator.applyPendingConnectionUpdateBeforeModelRequest()

		expect(activeSession.sdkHost.updateSuspendedSessionConnection).not.toHaveBeenCalled()
		expect(replacementSession.sdkHost.updateSuspendedSessionConnection).toHaveBeenCalledWith(
			"new-session",
			expect.objectContaining({ apiKey: "latest-key" }),
		)
		expect(options.messages.appendAndEmit).toHaveBeenCalledWith(
			expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining("state post failed") })]),
			expect.any(Object),
		)
		vi.runOnlyPendingTimers()
		expect(options.rebuilds.request).toHaveBeenCalledWith("provider", expect.any(Function))
	})

	it("carries a provider edit across a replacement gap owned by another coordinator", async () => {
		vi.useFakeTimers()
		const activeSession = makeActiveSession({ isRunning: false, provider: "lmstudio" })
		const replacementSession = {
			...makeActiveSession({ isRunning: false, provider: "lmstudio" }),
			sessionId: "mode-replacement",
			startResult: { sessionId: "mode-replacement" },
		}
		const { coordinator, options } = makeCoordinator({ activeSession, activeProvider: "lmstudio" })
		options.sessionConfigBuilder.build.mockResolvedValueOnce({
			providerId: "lmstudio",
			modelId: "local-model",
			apiKey: "latest-key",
		})
		let installedSession: ReturnType<typeof makeActiveSession> | undefined = activeSession
		options.sessions.getActiveSession.mockImplementation(() => installedSession)

		// The other coordinator already snapshotted its config before this edit,
		// but lifecycle replacement tracking has not started yet.
		coordinator.handleProviderConfigFieldsChanged(parseProviderId("lmstudio"))
		coordinator.handleActiveSessionReplacementStarted(
			activeSession as unknown as Parameters<typeof coordinator.handleActiveSessionReplacementStarted>[0],
		)
		installedSession = undefined
		installedSession = replacementSession
		coordinator.handleActiveSessionReplacementFinished(
			replacementSession as unknown as Parameters<typeof coordinator.handleActiveSessionReplacementFinished>[0],
		)

		await coordinator.applyPendingConnectionUpdateBeforeModelRequest()

		expect(activeSession.sdkHost.updateSuspendedSessionConnection).not.toHaveBeenCalled()
		expect(replacementSession.sdkHost.updateSuspendedSessionConnection).toHaveBeenCalledWith(
			"mode-replacement",
			expect.objectContaining({ apiKey: "latest-key" }),
		)
		vi.runOnlyPendingTimers()
		expect(options.rebuilds.request).toHaveBeenCalledWith("provider", expect.any(Function))
	})

	it("keeps a provider edit pending when the provider-owned replacement is refused", async () => {
		const activeSession = makeActiveSession({ isRunning: true, provider: "lmstudio" })
		const { coordinator, options } = makeCoordinator({ activeSession, activeProvider: "lmstudio" })
		options.sessionConfigBuilder.build.mockResolvedValue({
			providerId: "lmstudio",
			modelId: "local-model",
			apiKey: "latest-key",
		})
		options.sessions.replaceActiveSession.mockResolvedValueOnce(undefined)

		coordinator.handleProviderConfigFieldsChanged(parseProviderId("lmstudio"))
		activeSession.isRunning = false
		await coordinator.restartActiveSessionForProviderChange()
		activeSession.isRunning = true
		await coordinator.applyPendingConnectionUpdateBeforeModelRequest()

		expect(activeSession.sdkHost.updateSuspendedSessionConnection).toHaveBeenCalledWith(
			"old-session",
			expect.objectContaining({ apiKey: "latest-key" }),
		)
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
	if (activeSession) {
		activeSession.startConfig.providerId = input.activeSessionProvider ?? input.activeProvider ?? "anthropic"
	}
	const config = {
		providerId: "deepseek",
		modelId: "deepseek-v4-flash",
		apiKey: "key",
	}
	const options = {
		stateManager: {
			getGlobalSettingsKey: vi.fn(() => input.mode ?? "act"),
			getApiConfiguration: vi.fn(() => ({
				actModeApiProvider: input.activeProvider ?? "anthropic",
				planModeApiProvider: input.activeProvider ?? "anthropic",
			})),
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
		rebuilds: {
			cancel: vi.fn(),
			request: vi.fn((_reason: string, rebuild: () => Promise<void>) => {
				if (!activeSession?.isRunning) {
					void rebuild()
				}
			}),
		},
	} as unknown as SdkProviderChangeCoordinatorOptions & {
		stateManager: StateManager & {
			getGlobalSettingsKey: ReturnType<typeof vi.fn>
			getApiConfiguration: ReturnType<typeof vi.fn>
		}
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
	activeProvider: string
	activeSessionProvider: string
	mode: "act" | "plan"
	task: { taskId: string }
}

function makeActiveSession(input: { isRunning?: boolean; provider?: string } = {}) {
	return {
		sessionId: "old-session",
		startConfig: {
			providerId: input.provider ?? "anthropic",
			modelId: "local-model",
		},
		sdkHost: {
			send: vi.fn(),
			updateSuspendedSessionConnection: vi.fn().mockResolvedValue(undefined),
			stop: vi.fn().mockResolvedValue(undefined),
			dispose: vi.fn().mockResolvedValue(undefined),
		},
		unsubscribe: vi.fn(),
		startResult: { sessionId: "old-session" },
		isRunning: input.isRunning ?? false,
	}
}
