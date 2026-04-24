import type { CoreSessionEvent } from "@clinebot/core"
import type { ClineMessage } from "@shared/ExtensionMessage"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { MessageTranslatorState } from "./message-translator"
import { SdkSessionEventCoordinator, type SdkSessionEventCoordinatorOptions } from "./sdk-session-event-coordinator"

vi.mock("@/shared/services/Logger", () => ({
	Logger: {
		error: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
	},
}))

describe("SdkSessionEventCoordinator", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("translates and emits session messages, then posts state", async () => {
		const message: ClineMessage = { ts: 1, type: "say", say: "text", text: "hello" }
		const { coordinator, options, event } = makeCoordinator({
			translation: {
				messages: [message],
				sessionEnded: false,
				turnComplete: false,
			},
		})

		coordinator.handleSessionEvent(event)
		await Promise.resolve()

		expect(options.messages.appendAndEmit).toHaveBeenCalledWith([message], event)
		expect(options.postStateToWebview).toHaveBeenCalledOnce()
	})

	it("filters late completion messages after cancellation", async () => {
		const { coordinator, options, event } = makeCoordinator({
			activeSession: makeActiveSession({ isRunning: false }),
			translation: {
				messages: [
					{ ts: 1, type: "ask", ask: "completion_result", text: "" },
					{ ts: 2, type: "say", say: "text", text: "kept" },
				],
				sessionEnded: false,
				turnComplete: false,
			},
		})

		coordinator.handleSessionEvent(event)
		await Promise.resolve()

		expect(options.messages.appendAndEmit).toHaveBeenCalledWith([{ ts: 2, type: "say", say: "text", text: "kept" }], event)
	})

	it("marks turns complete, checks deferred reloads, and applies pending mode changes", () => {
		const activeSession = makeActiveSession()
		const { coordinator, options, event } = makeCoordinator({
			activeSession,
			hasPendingModeChange: true,
			translation: {
				messages: [],
				sessionEnded: false,
				turnComplete: true,
			},
		})

		coordinator.handleSessionEvent(event)

		expect(options.sessions.setRunning).toHaveBeenCalledWith(false)
		expect(options.mcpTools.checkDeferredRestart).toHaveBeenCalledOnce()
		expect(options.mode.applyPendingModeChange).toHaveBeenCalledOnce()
	})

	it("updates task usage when the active session has a start result", () => {
		const { coordinator, options, event } = makeCoordinator({
			task: { taskId: "task-1" },
			translation: {
				messages: [],
				sessionEnded: false,
				turnComplete: false,
				usage: { tokensIn: 3, tokensOut: 4, cacheReads: 5, cacheWrites: 0, totalCost: 0.01 },
			},
		})

		coordinator.handleSessionEvent(event)

		expect(options.taskHistory.updateTaskUsage).toHaveBeenCalledWith("task-1", {
			tokensIn: 3,
			tokensOut: 4,
			cacheReads: 5,
			cacheWrites: 0,
			totalCost: 0.01,
		})
	})

	it("zeros usage and api request message cost for free Cline models", async () => {
		const { coordinator, options, event } = makeCoordinator({
			isClineFreeModel: vi.fn().mockResolvedValue(true),
			task: { taskId: "task-1" },
			translation: {
				messages: [
					{
						ts: 1,
						type: "say",
						say: "api_req_started",
						text: JSON.stringify({ tokensIn: 10, tokensOut: 5, cost: 0.0016 }),
					},
				],
				sessionEnded: false,
				turnComplete: false,
				usage: { tokensIn: 10, tokensOut: 5, totalCost: 0.0016 },
			},
		})

		await coordinator.handleSessionEvent(event)

		expect(options.messages.appendAndEmit).toHaveBeenCalledWith(
			[
				{
					ts: 1,
					type: "say",
					say: "api_req_started",
					text: JSON.stringify({ tokensIn: 10, tokensOut: 5, cost: 0 }),
				},
			],
			event,
		)
		expect(options.taskHistory.updateTaskUsage).toHaveBeenCalledWith("task-1", {
			tokensIn: 10,
			tokensOut: 5,
			totalCost: 0,
		})
	})
})

function makeCoordinator(input: Partial<MakeCoordinatorInput> = {}) {
	const event: CoreSessionEvent = {
		type: "agent_event",
		payload: {
			sessionId: "session-123",
			event: { type: "done", success: true },
		},
	} as unknown as CoreSessionEvent
	const activeSession = input.activeSession ?? makeActiveSession()
	const options = {
		messageTranslatorState: new MessageTranslatorState(),
		sessions: {
			getActiveSession: vi.fn(() => activeSession),
			setRunning: vi.fn(),
		},
		messages: {
			appendAndEmit: vi.fn(),
		},
		mcpTools: {
			checkDeferredRestart: vi.fn(),
		},
		mode: {
			hasPendingModeChange: vi.fn(() => input.hasPendingModeChange ?? false),
			applyPendingModeChange: vi.fn().mockResolvedValue(undefined),
		},
		taskHistory: {
			updateTaskUsage: vi.fn(),
		},
		getTask: vi.fn(() => input.task),
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		translateSessionEvent: vi.fn(() => input.translation ?? { messages: [], sessionEnded: false, turnComplete: false }),
		isClineFreeModel: input.isClineFreeModel,
	} as unknown as SdkSessionEventCoordinatorOptions & {
		sessions: SdkSessionEventCoordinatorOptions["sessions"] & {
			getActiveSession: ReturnType<typeof vi.fn>
			setRunning: ReturnType<typeof vi.fn>
		}
		messages: SdkSessionEventCoordinatorOptions["messages"] & { appendAndEmit: ReturnType<typeof vi.fn> }
		mcpTools: SdkSessionEventCoordinatorOptions["mcpTools"] & { checkDeferredRestart: ReturnType<typeof vi.fn> }
		mode: SdkSessionEventCoordinatorOptions["mode"] & {
			hasPendingModeChange: ReturnType<typeof vi.fn>
			applyPendingModeChange: ReturnType<typeof vi.fn>
		}
		taskHistory: SdkSessionEventCoordinatorOptions["taskHistory"] & { updateTaskUsage: ReturnType<typeof vi.fn> }
		postStateToWebview: ReturnType<typeof vi.fn>
	}

	return {
		coordinator: new SdkSessionEventCoordinator(options),
		options,
		event,
	}
}

function makeActiveSession(input: Partial<{ isRunning: boolean }> = {}) {
	return {
		sessionId: "session-123",
		sessionManager: {},
		unsubscribe: vi.fn(),
		startResult: { sessionId: "session-123" },
		isRunning: input.isRunning ?? true,
	}
}

interface MakeCoordinatorInput {
	activeSession: ReturnType<typeof makeActiveSession>
	hasPendingModeChange: boolean
	task: { taskId: string }
	isClineFreeModel: () => Promise<boolean>
	translation: {
		messages: ClineMessage[]
		sessionEnded: boolean
		turnComplete: boolean
		usage?: {
			tokensIn: number
			tokensOut: number
			cacheWrites?: number
			cacheReads?: number
			totalCost?: number
		}
	}
}
