import { beforeEach, describe, expect, it, vi } from "vitest"
import type { StateManager } from "@/core/storage/StateManager"
import { SdkCompactionCoordinator, type SdkCompactionCoordinatorOptions } from "./sdk-compaction-coordinator"

vi.mock("@/shared/services/Logger", () => ({
	Logger: {
		debug: vi.fn(),
		error: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
	},
}))

describe("SdkCompactionCoordinator", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("reports when there is no active session or displayed task", async () => {
		const { coordinator, options } = makeCoordinator({ activeSession: undefined })

		await coordinator.compactTask()

		expect(options.sessions.startNewSession).not.toHaveBeenCalled()
		expect(options.messages.appendAndEmit).toHaveBeenCalledWith(
			[expect.objectContaining({ say: "info", text: "There is no task to compact." })],
			expect.anything(),
		)
	})

	it("refuses to compact while a turn is running", async () => {
		const activeSession = makeActiveSession({ isRunning: true })
		const { coordinator, options } = makeCoordinator({ activeSession })

		await coordinator.compactTask()
		expect(options.sessions.startNewSession).not.toHaveBeenCalled()
		expect(options.messages.appendAndEmit).toHaveBeenCalledWith(
			[expect.objectContaining({ say: "info", text: expect.stringContaining("Cannot compact while a response") })],
			expect.anything(),
		)
	})

	it("shows a skipped divider when there are no messages", async () => {
		const activeSession = makeActiveSession()
		activeSession.sdkHost.compactSession.mockResolvedValueOnce({ compacted: false, messagesBefore: 0, messagesAfter: 0 })
		const { coordinator, options } = makeCoordinator({ activeSession })

		await coordinator.compactTask()
		expect(compactionRows(options).at(-1)?.info.status).toBe("skipped")
	})

	it("shows a skipped divider when the strategy declines to compact", async () => {
		const activeSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({ activeSession })

		activeSession.sdkHost.compactSession.mockResolvedValueOnce({ compacted: false, messagesBefore: 3, messagesAfter: 3 })
		await coordinator.compactTask()
		const rows = compactionRows(options)
		expect(rows[0].info.status).toBe("started")
		expect(rows[1].info.status).toBe("skipped")
		// The terminal row updates the started row in place (same ts).
		expect(rows[1].ts).toBe(rows[0].ts)
	})

	it("holds active-session compaction inside the rebuild mutex", async () => {
		const activeSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({ activeSession })

		await coordinator.compactTask()

		expect(options.rebuilds.runExclusive).toHaveBeenCalledOnce()
		expect(activeSession.sdkHost.compactSession).toHaveBeenCalled()
	})

	it("does not compact a different session installed while waiting for the mutex", async () => {
		const activeSession = makeActiveSession()
		const replacementSession = makeActiveSession({ sessionId: "different-task" })
		const { coordinator, options } = makeCoordinator({ activeSession })
		// Entry check sees the original session; inside the mutex a different
		// task's session has taken its place.
		options.sessions.getActiveSession.mockReturnValueOnce(activeSession).mockReturnValue(replacementSession)

		await coordinator.compactTask()
		expect(activeSession.sdkHost.readMessages).not.toHaveBeenCalled()
		expect(replacementSession.sdkHost.readMessages).not.toHaveBeenCalled()
	})

	it("compacts through the rebuilt host when an idle rebuild replaced the session object", async () => {
		const activeSession = makeActiveSession()
		// Same conversation (sessionId), new session object and host after a
		// provider/MCP/terminal-mode rebuild drained while we waited.
		const rebuiltSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({ activeSession })
		options.sessions.getActiveSession.mockReturnValueOnce(activeSession).mockReturnValue(rebuiltSession)

		await coordinator.compactTask()

		expect(activeSession.sdkHost.readMessages).not.toHaveBeenCalled()
		expect(rebuiltSession.sdkHost.compactSession).toHaveBeenCalledWith("old-session")
	})

	it("compacts and persists the sidecar without rebuilding the session", async () => {
		const activeSession = makeActiveSession()
		activeSession.sdkHost.readMessages.mockResolvedValueOnce([
			{ role: "user", content: "1" },
			{ role: "assistant", content: "2" },
			{ role: "user", content: "3" },
		])
		const { coordinator, options } = makeCoordinator({ activeSession })

		await coordinator.compactTask()

		expect(activeSession.sdkHost.compactSession).toHaveBeenCalledWith("old-session")
		expect(options.sessions.startNewSession).not.toHaveBeenCalled()
		const rows = compactionRows(options)
		expect(rows[0].info).toMatchObject({ status: "started", mode: "manual" })
		expect(rows[1].info).toMatchObject({ status: "completed", mode: "manual", messagesBefore: 3, messagesAfter: 1 })
		expect(rows[1].ts).toBe(rows[0].ts)
	})
	it("prefers the SDK's token counters from its status notice for the completed divider", async () => {
		const activeSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({ activeSession })

		activeSession.sdkHost.compactSession.mockResolvedValueOnce({
			compacted: true,
			messagesBefore: 42,
			messagesAfter: 42,
			workingContextMessagesAfter: 5,
			notice: {
				kind: "manual_compaction",
				phase: "completed",
				tokensBefore: 25000,
				tokensAfter: 6000,
				messagesBefore: 42,
				messagesAfter: 5,
			},
		})
		await coordinator.compactTask()

		const rows = compactionRows(options)
		expect(rows[1].info).toMatchObject({
			status: "completed",
			mode: "manual",
			tokensBefore: 25_000,
			tokensAfter: 6_000,
			messagesBefore: 42,
			messagesAfter: 5,
		})
	})

	it("does not append compaction status to a different active session", async () => {
		const activeSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({ activeSession })
		// Same session at the entry check and the inside-mutex identity check;
		// replaced during compaction so the emit-time fencing must engage.
		options.sessions.getActiveSession
			.mockReturnValueOnce(activeSession)
			.mockReturnValueOnce(activeSession)
			.mockReturnValue(makeActiveSession({ sessionId: "other-session" }))

		await coordinator.compactTask()

		expect(activeSession.sdkHost.compactSession).toHaveBeenCalled()
		expect(options.messages.appendAndEmit).not.toHaveBeenCalled()
	})

	it("does not report success when sidecar persistence fails", async () => {
		const activeSession = makeActiveSession()
		activeSession.sdkHost.compactSession.mockRejectedValueOnce(new Error("save failed"))
		const { coordinator, options } = makeCoordinator({ activeSession })

		await coordinator.compactTask()

		const rows = compactionRows(options)
		expect(rows[rows.length - 1].info.status).toBe("failed")
		expect(options.messages.appendAndEmit).toHaveBeenCalledWith(
			[expect.objectContaining({ say: "info", text: "Couldn't compact the conversation. Please try again." })],
			expect.anything(),
		)
	})

	it("reports a failure when compaction throws", async () => {
		const activeSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({ activeSession })

		activeSession.sdkHost.compactSession.mockRejectedValueOnce(new Error("summarizer failed"))
		await coordinator.compactTask()

		const rows = compactionRows(options)
		expect(rows[rows.length - 1].info.status).toBe("failed")
		expect(options.messages.appendAndEmit).toHaveBeenCalledWith(
			[expect.objectContaining({ say: "info", text: "Couldn't compact the conversation. Please try again." })],
			expect.anything(),
		)
	})
	it("resumes a displayed history task in an isolated host, compacts it, then disposes it", async () => {
		const { coordinator, options, resumedHost } = makeCoordinator({
			activeSession: undefined,
			displayedTaskId: "history-task",
		})
		resumedHost.readMessages.mockResolvedValueOnce([
			{ role: "user", content: "1" },
			{ role: "assistant", content: "2" },
		])

		await coordinator.compactTask()

		expect(options.rebuilds.runExclusive).toHaveBeenCalledOnce()
		expect(resumedHost.start).toHaveBeenCalledWith(
			expect.objectContaining({ config: expect.objectContaining({ sessionId: "history-task" }), interactive: true }),
		)
		expect(resumedHost.compactSession).toHaveBeenCalledWith("history-task")
		expect(resumedHost.stop).toHaveBeenCalledWith("history-task")
		expect(resumedHost.dispose).toHaveBeenCalledWith("compactDisplayedTask")
		expect(options.sessions.startNewSession).not.toHaveBeenCalled()
		expect(options.sessions.endActiveSession).not.toHaveBeenCalled()
		const rows = compactionRows(options)
		expect(rows[rows.length - 1].info).toMatchObject({ status: "completed", messagesBefore: 3, messagesAfter: 1 })
	})

	it("waits for the task's in-flight stop before starting the isolated session", async () => {
		const { coordinator, options, resumedHost } = makeCoordinator({
			activeSession: undefined,
			displayedTaskId: "history-task",
		})
		let stopSettled = false
		options.sessions.waitForPendingStop.mockImplementationOnce(async () => {
			stopSettled = true
		})
		resumedHost.start.mockImplementationOnce(async (input: { config?: { sessionId?: string } }) => {
			expect(stopSettled).toBe(true)
			return { sessionId: input.config?.sessionId ?? "resumed-session" }
		})

		await coordinator.compactTask()

		expect(options.sessions.waitForPendingStop).toHaveBeenCalledWith("history-task")
		expect(resumedHost.start).toHaveBeenCalledOnce()
	})

	it("disposes the isolated session even when displayed-task compaction fails", async () => {
		const { coordinator, options, resumedHost } = makeCoordinator({
			activeSession: undefined,
			displayedTaskId: "history-task",
		})
		resumedHost.compactSession.mockRejectedValueOnce(new Error("boom"))

		await coordinator.compactTask()

		expect(resumedHost.stop).toHaveBeenCalledWith("history-task")
		expect(resumedHost.dispose).toHaveBeenCalledWith("compactDisplayedTask")
		expect(options.messages.appendAndEmit).toHaveBeenCalledWith(
			[expect.objectContaining({ say: "info", text: "Couldn't compact the conversation. Please try again." })],
			expect.anything(),
		)
	})

	it("compacts the live session when the displayed task became active while waiting for the mutex", async () => {
		const { coordinator, options } = makeCoordinator({
			activeSession: undefined,
			displayedTaskId: "history-task",
		})
		const liveSession = makeActiveSession({ sessionId: "history-task" })
		liveSession.sdkHost.readMessages.mockResolvedValue([{ role: "user", content: "1" }])
		// Idle at the compactTask entry check, then active once inside runExclusive.
		options.sessions.getActiveSession.mockReturnValueOnce(undefined).mockReturnValue(liveSession)

		await coordinator.compactTask()

		expect(options.sessions.startNewSession).not.toHaveBeenCalled()
		expect(liveSession.sdkHost.compactSession).toHaveBeenCalledWith("history-task")
		expect(options.sessions.endActiveSession).not.toHaveBeenCalled()
	})

	it("finishes owned compaction without emitting into a replacement active session", async () => {
		const { coordinator, options, resumedHost } = makeCoordinator({
			activeSession: undefined,
			displayedTaskId: "history-task",
		})
		const replacementSession = makeActiveSession({ sessionId: "replacement-task" })
		resumedHost.start.mockImplementationOnce(async () => {
			options.sessions.getActiveSession.mockReturnValue(replacementSession)
			return { sessionId: "history-task" }
		})

		await coordinator.compactTask()
		expect(resumedHost.compactSession).toHaveBeenCalledWith("history-task")
		expect(options.messages.appendAndEmit).not.toHaveBeenCalled()
		expect(replacementSession.sdkHost.stop).not.toHaveBeenCalled()
		expect(options.sessions.endActiveSession).not.toHaveBeenCalled()
		expect(resumedHost.stop).toHaveBeenCalledWith("history-task")
		expect(resumedHost.dispose).toHaveBeenCalledWith("compactDisplayedTask")
	})
})

