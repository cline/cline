import type { CoreSessionEvent } from "@cline/core"
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

	it("ignores stale events from inactive sessions", async () => {
		const { coordinator, options, event } = makeCoordinator({
			translation: {
				messages: [{ ts: 1, type: "say", say: "text", text: "stale" }],
				sessionEnded: false,
				turnComplete: false,
			},
		})
		const staleEvent = {
			...event,
			payload: { ...event.payload, sessionId: "old-session" },
		} as CoreSessionEvent

		await coordinator.handleSessionEvent(staleEvent)

		expect(options.translateSessionEvent).not.toHaveBeenCalled()
		expect(options.messages.appendAndEmit).not.toHaveBeenCalled()
		expect(options.postStateToWebview).not.toHaveBeenCalled()
	})

	it("marks turns complete and delegates provider restart handling", async () => {
		const activeSession = makeActiveSession()
		const { coordinator, options, event } = makeCoordinator({
			activeSession,
			translation: {
				messages: [],
				sessionEnded: false,
				turnComplete: true,
			},
		})

		await coordinator.handleSessionEvent(event)

		expect(options.sessions.setRunning).toHaveBeenCalledWith(false)
		expect(options.mcpTools.checkDeferredRestart).toHaveBeenCalledOnce()
		expect(options.providerChanges.handleTurnComplete).toHaveBeenCalledWith(options.mode)
	})

	it("posts state on turn end even when the turn-complete event carries NO messages", async () => {
		// The `done` handler emits no transcript message, so a turn-complete event has
		// messages.length === 0 while the phase changes to completed/awaiting_followup. State must
		// be posted on turn end regardless of message count, or the footer stays stuck on the
		// previous phase (e.g. scroll-arrows / streaming).
		const { coordinator, options, event } = makeCoordinator({
			translation: {
				messages: [],
				sessionEnded: false,
				turnComplete: true,
			},
		})

		await coordinator.handleSessionEvent(event)

		expect(options.setTurnPhase).toHaveBeenCalledWith("awaiting_followup")
		expect(options.postStateToWebview).toHaveBeenCalledOnce()
	})

	it("marks a submitted queued prompt as a new streaming turn", async () => {
		const message: ClineMessage = { ts: 1, type: "say", say: "user_feedback", text: "queued prompt" }
		const { coordinator, options } = makeCoordinator({
			translation: {
				messages: [message],
				sessionEnded: false,
				turnComplete: false,
			},
		})
		const clearTurnOutcome = vi.spyOn(options.messageTranslatorState, "clearTurnOutcome")
		const event: CoreSessionEvent = {
			type: "pending_prompt_submitted",
			payload: {
				sessionId: "session-123",
				id: "pending-1",
				prompt: "queued prompt",
				delivery: "queue",
				attachmentCount: 0,
			},
		} as CoreSessionEvent

		await coordinator.handleSessionEvent(event)

		expect(clearTurnOutcome).toHaveBeenCalledOnce()
		expect(options.sessions.setRunning).toHaveBeenCalledWith(true)
		expect(options.setTurnPhase).toHaveBeenCalledWith("streaming")
		expect(options.messages.appendAndEmit).toHaveBeenCalledWith([message], event)
		expect(options.postStateToWebview).toHaveBeenCalledOnce()
	})

	it("posts state for queued prompt turn start even when no transcript message is emitted", async () => {
		const { coordinator, options } = makeCoordinator({
			translation: {
				messages: [],
				sessionEnded: false,
				turnComplete: false,
			},
		})
		const event: CoreSessionEvent = {
			type: "pending_prompt_submitted",
			payload: {
				sessionId: "session-123",
				id: "pending-1",
				prompt: "",
				delivery: "queue",
				attachmentCount: 0,
			},
		} as CoreSessionEvent

		await coordinator.handleSessionEvent(event)

		expect(options.setTurnPhase).toHaveBeenCalledWith("streaming")
		expect(options.messages.appendAndEmit).not.toHaveBeenCalled()
		expect(options.postStateToWebview).toHaveBeenCalledOnce()
	})

	it("does NOT override the phase on a turn-complete straggler from an already-cancelled session", async () => {
		// After cancelTask sets phase "resumable" and aborts, the SDK may still emit a trailing
		// done/turnComplete. Because the session is no longer running, this straggler must NOT
		// set "awaiting_followup"/"completed" — doing so would clobber "resumable" and the footer
		// would lose the Resume Task button (showing scroll-arrows).
		const { coordinator, options, event } = makeCoordinator({
			activeSession: makeActiveSession({ isRunning: false }),
			translation: {
				messages: [],
				sessionEnded: false,
				turnComplete: true,
			},
		})

		await coordinator.handleSessionEvent(event)

		expect(options.setTurnPhase).not.toHaveBeenCalled()
	})

	it("updates task usage when the active session has a start result", async () => {
		const { coordinator, options, event } = makeCoordinator({
			task: { taskId: "task-1" },
			translation: {
				messages: [],
				sessionEnded: false,
				turnComplete: false,
				usage: { tokensIn: 3, tokensOut: 4, cacheReads: 5, cacheWrites: 0, totalCost: 0.01 },
			},
		})

		await coordinator.handleSessionEvent(event)

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

	it("leaves mistake-limit recovery to the SDK callback instead of mutating tool-error events", async () => {
		const message: ClineMessage = { ts: 1, type: "say", say: "tool", text: "{}", partial: false }
		const { coordinator, options, event } = makeCoordinator({
			translation: {
				messages: [message],
				sessionEnded: false,
				turnComplete: false,
				toolError: true,
			},
		})

		await coordinator.handleSessionEvent(event)

		expect(options.messages.appendAndEmit).toHaveBeenCalledWith([message], event)
		expect(options.sessions.setRunning).not.toHaveBeenCalled()
	})

	it("captures provider failure telemetry for SDK agent errors", async () => {
		const error = new Error("provider failed")
		const { coordinator, options } = makeCoordinator()
		const event: CoreSessionEvent = {
			type: "agent_event",
			payload: {
				sessionId: "session-123",
				event: {
					type: "error",
					error,
				},
			},
		} as unknown as CoreSessionEvent

		await coordinator.handleSessionEvent(event)

		expect(options.captureProviderApiError).toHaveBeenCalledWith({
			sessionId: "session-123",
			error,
			errorType: "sdk_agent_error",
			failurePhase: "streaming",
		})
	})

	it("captures provider failure telemetry when the SDK finishes a turn with reason error", async () => {
		const { coordinator, options } = makeCoordinator()
		const event: CoreSessionEvent = {
			type: "agent_event",
			payload: {
				sessionId: "session-123",
				event: {
					type: "done",
					reason: "error",
					text: "stream failed before assistant output",
					iterations: 1,
				},
			},
		} as unknown as CoreSessionEvent

		await coordinator.handleSessionEvent(event)

		expect(options.captureProviderApiError).toHaveBeenCalledWith({
			sessionId: "session-123",
			error: "stream failed before assistant output",
			errorType: "sdk_agent_done_error",
			failurePhase: "streaming",
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
		providerChanges: {
			handleTurnComplete: vi.fn().mockResolvedValue(undefined),
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
		setTurnPhase: vi.fn(),
		captureProviderApiError: vi.fn(),
		translateSessionEvent: vi.fn(() => input.translation ?? { messages: [], sessionEnded: false, turnComplete: false }),
		isClineFreeModel: input.isClineFreeModel,
	} as unknown as SdkSessionEventCoordinatorOptions & {
		sessions: SdkSessionEventCoordinatorOptions["sessions"] & {
			getActiveSession: ReturnType<typeof vi.fn>
			setRunning: ReturnType<typeof vi.fn>
		}
		messages: SdkSessionEventCoordinatorOptions["messages"] & { appendAndEmit: ReturnType<typeof vi.fn> }
		mcpTools: SdkSessionEventCoordinatorOptions["mcpTools"] & { checkDeferredRestart: ReturnType<typeof vi.fn> }
		providerChanges: NonNullable<SdkSessionEventCoordinatorOptions["providerChanges"]> & {
			handleTurnComplete: ReturnType<typeof vi.fn>
		}
		mode: SdkSessionEventCoordinatorOptions["mode"] & {
			hasPendingModeChange: ReturnType<typeof vi.fn>
			applyPendingModeChange: ReturnType<typeof vi.fn>
		}
		taskHistory: SdkSessionEventCoordinatorOptions["taskHistory"] & { updateTaskUsage: ReturnType<typeof vi.fn> }
		postStateToWebview: ReturnType<typeof vi.fn>
		captureProviderApiError: ReturnType<typeof vi.fn>
		translateSessionEvent: ReturnType<typeof vi.fn>
		messageTranslatorState: MessageTranslatorState
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
		sdkHost: {},
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
		toolError?: boolean
		usage?: {
			tokensIn: number
			tokensOut: number
			cacheWrites?: number
			cacheReads?: number
			totalCost?: number
		}
	}
}
