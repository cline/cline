import type { ClineMessage } from "@shared/ExtensionMessage"
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

const compactSessionMessages = vi.fn()
vi.mock("./sdk-compaction", () => ({
	compactSessionMessages: (...args: unknown[]) => compactSessionMessages(...args),
}))

describe("SdkCompactionCoordinator", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("emits an info message and does not rebuild when there is no active session", async () => {
		const { coordinator, options } = makeCoordinator({ activeSession: undefined })

		await coordinator.compactTask()

		expect(options.sessions.replaceActiveSession).not.toHaveBeenCalled()
		expect(compactSessionMessages).not.toHaveBeenCalled()
		expect(options.messages.appendAndEmit).toHaveBeenCalledWith(
			[expect.objectContaining({ say: "info", text: "There is no task to compact." })],
			expect.anything(),
		)
	})

	it("compacts a displayed history task by starting an idle session with compacted messages", async () => {
		const task = makeTask("history-task")
		const { coordinator, options, tempHost } = makeCoordinator({ activeSession: undefined, task })
		options.loadInitialMessages.mockResolvedValueOnce([
			{ role: "user", content: "1" },
			{ role: "assistant", content: "2" },
		])
		compactSessionMessages.mockResolvedValueOnce({
			compacted: true,
			messages: [{ role: "user", content: "summary" }],
		})

		await coordinator.compactTask()

		expect(options.createTempSessionHost).toHaveBeenCalledOnce()
		expect(options.loadInitialMessages).toHaveBeenCalledWith(tempHost, "history-task")
		expect(tempHost.dispose).toHaveBeenCalledWith("compactTask.readMessages")
		expect(options.taskHistory.findHistoryItem).toHaveBeenCalledWith("history-task")
		expect(options.buildStartSessionInput).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "history-task" }), {
			cwd: "/workspace",
			mode: "act",
		})
		expect(options.sessions.startNewSession).toHaveBeenCalledWith({
			config: expect.objectContaining({ sessionId: "history-task" }),
			prompt: undefined,
			interactive: true,
			initialMessages: [{ role: "user", content: "summary" }],
			sessionMetadata: expect.objectContaining({ title: "history task" }),
		})
		expect(options.sessions.replaceActiveSession).not.toHaveBeenCalled()
		expect(options.sessions.setRunning).toHaveBeenCalledWith(false)
		expect(options.resetMessageTranslator).toHaveBeenCalledOnce()
		expect(options.setTurnPhase).toHaveBeenCalledWith("awaiting_followup")
		expect(options.sessions.getActiveSession()?.sdkHost.writeMessages).toHaveBeenCalledWith(
			"history-task",
			[{ role: "user", content: "summary" }],
		)
		expect(options.messages.appendAndEmit).toHaveBeenCalledWith(
			[expect.objectContaining({ say: "info", text: "Compacted 2 messages to 1." })],
			expect.anything(),
		)
	})

	it("refuses to compact while a turn is running", async () => {
		const activeSession = makeActiveSession({ isRunning: true })
		const { coordinator, options } = makeCoordinator({ activeSession })

		await coordinator.compactTask()

		expect(compactSessionMessages).not.toHaveBeenCalled()
		expect(options.sessions.replaceActiveSession).not.toHaveBeenCalled()
		expect(options.messages.appendAndEmit).toHaveBeenCalledWith(
			[expect.objectContaining({ say: "info", text: expect.stringContaining("Cannot compact while a response") })],
			expect.anything(),
		)
	})

	it("reports when there are no messages to compact", async () => {
		const activeSession = makeActiveSession()
		activeSession.sdkHost.readMessages.mockResolvedValueOnce([])
		const { coordinator, options } = makeCoordinator({ activeSession })

		await coordinator.compactTask()

		expect(compactSessionMessages).not.toHaveBeenCalled()
		expect(options.sessions.replaceActiveSession).not.toHaveBeenCalled()
		expect(options.messages.appendAndEmit).toHaveBeenCalledWith(
			[expect.objectContaining({ say: "info", text: "No messages to compact." })],
			expect.anything(),
		)
	})

	it("reports when the strategy declines to compact", async () => {
		const activeSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({ activeSession })
		compactSessionMessages.mockResolvedValueOnce({
			compacted: false,
			messages: [{ role: "user", content: "a" }],
		})

		await coordinator.compactTask()

		expect(compactSessionMessages).toHaveBeenCalledOnce()
		expect(options.sessions.replaceActiveSession).not.toHaveBeenCalled()
		expect(options.messages.appendAndEmit).toHaveBeenCalledWith(
			[expect.objectContaining({ say: "info", text: "No compaction needed." })],
			expect.anything(),
		)
	})

	it("compacts and restarts the session, preserving the session id", async () => {
		const activeSession = makeActiveSession()
		activeSession.sdkHost.readMessages.mockResolvedValueOnce([
			{ role: "user", content: "1" },
			{ role: "assistant", content: "2" },
			{ role: "user", content: "3" },
		])
		const task = makeTask("old-session")
		const { coordinator, options } = makeCoordinator({ activeSession, task })
		compactSessionMessages.mockResolvedValueOnce({
			compacted: true,
			messages: [{ role: "user", content: "summary" }],
		})

		await coordinator.compactTask()

		expect(options.buildStartSessionInput).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "old-session" }), {
			cwd: "/workspace",
			mode: "act",
		})
		expect(options.sessions.replaceActiveSession).toHaveBeenCalledWith({
			startInput: expect.objectContaining({
				config: expect.objectContaining({ sessionId: "old-session" }),
				interactive: true,
				prompt: undefined,
			}),
			initialMessages: [{ role: "user", content: "summary" }],
			disposeReason: "compactTask",
		})
		expect(task.taskId).toBe("new-session")
		expect(options.resetMessageTranslator).toHaveBeenCalledOnce()
		expect(options.setTurnPhase).toHaveBeenCalledWith("awaiting_followup")
		expect(options.sessions.getActiveSession()?.sdkHost.writeMessages).toHaveBeenCalledWith(
			"new-session",
			[{ role: "user", content: "summary" }],
		)
		expect(options.messages.appendAndEmit).toHaveBeenCalledWith(
			[expect.objectContaining({ say: "info", text: "Compacted 3 messages to 1." })],
			expect.anything(),
		)
	})

	it("reports a failure when compaction throws", async () => {
		const activeSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({ activeSession })
		compactSessionMessages.mockRejectedValueOnce(new Error("boom"))

		await coordinator.compactTask()

		expect(options.sessions.replaceActiveSession).not.toHaveBeenCalled()
		expect(options.messages.appendAndEmit).toHaveBeenCalledWith(
			[expect.objectContaining({ say: "info", text: "Compaction failed: boom" })],
			expect.anything(),
		)
	})
})

