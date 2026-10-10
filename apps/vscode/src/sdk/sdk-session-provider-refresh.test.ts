import { afterEach, describe, expect, it, vi } from "vitest"
import { parseProviderId } from "./model-catalog/provider-id"
import { SdkProviderChangeCoordinator } from "./sdk-provider-change-coordinator"
import { SdkSessionLifecycle } from "./sdk-session-lifecycle"
import { SdkSessionRebuildScheduler } from "./sdk-session-rebuild-scheduler"

const createHost = vi.hoisted(() => vi.fn())
vi.mock("./vscode-session-host", () => ({ VscodeSessionHost: { create: createHost } }))
vi.mock("@/core/storage/StateManager", () => ({
	StateManager: { get: () => ({ getGlobalSettingsKey: () => undefined }) },
}))

const config = { sessionId: "task-1", providerId: "lmstudio", modelId: "local-model", apiKey: "old-key" }
const startInput = { config, interactive: true } as Parameters<SdkSessionLifecycle["startNewSession"]>[0]

function setup(useRealScheduler = false) {
	const host = {
		start: vi.fn().mockResolvedValue({ sessionId: "task-1" }),
		restore: vi.fn(),
		stop: vi.fn().mockResolvedValue(undefined),
		subscribe: vi.fn().mockReturnValue(() => {}),
		updateSuspendedSessionConnection: vi.fn().mockResolvedValue(undefined),
	}
	createHost.mockResolvedValue(host)
	let coordinator: SdkProviderChangeCoordinator
	let scheduler: SdkSessionRebuildScheduler | undefined
	const sessions = new SdkSessionLifecycle({
		mcpHub: {} as never,
		requestToolApproval: vi.fn(),
		askQuestion: vi.fn(),
		onSessionEvent: vi.fn(),
		onSendComplete: vi.fn(),
		onSendError: vi.fn(),
		onDidBecomeIdle: () => scheduler?.sessionBecameIdle(),
		onActiveSessionReplacementStarted: (session) => coordinator.handleActiveSessionReplacementStarted(session),
		onActiveSessionReplacementFinished: (session) => coordinator.handleActiveSessionReplacementFinished(session),
	})
	scheduler = useRealScheduler ? new SdkSessionRebuildScheduler({ sessions }) : undefined
	const request = vi.fn((...args: Parameters<SdkSessionRebuildScheduler["request"]>) => scheduler?.request(...args))
	coordinator = new SdkProviderChangeCoordinator({
		sessions,
		stateManager: {
			getGlobalSettingsKey: () => "act",
			getApiConfiguration: () => ({ actModeApiProvider: "lmstudio" }),
		} as never,
		messages: {} as never,
		sessionConfigBuilder: {
			build: vi.fn().mockResolvedValue({ ...config, apiKey: "new-key", baseUrl: "http://localhost:4321/v1" }),
		} as never,
		getTask: () => undefined,
		getWorkspaceRoot: async () => "/workspace",
		loadInitialMessages: async () => undefined,
		buildStartSessionInput: (config) => ({ ...startInput, config }),
		postStateToWebview: async () => {},
		rebuilds: { request },
	})
	return { sessions, coordinator, host, request, scheduler }
}

