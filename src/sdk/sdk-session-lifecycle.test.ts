import { describe, expect, it, vi } from "vitest"
import { isAbortError, SdkSessionLifecycle } from "./sdk-session-lifecycle"

describe("SdkSessionLifecycle", () => {
	it("starts a session and stores active session state", async () => {
		const unsubscribe = vi.fn()
		const sessionManager = { send: vi.fn() }
		const factory = {
			createAndStartSession: vi.fn().mockResolvedValue({
				startResult: { sessionId: "session-123" },
				sessionManager,
				unsubscribe,
			}),
		}
		const lifecycle = new SdkSessionLifecycle({
			// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
			factory: factory as any,
			onSendComplete: vi.fn(),
			onSendError: vi.fn(),
		})

		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		const result = await lifecycle.startNewSession({} as any)

		expect(result.startResult.sessionId).toBe("session-123")
		expect(lifecycle.getActiveSession()?.sessionId).toBe("session-123")
		expect(lifecycle.getActiveSession()?.isRunning).toBe(true)
	})

	it("marks the active session idle after a non-queued send completes", async () => {
		const onSendComplete = vi.fn()
		const sessionManager = { send: vi.fn().mockResolvedValue(undefined) }
		const lifecycle = new SdkSessionLifecycle({
			// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
			factory: makeFactory(sessionManager) as any,
			onSendComplete,
			onSendError: vi.fn(),
		})
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		await lifecycle.startNewSession({} as any)

		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		lifecycle.fireAndForgetSend(sessionManager as any, "session-123", "hello")
		await vi.waitFor(() => expect(onSendComplete).toHaveBeenCalledWith("session-123"))

		expect(lifecycle.getActiveSession()?.isRunning).toBe(false)
	})

	it("leaves the active session running when a message is queued", async () => {
		const onSendComplete = vi.fn()
		const sessionManager = { send: vi.fn().mockResolvedValue(undefined) }
		const lifecycle = new SdkSessionLifecycle({
			// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
			factory: makeFactory(sessionManager) as any,
			onSendComplete,
			onSendError: vi.fn(),
		})
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		await lifecycle.startNewSession({} as any)

		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		lifecycle.fireAndForgetSend(sessionManager as any, "session-123", "hello", undefined, undefined, "queue")
		await vi.waitFor(() => expect(sessionManager.send).toHaveBeenCalled())

		expect(onSendComplete).not.toHaveBeenCalled()
		expect(lifecycle.getActiveSession()?.isRunning).toBe(true)
	})

	it("marks the active session idle and reports non-abort send errors", async () => {
		const onSendError = vi.fn()
		const error = new Error("boom")
		const sessionManager = { send: vi.fn().mockRejectedValue(error) }
		const lifecycle = new SdkSessionLifecycle({
			// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
			factory: makeFactory(sessionManager) as any,
			onSendComplete: vi.fn(),
			onSendError,
		})
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		await lifecycle.startNewSession({} as any)

		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		lifecycle.fireAndForgetSend(sessionManager as any, "session-123", "hello")
		await vi.waitFor(() => expect(onSendError).toHaveBeenCalledWith(error, "session-123"))

		expect(lifecycle.getActiveSession()?.isRunning).toBe(false)
	})

	it("replaces the active session by tearing down the old host and starting a new idle session", async () => {
		const oldUnsubscribe = vi.fn()
		const oldSessionManager = {
			send: vi.fn(),
			stop: vi.fn().mockResolvedValue(undefined),
			dispose: vi.fn().mockResolvedValue(undefined),
		}
		const newSessionManager = { send: vi.fn() }
		const factory = {
			createAndStartSession: vi
				.fn()
				.mockResolvedValueOnce({
					startResult: { sessionId: "old-session" },
					sessionManager: oldSessionManager,
					unsubscribe: oldUnsubscribe,
				})
				.mockResolvedValueOnce({
					startResult: { sessionId: "new-session" },
					sessionManager: newSessionManager,
					unsubscribe: vi.fn(),
				}),
		}
		const lifecycle = new SdkSessionLifecycle({
			// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
			factory: factory as any,
			onSendComplete: vi.fn(),
			onSendError: vi.fn(),
		})
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
		expect(oldUnsubscribe).toHaveBeenCalled()
		expect(oldSessionManager.stop).toHaveBeenCalledWith("old-session")
		expect(oldSessionManager.dispose).toHaveBeenCalledWith("testReplace")
		expect(factory.createAndStartSession).toHaveBeenLastCalledWith({
			config: {},
			initialMessages: [{ role: "user", content: "hello" }],
		})
		expect(lifecycle.getActiveSession()?.sessionId).toBe("new-session")
		expect(lifecycle.getActiveSession()?.isRunning).toBe(false)
	})

	it("detects abort errors", () => {
		const error = new Error("aborted by user")
		expect(isAbortError(error)).toBe(true)
	})
})

function makeFactory(sessionManager: { send: ReturnType<typeof vi.fn> }) {
	return {
		createAndStartSession: vi.fn().mockResolvedValue({
			startResult: { sessionId: "session-123" },
			sessionManager,
			unsubscribe: vi.fn(),
		}),
	}
}
