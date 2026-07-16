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

/** Profile-to-shell mapping used by the injected resolveShellForProfile. */
const SHELL_BY_PROFILE: Record<string, string> = {
	default: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
	powershell: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
	cmd: "C:\\Windows\\System32\\cmd.exe",
}

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

	it("does nothing when the terminal profile did not change", () => {
		const activeSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({ activeSession })

		coordinator.handleTerminalProfileChanged("powershell", "powershell")

		expect(options.rebuilds.request).not.toHaveBeenCalled()
	})

	it("treats undefined and 'default' as the same profile", () => {
		const activeSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({ activeSession })

		coordinator.handleTerminalProfileChanged(undefined, "default")

		expect(options.rebuilds.request).not.toHaveBeenCalled()
	})

	it("requests a rebuild when the terminal profile changes", async () => {
		const activeSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({ activeSession })

		coordinator.handleTerminalProfileChanged("default", "cmd")

		expect(options.rebuilds.request).toHaveBeenCalledWith("terminalExecutionMode", expect.any(Function))
	})

	it("records a shell notice for the active session when the profile changes shell", () => {
		const activeSession = makeActiveSession()
		const { coordinator } = makeCoordinator({ activeSession })

		coordinator.handleTerminalProfileChanged("default", "cmd")

		expect(coordinator.consumeShellChangeNotice("some-other-task")).toBeNull()
		expect(coordinator.consumeShellChangeNotice("old-session")).toEqual({
			from: SHELL_BY_PROFILE.default,
			to: SHELL_BY_PROFILE.cmd,
		})
		expect(coordinator.consumeShellChangeNotice("old-session")).toBeNull()
	})

	it("records no shell notice when the new profile resolves to the same shell", () => {
		const activeSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({ activeSession })

		coordinator.handleTerminalProfileChanged("default", "powershell")

		expect(coordinator.consumeShellChangeNotice("old-session")).toBeNull()
		// The tool description still names the (unchanged) shell correctly; the
		// rebuild is cheap and keeps profile bookkeeping in one place.
		expect(options.rebuilds.request).toHaveBeenCalled()
	})

	it("cancels the shell notice when the user switches back before sending", () => {
		const activeSession = makeActiveSession()
		const { coordinator } = makeCoordinator({ activeSession })

		coordinator.handleTerminalProfileChanged("default", "cmd")
		coordinator.handleTerminalProfileChanged("cmd", "default")

		expect(coordinator.consumeShellChangeNotice("old-session")).toBeNull()
	})

	it("records no shell notice without an active session", () => {
		const { coordinator } = makeCoordinator()

		coordinator.handleTerminalProfileChanged("default", "cmd")

		expect(coordinator.consumeShellChangeNotice("old-session")).toBeNull()
	})

	it("records no shell notice for execution mode changes", () => {
		const activeSession = makeActiveSession()
		const { coordinator } = makeCoordinator({ activeSession })

		coordinator.handleTerminalExecutionModeChanged("backgroundExec", "vscodeTerminal")

		expect(coordinator.consumeShellChangeNotice("old-session")).toBeNull()
	})

	it("schedules restart while the active session is running", () => {
		const activeSession = makeActiveSession({ isRunning: true })
		const { coordinator, options } = makeCoordinator({ activeSession })

		coordinator.handleTerminalExecutionModeChanged("backgroundExec", "vscodeTerminal")

		expect(options.sessions.replaceActiveSession).not.toHaveBeenCalled()
		expect(options.rebuilds.request).toHaveBeenCalledWith("terminalExecutionMode", expect.any(Function))
	})

	it("does not replace a newer session that reused the same session ID", async () => {
		const activeSession = makeActiveSession()
		const newerSession = makeActiveSession({ isRunning: true })
		const { coordinator, options } = makeCoordinator({ activeSession })
		let resolveBuild: (() => void) | undefined
		options.sessionConfigBuilder.build.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveBuild = () => resolve({ providerId: "anthropic", modelId: "claude", apiKey: "key" })
				}),
		)

		const restart = coordinator.restartSessionForTerminalExecutionMode()
		await waitFor(() => resolveBuild !== undefined)
		options.sessions.getActiveSession.mockReturnValue(newerSession)
		resolveBuild?.()
		await restart

		expect(options.sessions.replaceActiveSession).not.toHaveBeenCalled()
	})

	it("re-defers when the active session starts running during restart preparation", async () => {
		const activeSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({ activeSession })
		let resolveBuild: (() => void) | undefined
		options.sessionConfigBuilder.build.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveBuild = () => resolve({ providerId: "anthropic", modelId: "claude", apiKey: "key" })
				}),
		)

		const restart = coordinator.restartSessionForTerminalExecutionMode()
		await waitFor(() => resolveBuild !== undefined)
		activeSession.isRunning = true
		resolveBuild?.()
		await restart
		expect(options.sessions.replaceActiveSession).not.toHaveBeenCalled()

		expect(options.rebuilds.request).toHaveBeenCalledWith("terminalExecutionMode", expect.any(Function))
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
			expectedSession: activeSession,
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
	let initialRebuildScheduled = false
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
		resolveShellForProfile: vi.fn((profileId: string) => SHELL_BY_PROFILE[profileId] ?? SHELL_BY_PROFILE.default),
		rebuilds: {
			request: vi.fn((_reason: string, rebuild: () => Promise<void>) => {
				if (!initialRebuildScheduled && !activeSession?.isRunning) {
					initialRebuildScheduled = true
					void rebuild()
				}
			}),
		},
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