interface MakeCoordinatorInput {
	activeSession: ReturnType<typeof makeActiveSession> | undefined
	task: ReturnType<typeof makeTask>
}

function makeCoordinator(input: Partial<MakeCoordinatorInput> = {}) {
	const activeSession = "activeSession" in input ? input.activeSession : makeActiveSession()
	const tempHost = {
		readMessages: vi.fn().mockResolvedValue([{ role: "user", content: "1" }]),
		dispose: vi.fn().mockResolvedValue(undefined),
	}
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
	const startedSdkHost = { send: vi.fn(), writeMessages: vi.fn().mockResolvedValue(undefined) }
	const replacedSdkHost = { send: vi.fn(), writeMessages: vi.fn().mockResolvedValue(undefined) }
	let currentSession = activeSession
	const options = {
		stateManager: {
			getGlobalSettingsKey: vi.fn(() => "act"),
		} as unknown as StateManager,
		sessions: {
			getActiveSession: vi.fn(() => currentSession),
			startNewSession: vi.fn().mockImplementation(async () => {
				currentSession = { sessionId: "history-task", sdkHost: startedSdkHost, isRunning: true, startResult: { sessionId: "history-task" }, unsubscribe: vi.fn() }
				return { startResult: currentSession.startResult, sdkHost: startedSdkHost }
			}),
			replaceActiveSession: vi.fn().mockImplementation(async () => {
				currentSession = { sessionId: "new-session", sdkHost: replacedSdkHost, isRunning: false, startResult: { sessionId: "new-session" }, unsubscribe: vi.fn() }
				return { oldSessionId: "old-session", startResult: currentSession.startResult, sdkHost: replacedSdkHost }
			}),
			setRunning: vi.fn().mockImplementation((isRunning: boolean) => {
				if (currentSession) currentSession.isRunning = isRunning
			}),
		},
		messages: {
			appendAndEmit: vi.fn(),
		},
		taskHistory: {
			findHistoryItem: vi.fn().mockResolvedValue({ id: "history-task", task: "history task", ts: Date.now() }),
		},
		sessionConfigBuilder: {
			build: vi.fn().mockResolvedValue(config),
		},
		getTask: vi.fn(() => input.task),
		createTempSessionHost: vi.fn().mockResolvedValue(tempHost),
		getWorkspaceRoot: vi.fn().mockResolvedValue("/workspace"),
		loadInitialMessages: vi.fn(async (reader, taskId) => reader.readMessages(taskId)),
		buildStartSessionInput: vi.fn((startConfig) => ({
			config: startConfig,
			prompt: undefined,
			interactive: true,
		})),
		setTurnPhase: vi.fn(),
		resetMessageTranslator: vi.fn(),
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
	} as unknown as SdkCompactionCoordinatorOptions & {
		sessions: SdkCompactionCoordinatorOptions["sessions"] & {
			getActiveSession: ReturnType<typeof vi.fn>
			startNewSession: ReturnType<typeof vi.fn>
			replaceActiveSession: ReturnType<typeof vi.fn>
			setRunning: ReturnType<typeof vi.fn>
		}
		messages: SdkCompactionCoordinatorOptions["messages"] & {
			appendAndEmit: ReturnType<typeof vi.fn>
		}
		taskHistory: SdkCompactionCoordinatorOptions["taskHistory"] & {
			findHistoryItem: ReturnType<typeof vi.fn>
		}
		sessionConfigBuilder: SdkCompactionCoordinatorOptions["sessionConfigBuilder"] & {
			build: ReturnType<typeof vi.fn>
		}
		createTempSessionHost: ReturnType<typeof vi.fn>
		loadInitialMessages: ReturnType<typeof vi.fn>
		buildStartSessionInput: ReturnType<typeof vi.fn>
		setTurnPhase: ReturnType<typeof vi.fn>
		resetMessageTranslator: ReturnType<typeof vi.fn>
		postStateToWebview: ReturnType<typeof vi.fn>
	}

	return {
		coordinator: new SdkCompactionCoordinator(options),
		options,
		tempHost,
	}
}
function makeActiveSession(input: { isRunning?: boolean } = {}) {
	return {
		sessionId: "old-session",
		sdkHost: {
			readMessages: vi.fn().mockResolvedValue([{ role: "user", content: "1" }]),
			send: vi.fn(),
			writeMessages: vi.fn().mockResolvedValue(undefined),
			abort: vi.fn().mockResolvedValue(undefined),
			stop: vi.fn().mockResolvedValue(undefined),
			dispose: vi.fn().mockResolvedValue(undefined),
		},
		unsubscribe: vi.fn(),
		startResult: { sessionId: "old-session" },
		isRunning: input.isRunning ?? false,
	}
}

function makeTask(taskId: string, messages: Array<Partial<ClineMessage>> = []) {
	return {
		taskId,
		messageStateHandler: {
			getClineMessages: vi.fn(() => messages as ClineMessage[]),
		},
	} as unknown as {
		taskId: string
		messageStateHandler: { getClineMessages: () => ClineMessage[] }
	}
}
