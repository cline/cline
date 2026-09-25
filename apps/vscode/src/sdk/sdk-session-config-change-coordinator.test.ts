import { beforeEach, describe, expect, it, vi } from "vitest"
import type { StateManager } from "@/core/storage/StateManager"
import type { ActiveSession } from "./cline-session-factory"
import {
	SdkSessionConfigChangeCoordinator,
	type SdkSessionConfigChangeCoordinatorOptions,
} from "./sdk-session-config-change-coordinator"
import type { SessionRebuildContext } from "./sdk-session-rebuild-scheduler"

vi.mock("@/shared/services/Logger", () => ({
	Logger: { error: vi.fn(), log: vi.fn(), warn: vi.fn() },
}))

describe("SdkSessionConfigChangeCoordinator", () => {
	beforeEach(() => vi.clearAllMocks())

	it("does nothing when a session setting did not change", () => {
		const { coordinator, options } = makeCoordinator({ activeSession: makeActiveSession() })

		coordinator.handleTerminalExecutionModeChanged("vscodeTerminal", "vscodeTerminal")
		coordinator.handleCheckpointsSettingChanged(true, true)

		expect(options.rebuilds.request).not.toHaveBeenCalled()
	})

	it("does nothing without an active session", () => {
		const { coordinator, options } = makeCoordinator()

		coordinator.handleCheckpointsSettingChanged(true, false)

		expect(options.rebuilds.request).not.toHaveBeenCalled()
	})

	it("schedules checkpoint changes behind a running turn", () => {
		const { coordinator, options } = makeCoordinator({ activeSession: makeActiveSession({ isRunning: true }) })

		coordinator.handleCheckpointsSettingChanged(true, false)

		expect(options.sessions.replaceActiveSession).not.toHaveBeenCalled()
		expect(options.rebuilds.request).toHaveBeenCalledWith("checkpoints", expect.any(Function))
	})

	it("does not replace a newer session that reused the same session ID", async () => {
		const activeSession = makeActiveSession()
		const newerSession = makeActiveSession({ isRunning: true })
		const { coordinator, options, runScheduledRebuild } = makeCoordinator({ activeSession })
		let resolveBuild: (() => void) | undefined
		options.sessionConfigBuilder.build.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveBuild = () => resolve({ providerId: "anthropic", modelId: "claude", apiKey: "key" })
				}),
		)

		coordinator.handleCheckpointsSettingChanged(true, false)
		const restart = runScheduledRebuild()
		await waitFor(() => resolveBuild !== undefined)
		options.sessions.getActiveSession.mockReturnValue(newerSession)
		resolveBuild?.()
		await restart

		expect(options.sessions.replaceActiveSession).not.toHaveBeenCalled()
	})

	it("re-defers when the active session starts running during restart preparation", async () => {
		const activeSession = makeActiveSession()
		const { coordinator, options, runScheduledRebuild } = makeCoordinator({ activeSession })
		let resolveBuild: (() => void) | undefined
		options.sessionConfigBuilder.build.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveBuild = () => resolve({ providerId: "anthropic", modelId: "claude", apiKey: "key" })
				}),
		)

		coordinator.handleCheckpointsSettingChanged(false, true)
		const restart = runScheduledRebuild()
		await waitFor(() => resolveBuild !== undefined)
		activeSession.isRunning = true
		resolveBuild?.()
		await restart

		expect(options.sessions.replaceActiveSession).not.toHaveBeenCalled()
		expect(options.rebuilds.request).toHaveBeenCalledTimes(2)
		expect(options.rebuilds.request).toHaveBeenLastCalledWith("checkpoints", expect.any(Function))
	})

	it.each([
		{
			name: "terminal execution mode",
			change: (coordinator: SdkSessionConfigChangeCoordinator) =>
				coordinator.handleTerminalExecutionModeChanged("backgroundExec", "vscodeTerminal"),
			reason: "terminalExecutionMode",
			disposeReason: "terminalExecutionModeChange",
		},
		{
			name: "checkpoint setting",
			change: (coordinator: SdkSessionConfigChangeCoordinator) => coordinator.handleCheckpointsSettingChanged(true, false),
			reason: "checkpoints",
			disposeReason: "checkpointsSettingChange",
		},
	])("rebuilds the active session with preserved messages for $name changes", async ({ change, reason, disposeReason }) => {
		const activeSession = makeActiveSession()
		const { coordinator, options, runScheduledRebuild } = makeCoordinator({
			activeSession,
			mode: "plan",
			terminalMode: "vscodeTerminal",
		})

		change(coordinator)
		expect(options.rebuilds.request).toHaveBeenCalledWith(reason, expect.any(Function))
		await runScheduledRebuild()

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
			disposeReason,
		})
		expect(options.postStateToWebview).toHaveBeenCalledOnce()
	})

	it("replays queued prompts in order on the replacement session", async () => {
		const activeSession = makeActiveSession()
		activeSession.sdkHost.pendingPrompts.mockResolvedValue([
			{ id: "one", prompt: "first", delivery: "queue", attachmentCount: 1, userFiles: ["a.ts"] },
			{ id: "two", prompt: "second", delivery: "steer", attachmentCount: 1, userImages: ["image.png"] },
		])
		const { coordinator, options, runScheduledRebuild } = makeCoordinator({ activeSession })

		coordinator.handleCheckpointsSettingChanged(true, false)
		await runScheduledRebuild()

		const replacementHost = options.sessions.replaceActiveSession.mock.results[0].value
		await expect(replacementHost).resolves.toBeDefined()
		const send = (await replacementHost).sdkHost.send
		expect(options.sessions.fireAndForgetSend).toHaveBeenCalledBefore(send)
		expect(send).toHaveBeenCalledOnce()
		expect(send).toHaveBeenCalledWith({
			sessionId: "new-session",
			prompt: "second",
			userImages: ["image.png"],
			userFiles: undefined,
			delivery: "steer",
		})
		expect(options.sessions.setRunning).toHaveBeenCalledWith(true)
		expect(options.sessions.fireAndForgetSend).toHaveBeenCalledWith(
			(await replacementHost).sdkHost,
			"new-session",
			"first",
			undefined,
			["a.ts"],
		)
	})

	it("holds active-turn follow-ups for the checkpoint replacement session", async () => {
		const activeSession = makeActiveSession({ isRunning: true })
		const { coordinator, options, runScheduledRebuild } = makeCoordinator({ activeSession })

		coordinator.handleCheckpointsSettingChanged(false, true)
		expect(coordinator.deferFollowUpForCheckpointRebuild(activeSession, "after toggle", ["image.png"], ["a.ts"])).toBe(true)
		expect(options.sessions.fireAndForgetSend).not.toHaveBeenCalled()

		activeSession.isRunning = false
		await runScheduledRebuild()

		expect(options.sessions.fireAndForgetSend).toHaveBeenCalledOnce()
		expect(options.sessions.fireAndForgetSend).toHaveBeenCalledWith(
			replacementHost,
			"new-session",
			"after toggle",
			["image.png"],
			["a.ts"],
		)
	})

	it("releases held follow-ups to the old session when the checkpoint rebuild fails", async () => {
		const activeSession = makeActiveSession({ isRunning: true })
		const { coordinator, options, runScheduledRebuild } = makeCoordinator({ activeSession })
		options.sessionConfigBuilder.build.mockRejectedValueOnce(new Error("config failed"))

		coordinator.handleCheckpointsSettingChanged(false, true)
		expect(coordinator.deferFollowUpForCheckpointRebuild(activeSession, "still deliver")).toBe(true)
		activeSession.isRunning = false
		await runScheduledRebuild()

		expect(options.sessions.fireAndForgetSend).toHaveBeenCalledWith(
			activeSession.sdkHost,
			"old-session",
			"still deliver",
			undefined,
			undefined,
		)
		expect(options.messages.appendAndEmit).toHaveBeenCalledWith(
			[expect.objectContaining({ say: "error", text: expect.stringContaining("config failed") })],
			{ type: "status", payload: { sessionId: "old-session", status: "error" } },
		)
	})

	it("discards held follow-ups when the task cancels its checkpoint transition", () => {
		const activeSession = makeActiveSession({ isRunning: true })
		const { coordinator } = makeCoordinator({ activeSession })

		coordinator.handleCheckpointsSettingChanged(false, true)
		expect(coordinator.deferFollowUpForCheckpointRebuild(activeSession, "cancelled")).toBe(true)
		coordinator.cancelPendingCheckpointFollowUps()

		expect(coordinator.deferFollowUpForCheckpointRebuild(activeSession, "too late")).toBe(false)
	})

	it("stops a replacement invalidated while it was starting", async () => {
		const activeSession = makeActiveSession()
		const { coordinator, options, runScheduledRebuild, invalidateRebuild } = makeCoordinator({ activeSession })
		let resolveReplacement: (() => void) | undefined
		options.sessions.replaceActiveSession.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveReplacement = () =>
						resolve({
							startResult: replacementStartResult,
							sdkHost: replacementHost,
						})
				}),
		)

		coordinator.handleCheckpointsSettingChanged(true, false)
		const restart = runScheduledRebuild()
		await waitFor(() => resolveReplacement !== undefined)
		invalidateRebuild()
		options.sessions.getActiveSession.mockReturnValue({
			...makeActiveSession(),
			sdkHost: replacementHost,
			startResult: replacementStartResult,
		})
		resolveReplacement?.()
		await restart

		expect(options.sessions.endActiveSession).toHaveBeenCalledWith("cancelledSessionConfigChange")
		expect(replacementHost.send).not.toHaveBeenCalled()
		expect(coordinator.deferFollowUpForCheckpointRebuild(activeSession, "after cancellation")).toBe(false)
	})
})

