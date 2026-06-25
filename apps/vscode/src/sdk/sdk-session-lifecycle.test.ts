import { beforeEach, describe, expect, it, vi } from "vitest"
import { isAbortError, SdkSessionLifecycle } from "./sdk-session-lifecycle"

type StartInput = Parameters<SdkSessionLifecycle["startNewSession"]>[0]
type SendHost = Parameters<SdkSessionLifecycle["fireAndForgetSend"]>[0]

const mockCreateSessionHost = vi.hoisted(() => vi.fn())

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: () => ({
			getGlobalSettingsKey: () => undefined,
		}),
	},
}))

vi.mock("./vscode-session-host", () => ({
	VscodeSessionHost: {
		create: mockCreateSessionHost,
	},
}))

describe("SdkSessionLifecycle", () => {
	beforeEach(() => {
		mockCreateSessionHost.mockReset()
	})

	it("starts a session and stores active session state", async () => {
		const unsubscribe = vi.fn()
		const sdkHost = makeSdkHost({ startResult: { sessionId: "session-123" }, unsubscribe })
		mockCreateSessionHost.mockResolvedValueOnce(sdkHost)
		const lifecycle = makeLifecycle()

		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		const result = await lifecycle.startNewSession({} as any)

		expect(result.startResult.sessionId).toBe("session-123")
		expect(result.sdkHost).toBe(sdkHost)
		expect(sdkHost.subscribe).toHaveBeenCalled()
		expect(lifecycle.getActiveSession()?.sessionId).toBe("session-123")
		expect(lifecycle.getActiveSession()?.isRunning).toBe(true)
	})

	it("reuses the shared session host across sessions", async () => {
		const sdkHost = makeSdkHost({
			start: vi.fn().mockResolvedValueOnce({ sessionId: "session-1" }).mockResolvedValueOnce({ sessionId: "session-2" }),
		})
		mockCreateSessionHost.mockResolvedValueOnce(sdkHost)
		const lifecycle = makeLifecycle()

		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		await lifecycle.startNewSession({} as any)
		await lifecycle.endActiveSession("test")
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		await lifecycle.startNewSession({} as any)

		expect(mockCreateSessionHost).toHaveBeenCalledOnce()
		expect(sdkHost.subscribe).toHaveBeenCalledOnce()
		expect(sdkHost.start).toHaveBeenCalledTimes(2)
		expect(sdkHost.stop).toHaveBeenCalledWith("session-1")
		expect(sdkHost.dispose).not.toHaveBeenCalled()
		expect(lifecycle.getActiveSession()?.sessionId).toBe("session-2")
	})

	it("replaces an existing active session before starting another without resubscribing", async () => {
		const unsubscribe = vi.fn()
		const sdkHost = makeSdkHost({
			start: vi.fn().mockResolvedValueOnce({ sessionId: "session-1" }).mockResolvedValueOnce({ sessionId: "session-2" }),
			unsubscribe,
		})
		mockCreateSessionHost.mockResolvedValueOnce(sdkHost)
		const lifecycle = makeLifecycle()

		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		await lifecycle.startNewSession({} as any)
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		await lifecycle.startNewSession({} as any)

		expect(mockCreateSessionHost).toHaveBeenCalledOnce()
		expect(sdkHost.subscribe).toHaveBeenCalledOnce()
		expect(sdkHost.stop).toHaveBeenCalledWith("session-1")
		expect(unsubscribe).not.toHaveBeenCalled()
		expect(lifecycle.getActiveSession()?.sessionId).toBe("session-2")

		await lifecycle.dispose("testDispose")
		expect(unsubscribe).toHaveBeenCalledOnce()
	})

	it("unsubscribes if session start fails", async () => {
		const unsubscribe = vi.fn()
		const error = new Error("start failed")
		const sdkHost = makeSdkHost({ start: vi.fn().mockRejectedValue(error), unsubscribe })
		mockCreateSessionHost.mockResolvedValueOnce(sdkHost)
		const lifecycle = makeLifecycle()

		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		await expect(lifecycle.startNewSession({} as any)).rejects.toBe(error)

		expect(unsubscribe).not.toHaveBeenCalled()
		expect(lifecycle.getActiveSession()).toBeUndefined()

		await lifecycle.dispose("testDispose")
		expect(unsubscribe).toHaveBeenCalledOnce()
	})

	it("disposes the shared host only when the lifecycle is disposed", async () => {
		const unsubscribe = vi.fn()
		const sdkHost = makeSdkHost({ startResult: { sessionId: "session-123" }, unsubscribe })
		mockCreateSessionHost.mockResolvedValueOnce(sdkHost)
		const lifecycle = makeLifecycle()
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		await lifecycle.startNewSession({} as any)

		await lifecycle.dispose("testDispose")

		expect(unsubscribe).toHaveBeenCalledOnce()
		expect(sdkHost.stop).toHaveBeenCalledWith("session-123")
		expect(sdkHost.dispose).toHaveBeenCalledWith("testDispose")
		expect(lifecycle.getActiveSession()).toBeUndefined()
	})

	it("passes shared telemetry to the VSCode session host", async () => {
		const telemetry = { capture: vi.fn() }
		const sdkHost = makeSdkHost({ startResult: { sessionId: "session-123" } })
		mockCreateSessionHost.mockResolvedValueOnce(sdkHost)
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		const lifecycle = makeLifecycle({ telemetry: telemetry as any })

		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		await lifecycle.startNewSession({} as any)

		expect(mockCreateSessionHost).toHaveBeenCalledWith(expect.objectContaining({ telemetry }))
	})

	it("marks the active session idle after a non-queued send completes", async () => {
		const onSendComplete = vi.fn()
		const sdkHost = makeSdkHost({ send: vi.fn().mockResolvedValue(undefined) })
		mockCreateSessionHost.mockResolvedValueOnce(sdkHost)
		const lifecycle = makeLifecycle({ onSendComplete })
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		await lifecycle.startNewSession({} as any)

		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		lifecycle.fireAndForgetSend(sdkHost as any, "session-123", "hello")
		await vi.waitFor(() => expect(onSendComplete).toHaveBeenCalledWith("session-123"))

		expect(lifecycle.getActiveSession()?.isRunning).toBe(false)
	})

	it("leaves the active session running when a message is queued", async () => {
		const onSendComplete = vi.fn()
		const send = vi.fn().mockResolvedValue(undefined)
		const sdkHost = makeSdkHost({ send })
		mockCreateSessionHost.mockResolvedValueOnce(sdkHost)
		const lifecycle = makeLifecycle({ onSendComplete })
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		await lifecycle.startNewSession({} as any)

		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		lifecycle.fireAndForgetSend(sdkHost as any, "session-123", "hello", undefined, undefined, "queue")
		await vi.waitFor(() => expect(send).toHaveBeenCalled())

		expect(onSendComplete).not.toHaveBeenCalled()
		expect(lifecycle.getActiveSession()?.isRunning).toBe(true)
	})

	it("marks the active session idle and reports non-abort send errors", async () => {
		const onSendError = vi.fn()
		const error = new Error("boom")
		const sdkHost = makeSdkHost({ send: vi.fn().mockRejectedValue(error) })
		mockCreateSessionHost.mockResolvedValueOnce(sdkHost)
		const lifecycle = makeLifecycle({ onSendError })
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		await lifecycle.startNewSession({} as any)

		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		lifecycle.fireAndForgetSend(sdkHost as any, "session-123", "hello")
		await vi.waitFor(() => expect(onSendError).toHaveBeenCalledWith(error, "session-123"))

		expect(lifecycle.getActiveSession()?.isRunning).toBe(false)
	})

	it("skips completion bookkeeping when the session was replaced before the send settled", async () => {
		const onSendComplete = vi.fn()
		let resolveSend: () => void = () => {}
		const send = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					resolveSend = resolve
				}),
		)
		const sdkHost = makeSdkHost({
			start: vi
				.fn()
				.mockResolvedValueOnce({ sessionId: "plan-session" })
				.mockResolvedValueOnce({ sessionId: "plan-session" }),
			send,
		})
		mockCreateSessionHost.mockResolvedValueOnce(sdkHost)
		const lifecycle = makeLifecycle({ onSendComplete })
		await lifecycle.startNewSession({} as StartInput)

		lifecycle.fireAndForgetSend(sdkHost as unknown as SendHost, "plan-session", "make a plan")

		// A mode-change rebuild replaces the session, reusing the SAME sessionId,
		// and starts an auto-continued turn on it.
		await lifecycle.replaceActiveSession({
			startInput: { config: {} } as unknown as StartInput,
			disposeReason: "modeChange",
		})
		lifecycle.setRunning(true)

		// The old send settles only now; its bookkeeping must not touch the successor.
		resolveSend()
		await new Promise((resolve) => setTimeout(resolve, 0))

		expect(onSendComplete).not.toHaveBeenCalled()
		expect(lifecycle.getActiveSession()?.isRunning).toBe(true)
	})

	it("skips error bookkeeping when the session was replaced before the send failed", async () => {
		const onSendError = vi.fn()
		let rejectSend: (error: Error) => void = () => {}
		const send = vi.fn(
			() =>
				new Promise<void>((_resolve, reject) => {
					rejectSend = reject
				}),
		)
		const sdkHost = makeSdkHost({
			start: vi
				.fn()
				.mockResolvedValueOnce({ sessionId: "plan-session" })
				.mockResolvedValueOnce({ sessionId: "plan-session" }),
			send,
		})
		mockCreateSessionHost.mockResolvedValueOnce(sdkHost)
		const lifecycle = makeLifecycle({ onSendError })
		await lifecycle.startNewSession({} as StartInput)

		lifecycle.fireAndForgetSend(sdkHost as unknown as SendHost, "plan-session", "make a plan")

		await lifecycle.replaceActiveSession({
			startInput: { config: {} } as unknown as StartInput,
			disposeReason: "modeChange",
		})
		lifecycle.setRunning(true)

		rejectSend(new Error("boom"))
		await new Promise((resolve) => setTimeout(resolve, 0))

		expect(onSendError).not.toHaveBeenCalled()
		expect(lifecycle.getActiveSession()?.isRunning).toBe(true)
	})

	it("completes the old session stop before starting a same-id replacement", async () => {
		let resolveStop: () => void = () => {}
		const stop = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					resolveStop = resolve
				}),
		)
		const start = vi
			.fn()
			.mockResolvedValueOnce({ sessionId: "plan-session" })
			.mockResolvedValueOnce({ sessionId: "plan-session" })
		const sdkHost = makeSdkHost({ start, stop })
		mockCreateSessionHost.mockResolvedValueOnce(sdkHost)
		const lifecycle = makeLifecycle()
		await lifecycle.startNewSession({} as StartInput)

		const replacePromise = lifecycle.replaceActiveSession({
			startInput: { config: { sessionId: "plan-session" } } as unknown as StartInput,
			disposeReason: "modeChange",
		})
		await new Promise((resolve) => setTimeout(resolve, 0))

		// Core cleanup deletes by sessionId, so the same-id replacement must not
		// start while the old stop is still in flight.
		expect(start).toHaveBeenCalledTimes(1)

		resolveStop()
		const result = await replacePromise

		expect(start).toHaveBeenCalledTimes(2)
		expect(result?.startResult.sessionId).toBe("plan-session")
	})

	it("passes compacted initial messages after a same-id replacement stop completes", async () => {
		let resolveStop: () => void = () => {}
		const stop = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					resolveStop = resolve
				}),
		)
		const start = vi
			.fn()
			.mockResolvedValueOnce({ sessionId: "task-session" })
			.mockResolvedValueOnce({ sessionId: "task-session" })
		const sdkHost = makeSdkHost({ start, stop })
		mockCreateSessionHost.mockResolvedValueOnce(sdkHost)
		const lifecycle = makeLifecycle()
		await lifecycle.startNewSession({ config: { sessionId: "task-session" } } as unknown as StartInput)

		const initialMessages = [{ role: "user", content: "compacted summary" }]
		const replacePromise = lifecycle.replaceActiveSession({
			startInput: {
				config: { sessionId: "task-session" },
				prompt: undefined,
				interactive: true,
			} as unknown as StartInput,
			initialMessages: initialMessages as unknown as StartInput["initialMessages"],
			disposeReason: "compactTask",
		})
		await new Promise((resolve) => setTimeout(resolve, 0))

		expect(start).toHaveBeenCalledTimes(1)

		resolveStop()
		const result = await replacePromise

		expect(result?.startResult.sessionId).toBe("task-session")
		expect(start).toHaveBeenLastCalledWith({
			config: { sessionId: "task-session" },
			prompt: undefined,
			interactive: true,
			initialMessages,
		})
		expect(lifecycle.getActiveSession()?.isRunning).toBe(false)
	})

	it("waits for a fire-and-forget stop before resuming the same sessionId", async () => {
		let resolveStop: () => void = () => {}
		const stop = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					resolveStop = resolve
				}),
		)
		const start = vi.fn().mockResolvedValueOnce({ sessionId: "task-1" }).mockResolvedValueOnce({ sessionId: "task-1" })
		const sdkHost = makeSdkHost({ start, stop })
		mockCreateSessionHost.mockResolvedValueOnce(sdkHost)
		const lifecycle = makeLifecycle()
		await lifecycle.startNewSession({} as StartInput)

		// The follow-up resume path ends the idle session without awaiting the
		// stop, then starts a new session reusing the taskId as the sessionId.
		await lifecycle.endActiveSession("askResponse")
		const resumePromise = lifecycle.startNewSession({ config: { sessionId: "task-1" } } as unknown as StartInput)
		await new Promise((resolve) => setTimeout(resolve, 0))

		expect(start).toHaveBeenCalledTimes(1)

		resolveStop()
		const result = await resumePromise

		expect(start).toHaveBeenCalledTimes(2)
		expect(result.startResult.sessionId).toBe("task-1")
	})

	it("starts a fresh-id session without waiting for an unrelated hung stop", async () => {
		const stop = vi.fn(() => new Promise<void>(() => {}))
		const start = vi.fn().mockResolvedValueOnce({ sessionId: "task-1" }).mockResolvedValueOnce({ sessionId: "task-2" })
		const sdkHost = makeSdkHost({ start, stop })
		mockCreateSessionHost.mockResolvedValueOnce(sdkHost)
		const lifecycle = makeLifecycle()
		await lifecycle.startNewSession({} as StartInput)

		// A brand-new task does not reuse the old sessionId, so it must not be
		// delayed by the old session's stop.
		const result = await lifecycle.startNewSession({ config: {} } as unknown as StartInput)

		expect(result.startResult.sessionId).toBe("task-2")
		expect(stop).toHaveBeenCalledWith("task-1")
	})

	it("replaces the active session by stopping the old session and reusing the shared host", async () => {
		const oldUnsubscribe = vi.fn()
		const sdkHost = makeSdkHost({
			start: vi
				.fn()
				.mockResolvedValueOnce({ sessionId: "old-session" })
				.mockResolvedValueOnce({ sessionId: "new-session" }),
			unsubscribe: oldUnsubscribe,
			stop: vi.fn().mockResolvedValue(undefined),
			dispose: vi.fn().mockResolvedValue(undefined),
		})
		mockCreateSessionHost.mockResolvedValueOnce(sdkHost)
		const lifecycle = makeLifecycle()
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		await lifecycle.startNewSession({} as any)

		const result = await lifecycle.replaceActiveSession({
			// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
			startInput: { config: {} } as any,
			// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
			initialMessages: [{ role: "user", content: "hello" }] as any,
			disposeReason: "testReplace",
		})

		expect(result?.oldSessionId).toBe("old-session")
		expect(result?.startResult.sessionId).toBe("new-session")
		expect(oldUnsubscribe).not.toHaveBeenCalled()
		expect(sdkHost.stop).toHaveBeenCalledWith("old-session")
		expect(sdkHost.dispose).not.toHaveBeenCalled()
		expect(mockCreateSessionHost).toHaveBeenCalledOnce()
		expect(sdkHost.subscribe).toHaveBeenCalledOnce()
		expect(sdkHost.start).toHaveBeenLastCalledWith({
			config: {},
			initialMessages: [{ role: "user", content: "hello" }],
		})
		expect(lifecycle.getActiveSession()?.sessionId).toBe("new-session")
		expect(lifecycle.getActiveSession()?.isRunning).toBe(false)
	})

	it("updates the active session model for the next turn when supported", async () => {
		const updateSessionModel = vi.fn().mockResolvedValue(undefined)
		const sdkHost = makeSdkHost({ startResult: { sessionId: "session-123" }, updateSessionModel })
		mockCreateSessionHost.mockResolvedValueOnce(sdkHost)
		const lifecycle = makeLifecycle()
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		await lifecycle.startNewSession({} as any)

		const didUpdate = await lifecycle.updateActiveSessionModel("deepseek-v4-flash")

		expect(didUpdate).toBe(true)
		expect(updateSessionModel).toHaveBeenCalledWith("session-123", "deepseek-v4-flash")
	})

	it("does not update active session model when no host capability is available", async () => {
		const sdkHost = makeSdkHost({ startResult: { sessionId: "session-123" } })
		mockCreateSessionHost.mockResolvedValueOnce(sdkHost)
		const lifecycle = makeLifecycle()
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		await lifecycle.startNewSession({} as any)

		const didUpdate = await lifecycle.updateActiveSessionModel("deepseek-v4-flash")

		expect(didUpdate).toBe(false)
	})

	it("detects abort errors", () => {
		const error = new Error("aborted by user")
		expect(isAbortError(error)).toBe(true)
	})
})

function makeLifecycle(overrides: Partial<ConstructorParameters<typeof SdkSessionLifecycle>[0]> = {}) {
	return new SdkSessionLifecycle({
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		mcpHub: {} as any,
		requestToolApproval: vi.fn(),
		askQuestion: vi.fn(),
		onSessionEvent: vi.fn(),
		onSendComplete: vi.fn(),
		onSendError: vi.fn(),
		...overrides,
	})
}

function makeSdkHost(overrides: Record<string, unknown> = {}) {
	const startResult = overrides.startResult ?? { sessionId: "session-123" }
	return {
		start: vi.fn().mockResolvedValue(startResult),
		subscribe: vi.fn().mockReturnValue(overrides.unsubscribe ?? vi.fn()),
		send: vi.fn().mockResolvedValue(undefined),
		stop: vi.fn().mockResolvedValue(undefined),
		dispose: vi.fn().mockResolvedValue(undefined),
		...overrides,
	}
}
