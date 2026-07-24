import { createContextCompactionPrepareTurn } from "@cline/core"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { StateManager } from "@/core/storage/StateManager"
import { SdkCompactionCoordinator, type SdkCompactionCoordinatorOptions } from "./sdk-compaction-coordinator"

vi.mock("@cline/core", () => ({
	createContextCompactionPrepareTurn: vi.fn(),
	createSessionCompactionState: vi.fn((input: { compactedMessages: unknown[] }) => ({
		version: 1,
		messages: input.compactedMessages,
	})),
}))

const mockCreateContextCompactionPrepareTurn = createContextCompactionPrepareTurn as unknown as ReturnType<typeof vi.fn>

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

	it("emits an info message and does not rebuild when there is no active session", async () => {
		const { coordinator, options } = makeCoordinator({ activeSession: undefined })

		await coordinator.compactTask()

		expect(options.sessions.replaceActiveSession).not.toHaveBeenCalled()
		expect(mockCreateContextCompactionPrepareTurn).not.toHaveBeenCalled()
		expect(options.messages.appendAndEmit).toHaveBeenCalledWith(
			[expect.objectContaining({ say: "info", text: "There is no active task to compact." })],
			expect.anything(),
		)
	})

	it("refuses to compact while a turn is running", async () => {
		const activeSession = makeActiveSession({ isRunning: true })
		const { coordinator, options } = makeCoordinator({ activeSession })

		await coordinator.compactTask()

		expect(mockCreateContextCompactionPrepareTurn).not.toHaveBeenCalled()
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

		expect(mockCreateContextCompactionPrepareTurn).not.toHaveBeenCalled()
		expect(options.sessions.replaceActiveSession).not.toHaveBeenCalled()
		expect(options.messages.appendAndEmit).toHaveBeenCalledWith(
			[expect.objectContaining({ say: "info", text: "No messages to compact." })],
			expect.anything(),
		)
	})

	it("reports unsupported runtime without running compaction", async () => {
		const activeSession = makeActiveSession()
		;(activeSession.sdkHost as Partial<typeof activeSession.sdkHost>).updateSessionCompactionState = undefined
		const { coordinator, options } = makeCoordinator({ activeSession })

		await coordinator.compactTask()

		expect(activeSession.sdkHost.readMessages).not.toHaveBeenCalled()
		expect(mockCreateContextCompactionPrepareTurn).not.toHaveBeenCalled()
		expect(options.messages.appendAndEmit).toHaveBeenCalledWith(
			[expect.objectContaining({ say: "info", text: expect.stringContaining("not supported") })],
			expect.anything(),
		)
	})

	it("shows a skipped divider when the strategy declines to compact", async () => {
		const activeSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({ activeSession })
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(vi.fn().mockResolvedValue(undefined))

		await coordinator.compactTask()

		expect(mockCreateContextCompactionPrepareTurn).toHaveBeenCalledOnce()
		expect(options.sessions.replaceActiveSession).not.toHaveBeenCalled()
		const rows = compactionRows(options)
		expect(rows[0].info.status).toBe("started")
		expect(rows[1].info.status).toBe("skipped")
		// The terminal row updates the started row in place (same ts).
		expect(rows[1].ts).toBe(rows[0].ts)
	})

	it("compacts and persists the sidecar without rebuilding the session", async () => {
		const activeSession = makeActiveSession()
		activeSession.sdkHost.readMessages.mockResolvedValueOnce([
			{ role: "user", content: "1" },
			{ role: "assistant", content: "2" },
			{ role: "user", content: "3" },
		])
		const { coordinator, options } = makeCoordinator({ activeSession })
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		await coordinator.compactTask()

		expect(activeSession.sdkHost.updateSessionCompactionState).toHaveBeenCalledWith("old-session", {
			version: 1,
			messages: [{ role: "user", content: "summary" }],
		})
		expect(options.sessions.replaceActiveSession).not.toHaveBeenCalled()
		const rows = compactionRows(options)
		expect(rows[0].info).toMatchObject({ status: "started", mode: "manual" })
		expect(rows[1].info).toMatchObject({ status: "completed", mode: "manual", messagesBefore: 3, messagesAfter: 1 })
		expect(rows[1].ts).toBe(rows[0].ts)
	})

	it("prefers the SDK's token counters from its status notice for the completed divider", async () => {
		const activeSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({ activeSession })
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockImplementation((context: { emitStatusNotice?: (message: string, metadata?: unknown) => void }) => {
				context.emitStatusNotice?.("compacted", {
					kind: "manual_compaction",
					phase: "completed",
					tokensBefore: 25_000,
					tokensAfter: 6_000,
					messagesBefore: 42,
					messagesAfter: 5,
				})
				return Promise.resolve({ messages: [{ role: "user", content: "summary" }] })
			}),
		)

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
		options.sessions.getActiveSession
			.mockReturnValueOnce(activeSession)
			.mockReturnValue(makeActiveSession({ sessionId: "other-session" }))
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		await coordinator.compactTask()

		expect(activeSession.sdkHost.updateSessionCompactionState).toHaveBeenCalled()
		expect(options.messages.appendAndEmit).not.toHaveBeenCalled()
	})

	it("does not restart or report success when sidecar persistence fails", async () => {
		const activeSession = makeActiveSession()
		activeSession.sdkHost.updateSessionCompactionState.mockResolvedValueOnce({ updated: false })
		const { coordinator, options } = makeCoordinator({ activeSession })
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		await coordinator.compactTask()

		expect(options.sessions.replaceActiveSession).not.toHaveBeenCalled()
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
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(vi.fn().mockRejectedValue(new Error("boom")))

		await coordinator.compactTask()

		expect(options.sessions.replaceActiveSession).not.toHaveBeenCalled()
		const rows = compactionRows(options)
		expect(rows[rows.length - 1].info.status).toBe("failed")
		expect(options.messages.appendAndEmit).toHaveBeenCalledWith(
			[expect.objectContaining({ say: "info", text: "Couldn't compact the conversation. Please try again." })],
			expect.anything(),
		)
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
}

function makeCoordinator(input: Partial<MakeCoordinatorInput> = {}) {
	const activeSession = "activeSession" in input ? input.activeSession : makeActiveSession()
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
		getWorkspaceRoot: vi.fn().mockResolvedValue("/workspace"),
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
	} as unknown as SdkCompactionCoordinatorOptions & {
		sessions: SdkCompactionCoordinatorOptions["sessions"] & {
			getActiveSession: ReturnType<typeof vi.fn>
			replaceActiveSession: ReturnType<typeof vi.fn>
		}
		messages: SdkCompactionCoordinatorOptions["messages"] & {
			appendAndEmit: ReturnType<typeof vi.fn>
		}
		sessionConfigBuilder: SdkCompactionCoordinatorOptions["sessionConfigBuilder"] & {
			build: ReturnType<typeof vi.fn>
		}
		postStateToWebview: ReturnType<typeof vi.fn>
	}

	return {
		coordinator: new SdkCompactionCoordinator(options),
		options,
	}
}

function makeActiveSession(input: { isRunning?: boolean; sessionId?: string } = {}) {
	return {
		sessionId: input.sessionId ?? "old-session",
		sdkHost: {
			readMessages: vi.fn().mockResolvedValue([{ role: "user", content: "1" }]),
			updateSessionCompactionState: vi.fn().mockResolvedValue({ updated: true }),
			send: vi.fn(),
			abort: vi.fn().mockResolvedValue(undefined),
			stop: vi.fn().mockResolvedValue(undefined),
			dispose: vi.fn().mockResolvedValue(undefined),
		},
		unsubscribe: vi.fn(),
		startResult: { sessionId: "old-session" },
		isRunning: input.isRunning ?? false,
	}
}
