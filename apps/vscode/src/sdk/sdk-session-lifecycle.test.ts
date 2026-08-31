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

	it("stores the provider and model config used to start the active session", async () => {
		const sdkHost = makeSdkHost({ startResult: { sessionId: "session-123" } })
		mockCreateSessionHost.mockResolvedValueOnce(sdkHost)
		const lifecycle = makeLifecycle()

		await lifecycle.startNewSession({
			config: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4",
			},
		} as StartInput)

		expect(lifecycle.getActiveSession()?.startConfig).toEqual({
			providerId: "anthropic",
			modelId: "claude-sonnet-4",
		})
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

	it("passes the policy readiness gate to the shared session host", async () => {
		const beforeStartSession = vi.fn().mockResolvedValue(undefined)
		const sdkHost = makeSdkHost({ startResult: { sessionId: "session-123" } })
		mockCreateSessionHost.mockResolvedValueOnce(sdkHost)
		const lifecycle = makeLifecycle({ beforeStartSession })

		await lifecycle.startNewSession({} as StartInput)

		expect(mockCreateSessionHost).toHaveBeenCalledWith(expect.objectContaining({ beforeStartSession }))
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
		const onTurnSettled = vi.fn()
		const sdkHost = makeSdkHost({ send: vi.fn().mockResolvedValue(undefined) })
		mockCreateSessionHost.mockResolvedValueOnce(sdkHost)
		const lifecycle = makeLifecycle({ onTurnSettled })
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		await lifecycle.startNewSession({} as any)

		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		lifecycle.fireAndForgetSend(sdkHost as any, "session-123", "hello")
		await vi.waitFor(() => expect(onTurnSettled).toHaveBeenCalledWith("session-123", { status: "completed" }))

		expect(lifecycle.getActiveSession()?.isRunning).toBe(false)
	})

	it("notifies idle listeners only on a running-to-idle transition", async () => {
		const onDidBecomeIdle = vi.fn()
		const sdkHost = makeSdkHost()
		mockCreateSessionHost.mockResolvedValueOnce(sdkHost)
		const lifecycle = makeLifecycle({ onDidBecomeIdle })
		await lifecycle.startNewSession({} as StartInput)

		lifecycle.setRunning(false)
		lifecycle.setRunning(false)

		expect(onDidBecomeIdle).toHaveBeenCalledOnce()
	})

	it("calls the send-start hook before sending to the SDK host", async () => {
		const onSendStart = vi.fn()
		const send = vi.fn().mockResolvedValue(undefined)
		const sdkHost = makeSdkHost({ send })
		mockCreateSessionHost.mockResolvedValueOnce(sdkHost)
		const lifecycle = makeLifecycle({ onSendStart })
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		await lifecycle.startNewSession({} as any)

		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		lifecycle.fireAndForgetSend(sdkHost as any, "session-123", "hello")
		await vi.waitFor(() => expect(send).toHaveBeenCalled())

		expect(onSendStart).toHaveBeenCalledWith("session-123")
		expect(onSendStart.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0])
	})

	it("leaves the active session running when a message is queued", async () => {
		const onTurnSettled = vi.fn()
		const send = vi.fn().mockResolvedValue(undefined)
		const sdkHost = makeSdkHost({ send })
		mockCreateSessionHost.mockResolvedValueOnce(sdkHost)
		const lifecycle = makeLifecycle({ onTurnSettled })
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		await lifecycle.startNewSession({} as any)

		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		lifecycle.fireAndForgetSend(sdkHost as any, "session-123", "hello", undefined, undefined, "queue")
		await vi.waitFor(() => expect(send).toHaveBeenCalled())

		expect(onTurnSettled).not.toHaveBeenCalled()
		expect(lifecycle.getActiveSession()?.isRunning).toBe(true)
	})

	it("marks the active session idle and reports non-abort send rejections as failures", async () => {
		const onTurnSettled = vi.fn()
		const error = new Error("boom")
		const sdkHost = makeSdkHost({ send: vi.fn().mockRejectedValue(error) })
		mockCreateSessionHost.mockResolvedValueOnce(sdkHost)
		const lifecycle = makeLifecycle({ onTurnSettled })
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		await lifecycle.startNewSession({} as any)

		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		lifecycle.fireAndForgetSend(sdkHost as any, "session-123", "hello")
		await vi.waitFor(() =>
			expect(onTurnSettled).toHaveBeenCalledWith(
				"session-123",
				expect.objectContaining({ status: "failed", error, source: "send_rejection" }),
			),
		)

		expect(lifecycle.getActiveSession()?.isRunning).toBe(false)
	})

	it("unifies a terminal error event with the resolved send into one failed outcome", async () => {
		const onTurnSettled = vi.fn()
		let resolveSend: () => void = () => {}
		const send = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					resolveSend = resolve
				}),
		)
		const sdkHost = makeSdkHost({ send })
		mockCreateSessionHost.mockResolvedValueOnce(sdkHost)
		const lifecycle = makeLifecycle({ onTurnSettled })
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		await lifecycle.startNewSession({} as any)

		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		lifecycle.fireAndForgetSend(sdkHost as any, "session-123", "hello")

		// The runtime emits run-failed (terminal error event) before the send
		// promise settles; the lifecycle must record it and report ONE failed
		// outcome when the send resolves — not a completion.
		const streamError = Object.assign(new Error("ConnectTimeoutError"), { name: "ConnectTimeoutError" })
		sdkHost.emit(makeTerminalErrorEvent("session-123", streamError))
		resolveSend()

		await vi.waitFor(() =>
			expect(onTurnSettled).toHaveBeenCalledWith(
				"session-123",
				expect.objectContaining({ status: "failed", error: streamError, source: "agent_event" }),
			),
		)
		expect(onTurnSettled).toHaveBeenCalledTimes(1)
		// The session idles BEFORE the outcome is delivered, so the handler
		// can re-drive the session without polling for settlement.
		expect(lifecycle.getActiveSession()?.isRunning).toBe(false)
	})

	it("propagates the SDK's typed errorClass from the terminal error event", async () => {
		const onTurnSettled = vi.fn()
		let resolveSend: () => void = () => {}
		const send = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					resolveSend = resolve
				}),
		)
		const sdkHost = makeSdkHost({ send })
		mockCreateSessionHost.mockResolvedValueOnce(sdkHost)
		const lifecycle = makeLifecycle({ onTurnSettled })
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		await lifecycle.startNewSession({} as any)

		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		lifecycle.fireAndForgetSend(sdkHost as any, "session-123", "hello")
		sdkHost.emit(makeTerminalErrorEvent("session-123", new Error("too long"), { errorClass: "context_window_exceeded" }))
		resolveSend()

		await vi.waitFor(() =>
			expect(onTurnSettled).toHaveBeenCalledWith(
				"session-123",
				expect.objectContaining({ status: "failed", errorClass: "context_window_exceeded", source: "agent_event" }),
			),
		)
	})

	it("ignores recoverable error events and terminal events from other sessions", async () => {
		const onTurnSettled = vi.fn()
		let resolveSend: () => void = () => {}
		const send = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					resolveSend = resolve
				}),
		)
		const sdkHost = makeSdkHost({ send })
		mockCreateSessionHost.mockResolvedValueOnce(sdkHost)
		const lifecycle = makeLifecycle({ onTurnSettled })
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		await lifecycle.startNewSession({} as any)

		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		lifecycle.fireAndForgetSend(sdkHost as any, "session-123", "hello")
		sdkHost.emit(makeTerminalErrorEvent("session-123", new Error("recoverable mistake notice"), { recoverable: true }))
		sdkHost.emit(makeTerminalErrorEvent("other-session", new Error("other session failed")))
		resolveSend()

		await vi.waitFor(() => expect(onTurnSettled).toHaveBeenCalledWith("session-123", { status: "completed" }))
		expect(onTurnSettled).toHaveBeenCalledTimes(1)
	})

	it("skips completion bookkeeping when the session was replaced before the send settled", async () => {
		const onTurnSettled = vi.fn()
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
		const lifecycle = makeLifecycle({ onTurnSettled })
		await lifecycle.startNewSession({} as StartInput)
		const expectedSession = lifecycle.getActiveSession()!

		lifecycle.fireAndForgetSend(sdkHost as unknown as SendHost, "plan-session", "make a plan")
		lifecycle.setRunning(false)

		// A mode-change rebuild replaces the session, reusing the SAME sessionId,
		// and starts an auto-continued turn on it.
		await lifecycle.replaceActiveSession({
			expectedSession,
			startInput: { config: {} } as unknown as StartInput,
			disposeReason: "modeChange",
		})
		lifecycle.setRunning(true)

		// The old send settles only now; its bookkeeping must not touch the successor.
		resolveSend()
		await new Promise((resolve) => setTimeout(resolve, 0))

		expect(onTurnSettled).not.toHaveBeenCalled()
		expect(lifecycle.getActiveSession()?.isRunning).toBe(true)
	})

	it("skips error bookkeeping when the session was replaced before the send failed", async () => {
		const onTurnSettled = vi.fn()
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
		const lifecycle = makeLifecycle({ onTurnSettled })
		await lifecycle.startNewSession({} as StartInput)
		const expectedSession = lifecycle.getActiveSession()!

		lifecycle.fireAndForgetSend(sdkHost as unknown as SendHost, "plan-session", "make a plan")
		lifecycle.setRunning(false)

		await lifecycle.replaceActiveSession({
			expectedSession,
			startInput: { config: {} } as unknown as StartInput,
			disposeReason: "modeChange",
		})
		lifecycle.setRunning(true)

		rejectSend(new Error("boom"))
		await new Promise((resolve) => setTimeout(resolve, 0))

		expect(onTurnSettled).not.toHaveBeenCalled()
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
		lifecycle.setRunning(false)
		const expectedSession = lifecycle.getActiveSession()!

		const replacePromise = lifecycle.replaceActiveSession({
			expectedSession,
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
		lifecycle.setRunning(false)
		const expectedSession = lifecycle.getActiveSession()!

		const initialMessages = [{ role: "user", content: "compacted summary" }]
		const replacePromise = lifecycle.replaceActiveSession({
			expectedSession,
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
		lifecycle.setRunning(false)
		const expectedSession = lifecycle.getActiveSession()!

		const result = await lifecycle.replaceActiveSession({
			expectedSession,
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

	it("does not replace a session that started running", async () => {
		const sdkHost = makeSdkHost()
		mockCreateSessionHost.mockResolvedValueOnce(sdkHost)
		const lifecycle = makeLifecycle()
		await lifecycle.startNewSession({} as StartInput)
		const expectedSession = lifecycle.getActiveSession()!

		const result = await lifecycle.replaceActiveSession({
			expectedSession,
			startInput: {} as StartInput,
			disposeReason: "test",
		})

		expect(result).toBeUndefined()
		expect(sdkHost.stop).not.toHaveBeenCalled()
	})

	it("adopts the restored session and stops the source session", async () => {
		const restored = {
			sessionId: "restored-session",
			startResult: { sessionId: "restored-session" },
			checkpoint: { ref: "abc", createdAt: 1, runCount: 1 },
		}
		const sdkHost = makeSdkHost({
			startResult: { sessionId: "source-session" },
			restore: vi.fn().mockResolvedValue(restored),
		})
		mockCreateSessionHost.mockResolvedValueOnce(sdkHost)
		const lifecycle = makeLifecycle()

		await lifecycle.startNewSession({
			config: {
				sessionId: "source-session",
				providerId: "openai",
				modelId: "gpt-5",
			},
		} as StartInput)
		const result = await lifecycle.restoreActiveSession({
			sessionId: "source-session",
			checkpointRunCount: 1,
		})

		expect(result).toBe(restored)
		expect(lifecycle.getActiveSession()?.sessionId).toBe("restored-session")
		expect(lifecycle.getActiveSession()?.startConfig).toEqual({
			providerId: "openai",
			modelId: "gpt-5",
		})
		expect(sdkHost.stop).toHaveBeenCalledWith("source-session")
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

	it("stamps a pending mode-switch notice onto the outbound prompt", async () => {
		const send = vi.fn().mockResolvedValue(undefined)
		const sdkHost = makeSdkHost({ send })
		mockCreateSessionHost.mockResolvedValueOnce(sdkHost)
		// Real tracker semantics live in @cline/shared and SdkModeCoordinator;
		// here a one-shot stub proves the consume-once wiring: first send is
		// stamped, later sends go out untouched.
		let pending: { from: "act"; to: "plan" } | null = { from: "act", to: "plan" }
		const consumeModeSwitchNotice = vi.fn((sessionId: string) => {
			if (sessionId !== "session-123") {
				return null
			}
			const notice = pending
			pending = null
			return notice
		})
		const lifecycle = makeLifecycle({ consumeModeSwitchNotice })
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		await lifecycle.startNewSession({} as any)

		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		lifecycle.fireAndForgetSend(sdkHost as any, "session-123", "how should we refactor this?")
		await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
		expect(send).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: "session-123",
				prompt: "<mode_notice>The user switched from act mode to plan mode before sending this message.</mode_notice>\nhow should we refactor this?",
			}),
		)

		// The notice was consumed by the first send; the next message is clean.
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		lifecycle.fireAndForgetSend(sdkHost as any, "session-123", "and the tests?")
		await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2))
		expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ prompt: "and the tests?" }))
	})

	it("sends prompts unchanged when no mode-switch notice is pending", async () => {
		const send = vi.fn().mockResolvedValue(undefined)
		const sdkHost = makeSdkHost({ send })
		mockCreateSessionHost.mockResolvedValueOnce(sdkHost)
		const lifecycle = makeLifecycle({ consumeModeSwitchNotice: vi.fn(() => null) })
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		await lifecycle.startNewSession({} as any)

		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		lifecycle.fireAndForgetSend(sdkHost as any, "session-123", "hello")
		await vi.waitFor(() => expect(send).toHaveBeenCalled())

		expect(send).toHaveBeenCalledWith(expect.objectContaining({ prompt: "hello" }))
	})
})