/** Collect all say:"compaction" rows emitted through appendAndEmit, in order. */
function compactionRows(options: { messages: { appendAndEmit: ReturnType<typeof vi.fn> } }) {
	return options.messages.appendAndEmit.mock.calls
		.flatMap((call) => call[0] as Array<{ say?: string; text?: string; ts: number }>)
		.filter((message) => message.say === "compaction")
		.map((message) => ({ ts: message.ts, info: JSON.parse(message.text ?? "{}") }))
}

interface MakeCoordinatorInput {
	activeSession: ReturnType<typeof makeActiveSession> | undefined
	displayedTaskId: string | undefined
}

function makeCoordinator(input: Partial<MakeCoordinatorInput> = {}) {
	const activeSession = "activeSession" in input ? input.activeSession : makeActiveSession()
	// The isolated session used to resume a displayed task; its host owns the
	// session and is where the sidecar is persisted and its transcript is read.
	const resumedHost = makeSessionHost()
	const config = {
		providerConfig: { providerId: "anthropic", modelId: "claude" },
		providerId: "anthropic",
		modelId: "claude",
		knownModels: undefined,
		compaction: undefined,
		logger: undefined,
		telemetry: undefined,
		sessionId: undefined as string | undefined,
	}
	const options = {
		stateManager: {
			getGlobalSettingsKey: vi.fn(() => "act"),
		} as unknown as StateManager,
		sessions: {
			getActiveSession: vi.fn(() => activeSession),
			startNewSession: vi.fn(async (startInput: { config?: { sessionId?: string } }) => ({
				startResult: { sessionId: startInput.config?.sessionId ?? "resumed-session" },
				sdkHost: resumedHost,
			})),
			setRunning: vi.fn(),
			endActiveSession: vi.fn().mockResolvedValue(undefined),
			waitForPendingStop: vi.fn().mockResolvedValue(undefined),
		},
		rebuilds: {
			runExclusive: vi.fn(async (operation: () => Promise<unknown>) => operation()),
		},
		messages: {
			appendAndEmit: vi.fn(),
		},
		taskHistory: {
			findHistoryItem: vi.fn().mockResolvedValue(undefined),
			isLegacyTask: vi.fn().mockResolvedValue(false),
			getLegacyResumeInitialMessages: vi.fn(async (_taskId: string, fallback?: unknown[]) => fallback),
		},
		sessionConfigBuilder: {
			build: vi.fn().mockResolvedValue(config),
		},
		getDisplayedTaskId: vi.fn(() => input.displayedTaskId),
		createTempSessionHost: vi.fn().mockResolvedValue(resumedHost),
		loadInitialMessages: vi.fn().mockResolvedValue([{ role: "user", content: "1" }]),
		getWorkspaceRoot: vi.fn().mockResolvedValue("/workspace"),
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
	} as unknown as SdkCompactionCoordinatorOptions & {
		sessions: {
			getActiveSession: ReturnType<typeof vi.fn>
			startNewSession: ReturnType<typeof vi.fn>
			setRunning: ReturnType<typeof vi.fn>
			endActiveSession: ReturnType<typeof vi.fn>
			waitForPendingStop: ReturnType<typeof vi.fn>
		}
		rebuilds: { runExclusive: ReturnType<typeof vi.fn> }
		messages: { appendAndEmit: ReturnType<typeof vi.fn> }
	}

	return {
		coordinator: new SdkCompactionCoordinator(options),
		options,
		resumedHost,
	}
}

function makeSessionHost() {
	return {
		start: vi.fn().mockImplementation(async (input: { config?: { sessionId?: string } }) => ({
			sessionId: input.config?.sessionId ?? "resumed-session",
		})),
		readMessages: vi.fn().mockResolvedValue([{ role: "user", content: "1" }]),
		compactSession: vi.fn().mockResolvedValue({
			compacted: true,
			messagesBefore: 3,
			messagesAfter: 3,
			workingContextMessagesAfter: 1,
			notice: undefined as Record<string, unknown> | undefined,
		}),
		send: vi.fn(),
		abort: vi.fn().mockResolvedValue(undefined),
		stop: vi.fn().mockResolvedValue(undefined),
		dispose: vi.fn().mockResolvedValue(undefined),
	}
}

function makeActiveSession(input: { isRunning?: boolean; sessionId?: string } = {}) {
	return {
		sessionId: input.sessionId ?? "old-session",
		sdkHost: makeSessionHost(),
		unsubscribe: vi.fn(),
		startResult: { sessionId: input.sessionId ?? "old-session" },
		isRunning: input.isRunning ?? false,
	}
}
