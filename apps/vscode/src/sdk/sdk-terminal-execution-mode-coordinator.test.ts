import { beforeEach, describe, expect, it, vi } from "vitest"
import type { StateManager } from "@/core/storage/StateManager"
import {
	SdkTerminalExecutionModeCoordinator,
	type SdkTerminalExecutionModeCoordinatorOptions,
} from "./sdk-terminal-execution-mode-coordinator"

vi.mock("@/shared/services/Logger", () => ({
	Logger: {
		error: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
	},
}))

describe("SdkTerminalExecutionModeCoordinator", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("does nothing when terminal mode did not change", () => {
		const activeSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({ activeSession })

		coordinator.handleTerminalExecutionModeChanged("vscodeTerminal", "vscodeTerminal")

		expect(options.sessions.replaceActiveSession).not.toHaveBeenCalled()
	})

	it("does nothing without an active session", () => {
		const { coordinator, options } = makeCoordinator()

		coordinator.handleTerminalExecutionModeChanged("backgroundExec", "vscodeTerminal")

		expect(options.sessions.replaceActiveSession).not.toHaveBeenCalled()
	})

	it("defers restart while the active session is running", async () => {
		const activeSession = makeActiveSession({ isRunning: true })
		const { coordinator, options } = makeCoordinator({ activeSession })

		coordinator.handleTerminalExecutionModeChanged("backgroundExec", "vscodeTerminal")

		expect(options.sessions.replaceActiveSession).not.toHaveBeenCalled()

		activeSession.isRunning = false
		coordinator.checkDeferredRestart()

		await waitFor(() => options.sessions.replaceActiveSession.mock.calls.length === 1)
		expect(options.sessions.replaceActiveSession).toHaveBeenCalledOnce()
	})

	it("re-defers a deferred restart if the session started running again before the check", async () => {
		const activeSession = makeActiveSession({ isRunning: true })
		const { coordinator, options } = makeCoordinator({ activeSession })

		coordinator.handleTerminalExecutionModeChanged("backgroundExec", "vscodeTerminal")
		expect(options.sessions.replaceActiveSession).not.toHaveBeenCalled()

		// A new turn started before the deferred check ran — must not restart
		// mid-turn; must instead re-defer.
		coordinator.checkDeferredRestart()
		expect(options.sessions.replaceActiveSession).not.toHaveBeenCalled()

		// Once the session actually stops running, the re-deferred restart fires.
		activeSession.isRunning = false
		coordinator.checkDeferredRestart()
		await waitFor(() => options.sessions.replaceActiveSession.mock.calls.length === 1)
		expect(options.sessions.replaceActiveSession).toHaveBeenCalledOnce()
	})

	it("serializes concurrent restart calls into a single in-flight restart", async () => {
		const activeSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({ activeSession })

		const [first, second] = [
			coordinator.restartSessionForTerminalExecutionMode(),
			coordinator.restartSessionForTerminalExecutionMode(),
		]
		await Promise.all([first, second])

		// The second call joined the first's in-flight promise rather than
		// starting a second concurrent restart.
		expect(options.sessions.replaceActiveSession).toHaveBeenCalledTimes(1)
	})

	it("rebuilds the active session with preserved messages", async () => {
		const activeSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({ activeSession, mode: "plan", terminalMode: "vscodeTerminal" })

		await coordinator.restartSessionForTerminalExecutionMode()

		expect(options.sessionConfigBuilder.build).toHaveBeenCalledWith({ cwd: "/workspace", mode: "plan" })
		expect(options.loadInitialMessages).toHaveBeenCalledWith(activeSession.sdkHost, "old-session")
		expect(options.buildStartSessionInput).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "old-session" }), {
			cwd: "/workspace",
			mode: "plan",
		})
		expect(options.sessions.replaceActiveSession).toHaveBeenCalledWith({
			startInput: { prompt: "start" },
			initialMessages: [{ role: "user", content: "hello" }],
			disposeReason: "terminalExecutionModeChange",
		})
		expect(options.messages.emitSessionEvents).toHaveBeenCalledWith([], {
			type: "status",
			payload: { sessionId: "new-session", status: "idle" },
		})
		expect(options.postStateToWebview).toHaveBeenCalledOnce()
	})
})

function makeCoordinator(input: Partial<MakeCoordinatorInput> = {}) {
	const activeSession = input.activeSession
	const config = {
		providerId: "anthropic",
		modelId: "claude",
		apiKey: "key",
	}
	const options = {
		stateManager: {
			getGlobalSettingsKey: vi.fn(() => input.mode ?? "act"),
			getGlobalStateKey: vi.fn(() => input.terminalMode ?? "backgroundExec"),
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
			emitSessionEvents: vi.fn(),
		},
		sessionConfigBuilder: {
			build: vi.fn().mockResolvedValue(config),
		},
		getWorkspaceRoot: vi.fn().mockResolvedValue("/workspace"),
		loadInitialMessages: vi.fn().mockResolvedValue([{ role: "user", content: "hello" }]),
		buildStartSessionInput: vi.fn(() => ({ prompt: "start" })),
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
	} as unknown as SdkTerminalExecutionModeCoordinatorOptions & {
		stateManager: StateManager & {
			getGlobalSettingsKey: ReturnType<typeof vi.fn>
			getGlobalStateKey: ReturnType<typeof vi.fn>
		}
		sessions: SdkTerminalExecutionModeCoordinatorOptions["sessions"] & {
			getActiveSession: ReturnType<typeof vi.fn>
			replaceActiveSession: ReturnType<typeof vi.fn>
		}
		messages: SdkTerminalExecutionModeCoordinatorOptions["messages"] & {
			appendAndEmit: ReturnType<typeof vi.fn>
			emitSessionEvents: ReturnType<typeof vi.fn>
		}
		sessionConfigBuilder: SdkTerminalExecutionModeCoordinatorOptions["sessionConfigBuilder"] & {
			build: ReturnType<typeof vi.fn>
		}
		getWorkspaceRoot: ReturnType<typeof vi.fn>
		loadInitialMessages: ReturnType<typeof vi.fn>
		buildStartSessionInput: ReturnType<typeof vi.fn>
		postStateToWebview: ReturnType<typeof vi.fn>
	}

	return {
		coordinator: new SdkTerminalExecutionModeCoordinator(options),
		options,
	}
}

function makeActiveSession(overrides: Partial<{ isRunning: boolean }> = {}) {
	return {
		sessionId: "old-session",
		sdkHost: { readMessages: vi.fn() },
		isRunning: overrides.isRunning ?? false,
	} as {
		sessionId: string
		sdkHost: { readMessages: ReturnType<typeof vi.fn> }
		isRunning: boolean
	}
}

interface MakeCoordinatorInput {
	activeSession?: ReturnType<typeof makeActiveSession>
	mode?: "plan" | "act"
	terminalMode?: "vscodeTerminal" | "backgroundExec"
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let i = 0; i < 10; i++) {
		if (predicate()) {
			return
		}
		await new Promise((resolve) => setTimeout(resolve, 0))
	}
	expect(predicate()).toBe(true)
}