const replacementStartResult = { sessionId: "new-session" }
const replacementHost = { send: vi.fn().mockResolvedValue(undefined) }

function makeCoordinator(input: Partial<MakeCoordinatorInput> = {}) {
	const activeSession = input.activeSession
	const scheduled: Array<(context: SessionRebuildContext) => Promise<void>> = []
	let rebuildIsCurrent = true
	const options = {
		stateManager: {
			getGlobalSettingsKey: vi.fn(() => input.mode ?? "act"),
			getGlobalStateKey: vi.fn(() => input.terminalMode ?? "backgroundExec"),
		} as unknown as StateManager,
		sessions: {
			getActiveSession: vi.fn(() => activeSession),
			replaceActiveSession: vi.fn().mockResolvedValue({
				startResult: replacementStartResult,
				sdkHost: replacementHost,
			}),
			endActiveSession: vi.fn().mockResolvedValue(undefined),
			setRunning: vi.fn(),
			fireAndForgetSend: vi.fn(),
		},
		messages: { appendAndEmit: vi.fn(), emitSessionEvents: vi.fn() },
		sessionConfigBuilder: {
			build: vi.fn().mockResolvedValue({ providerId: "anthropic", modelId: "claude", apiKey: "key" }),
		},
		getWorkspaceRoot: vi.fn().mockResolvedValue("/workspace"),
		loadInitialMessages: vi.fn().mockResolvedValue([{ role: "user", content: "hello" }]),
		buildStartSessionInput: vi.fn(() => ({ prompt: "start" })),
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		rebuilds: {
			request: vi.fn((_reason: string, rebuild: (context: SessionRebuildContext) => Promise<void>) =>
				scheduled.push(rebuild),
			),
		},
	} as unknown as TestOptions

	return {
		coordinator: new SdkSessionConfigChangeCoordinator(options),
		options,
		runScheduledRebuild: () => {
			const rebuild = scheduled.shift()
			if (!rebuild) {
				throw new Error("No session rebuild was scheduled")
			}
			return rebuild({ isCurrent: () => rebuildIsCurrent })
		},
		invalidateRebuild: () => {
			rebuildIsCurrent = false
		},
	}
}