describe("provider edits during session installation", () => {
	afterEach(() => {
		vi.useRealTimers()
		vi.clearAllMocks()
	})

	it("refreshes credentials before a queued turn while deferring the full rebuild", async () => {
		vi.useFakeTimers()
		const { sessions, coordinator, host, scheduler } = setup(true)
		await sessions.startNewSession(startInput)
		sessions.setQueuedPromptCount(1)
		sessions.setRunning(false)

		coordinator.handleProviderConfigFieldsChanged(parseProviderId("lmstudio"))
		await vi.advanceTimersByTimeAsync(350)
		expect(host.start).toHaveBeenCalledTimes(1)
		expect(host.stop).not.toHaveBeenCalled()

		await coordinator.applyPendingConnectionUpdateBeforeModelRequest()
		expect(host.updateSuspendedSessionConnection).toHaveBeenCalledExactlyOnceWith(
			"task-1",
			expect.objectContaining({ apiKey: "new-key", baseUrl: "http://localhost:4321/v1" }),
		)
		expect(host.start).toHaveBeenCalledTimes(1)

		sessions.setQueuedPromptCount(0)
		await scheduler!.waitUntilSettled()
		expect(host.start).toHaveBeenCalledTimes(2)
		expect(host.start).toHaveBeenLastCalledWith(
			expect.objectContaining({ config: expect.objectContaining({ apiKey: "new-key" }) }),
		)
	})

	it.each([
		"start",
		"restore",
		"replace",
	] as const)("retains edits during %s and applies them to the installed session", async (operation) => {
		vi.useFakeTimers()
		const { sessions, coordinator, host, request } = setup()
		if (operation !== "start") {
			await sessions.startNewSession(startInput)
			sessions.setRunning(false)
		}
		const pending = Promise.withResolvers<{ sessionId: string; startResult: { sessionId: string } }>()
		const entered = Promise.withResolvers<void>()
		const install = vi.fn(() => {
			entered.resolve()
			return pending.promise
		})
		host.start.mockImplementation(install)
		host.restore.mockImplementation(install)
		const installing =
			operation === "restore"
				? sessions.restoreActiveSession({ sessionId: "task-1", start: startInput } as never)
				: operation === "replace"
					? sessions.replaceActiveSession({
							expectedSession: sessions.getActiveSession()!,
							startInput,
							disposeReason: "test",
						})
					: sessions.startNewSession(startInput)
		await entered.promise

		coordinator.handleProviderConfigFieldsChanged(parseProviderId("lmstudio"))
		await vi.advanceTimersByTimeAsync(350)
		await coordinator.applyPendingConnectionUpdateBeforeModelRequest()
		expect(request).not.toHaveBeenCalled()
		expect(host.updateSuspendedSessionConnection).not.toHaveBeenCalled()

		pending.resolve({ sessionId: "task-2", startResult: { sessionId: "task-2" } })
		await installing
		await coordinator.applyPendingConnectionUpdateBeforeModelRequest()
		expect(host.updateSuspendedSessionConnection).toHaveBeenCalledExactlyOnceWith(
			"task-2",
			expect.objectContaining({ apiKey: "new-key", baseUrl: "http://localhost:4321/v1" }),
		)
		await vi.advanceTimersByTimeAsync(350)
		expect(request).toHaveBeenCalledExactlyOnceWith("provider", expect.any(Function))
	})

	it("defers an already queued field rebuild until checkpoint restore finishes", async () => {
		vi.useFakeTimers()
		const { sessions, coordinator, host, request } = setup()
		await sessions.startNewSession(startInput)
		sessions.setRunning(false)
		coordinator.handleProviderConfigFieldsChanged(parseProviderId("lmstudio"))
		await vi.advanceTimersByTimeAsync(350)
		expect(request).toHaveBeenCalledExactlyOnceWith("provider", expect.any(Function))
		const queuedRebuild = request.mock.calls[0]?.[1]

		const pending = Promise.withResolvers<{ sessionId: string; startResult: { sessionId: string } }>()
		host.restore.mockReturnValue(pending.promise)
		const restoring = sessions.restoreActiveSession({ sessionId: "task-1" } as never)
		await queuedRebuild({ isCurrent: () => true })
		expect(host.start).toHaveBeenCalledTimes(1)
		expect(host.stop).not.toHaveBeenCalled()

		pending.resolve({ sessionId: "task-2", startResult: { sessionId: "task-2" } })
		await restoring
		await coordinator.applyPendingConnectionUpdateBeforeModelRequest()
		expect(host.updateSuspendedSessionConnection).toHaveBeenCalledExactlyOnceWith(
			"task-2",
			expect.objectContaining({ apiKey: "new-key" }),
		)
		await vi.advanceTimersByTimeAsync(350)
		expect(request).toHaveBeenCalledTimes(2)
	})

	it("releases a failed restore and retains the edit for the source session", async () => {
		vi.useFakeTimers()
		const { sessions, coordinator, host, request } = setup()
		await sessions.startNewSession(startInput)
		const pending = Promise.withResolvers<never>()
		host.restore.mockReturnValue(pending.promise)
		const restoring = sessions.restoreActiveSession({ sessionId: "task-1" } as never)
		const rejected = expect(restoring).rejects.toThrow("restore failed")
		coordinator.handleProviderConfigFieldsChanged(parseProviderId("lmstudio"))
		await vi.advanceTimersByTimeAsync(350)
		expect(request).not.toHaveBeenCalled()
		pending.reject(new Error("restore failed"))
		await rejected
		await coordinator.applyPendingConnectionUpdateBeforeModelRequest()
		expect(host.updateSuspendedSessionConnection).toHaveBeenCalledExactlyOnceWith(
			"task-1",
			expect.objectContaining({ apiKey: "new-key" }),
		)
	})
})