function makeLifecycle(overrides: Partial<ConstructorParameters<typeof SdkSessionLifecycle>[0]> = {}) {
	return new SdkSessionLifecycle({
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		mcpHub: {} as any,
		requestToolApproval: vi.fn(),
		askQuestion: vi.fn(),
		onSessionEvent: vi.fn(),
		onTurnSettled: vi.fn(),
		...overrides,
	})
}

function makeSdkHost(overrides: Record<string, unknown> = {}) {
	const startResult = overrides.startResult ?? { sessionId: "session-123" }
	const listeners = new Set<(event: unknown) => void>()
	return {
		start: vi.fn().mockResolvedValue(startResult),
		subscribe: vi.fn((listener: (event: unknown) => void) => {
			listeners.add(listener)
			const customUnsubscribe = overrides.unsubscribe as (() => void) | undefined
			return () => {
				listeners.delete(listener)
				customUnsubscribe?.()
			}
		}),
		/** Test helper: dispatch a session event to all subscribers synchronously. */
		emit(event: unknown): void {
			for (const listener of listeners) {
				listener(event)
			}
		},
		send: vi.fn().mockResolvedValue(undefined),
		restore: vi.fn().mockResolvedValue({
			sessionId: "session-123",
			startResult,
			checkpoint: { ref: "abc", createdAt: 1, runCount: 1 },
		}),
		stop: vi.fn().mockResolvedValue(undefined),
		dispose: vi.fn().mockResolvedValue(undefined),
		...overrides,
	}
}

/** A terminal agent error event as the runtime emits it (run-failed). */
function makeTerminalErrorEvent(
	sessionId: string,
	error: unknown,
	extra: { recoverable?: boolean; errorClass?: "context_window_exceeded" } = {},
) {
	return {
		type: "agent_event",
		payload: {
			sessionId,
			event: {
				type: "error",
				error,
				recoverable: extra.recoverable ?? false,
				...(extra.errorClass ? { errorClass: extra.errorClass } : {}),
				iteration: 1,
			},
		},
	}
}