type TestOptions = SdkSessionConfigChangeCoordinatorOptions & {
	stateManager: StateManager & {
		getGlobalSettingsKey: ReturnType<typeof vi.fn>
		getGlobalStateKey: ReturnType<typeof vi.fn>
	}
	sessions: SdkSessionConfigChangeCoordinatorOptions["sessions"] & {
		getActiveSession: ReturnType<typeof vi.fn>
		replaceActiveSession: ReturnType<typeof vi.fn>
		endActiveSession: ReturnType<typeof vi.fn>
		setRunning: ReturnType<typeof vi.fn>
		fireAndForgetSend: ReturnType<typeof vi.fn>
	}
	messages: SdkSessionConfigChangeCoordinatorOptions["messages"] & {
		appendAndEmit: ReturnType<typeof vi.fn>
		emitSessionEvents: ReturnType<typeof vi.fn>
	}
	sessionConfigBuilder: SdkSessionConfigChangeCoordinatorOptions["sessionConfigBuilder"] & {
		build: ReturnType<typeof vi.fn>
	}
	getWorkspaceRoot: ReturnType<typeof vi.fn>
	loadInitialMessages: ReturnType<typeof vi.fn>
	buildStartSessionInput: ReturnType<typeof vi.fn>
	postStateToWebview: ReturnType<typeof vi.fn>
	rebuilds: { request: ReturnType<typeof vi.fn> }
}

function makeActiveSession(overrides: Partial<{ isRunning: boolean }> = {}) {
	const session = {
		sessionId: "old-session",
		sdkHost: { readMessages: vi.fn(), pendingPrompts: vi.fn().mockResolvedValue([]) },
		startResult: { sessionId: "old-session" },
		unsubscribe: vi.fn(),
		isRunning: overrides.isRunning ?? false,
	}
	return session as typeof session & ActiveSession
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
