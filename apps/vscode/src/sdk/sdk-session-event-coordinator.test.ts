import type { CoreSessionEvent } from "@cline/core"
import type { ClineMessage } from "@shared/ExtensionMessage"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { MessageTranslatorState } from "./message-translator"
import { PROVIDER_FAILURE_ERROR_TYPE, PROVIDER_FAILURE_PHASE } from "./provider-failure-telemetry"
import { Controller } from "./SdkController"
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

	it("projects only the latest matching active-session report without transcript or history writes", async () => {
		const { coordinator, options } = makeCoordinator()
		const report = subscriptionEvent()
		await coordinator.handleSessionEvent(report)
		if (report.payload.event.type === "subscription_usage") report.payload.event.usage.windows[0].usedPercent = 99
		expect(coordinator.getSubscriptionUsage()?.windows[0].usedPercent).toBe(25)
		await coordinator.handleSessionEvent(subscriptionEvent({ capturedAt: 1500 }))
		await coordinator.handleSessionEvent(subscriptionEvent({ providerId: "claude-code", capturedAt: 4000 }))
		await coordinator.handleSessionEvent({ ...report, payload: { ...report.payload, sessionId: "other-session" } })
		expect(options.postStateToWebview).toHaveBeenCalledOnce()
		expect(options.translateSessionEvent).not.toHaveBeenCalled()
		expect(options.messages.appendAndEmit).not.toHaveBeenCalled()
		expect(options.taskHistory.updateTaskUsage).not.toHaveBeenCalled()
		expect(options.captureProviderApiError).not.toHaveBeenCalled()
	})

	it.each(["fields", "selection"])("preserves quota on unrelated fields or Codex model-only %s writes", async (kind) => {
		const { coordinator } = makeCoordinator()
		await coordinator.handleSessionEvent(subscriptionEvent())
		const controller = Object.assign(Object.create(Controller.prototype), {
			sessionEvents: coordinator,
			scheduleProviderConfigStatePost: vi.fn(),
			isSelectionForActiveModeProvider: () => true,
			sessions: { updateActiveSessionModel: vi.fn().mockResolvedValue(undefined) },
		})
		Controller.prototype["handleProviderConfigChange"].call(controller, {
			kind,
			providerId: kind === "fields" ? "anthropic" : "openai-codex",
			selection: { modelId: "new-model" },
		} as never)
		expect(coordinator.getSubscriptionUsage()).toBeDefined()
	})

	it("clears and fences old-auth runs, including reports first received after replacement", async () => {
		const clock = vi.spyOn(Date, "now").mockReturnValue(3000)
		try {
			const { coordinator, options } = makeCoordinator()
			await coordinator.handleSessionEvent(subscriptionEvent())
			options.getCodexAuthVersion.mockReturnValue(1)
			const invalidate = vi.spyOn(coordinator, "invalidateSubscriptionUsage")
			expect(coordinator.getSubscriptionUsage()).toBeUndefined()
			expect(invalidate).not.toHaveBeenCalled()
			await coordinator.handleSessionEvent(subscriptionEvent({ capturedAt: 4000 }))
			expect(coordinator.getSubscriptionUsage()).toBeUndefined()
			// Use the real adapter/dispatch path: a late child inherits old root credentials.
			const source = new URL("../../../../sdk/packages/core/src/", import.meta.url)
			const { AgentEventBridge } = await import(new URL("runtime/host/local/agent-event-bridge.ts", source).pathname)
			const { RuntimeEventAdapter } = await import(
				new URL("runtime/orchestration/runtime-event-adapter.ts", source).pathname
			)
			const emitted: CoreSessionEvent[] = []
			const bridge = new AgentEventBridge({
				getSession: () =>
					({ agent: { getAgentId: () => "old-root", getConversationId: () => "root-conv" }, runtime: {} }) as never,
				emit: (event: CoreSessionEvent) => emitted.push(event),
			} as never)
			const child = subscriptionEvent({ runStartedAt: 4000, capturedAt: 4500 }).payload.event
			if (child.type !== "subscription_usage") throw new Error("expected quota fixture")
			for (const event of new RuntimeEventAdapter().translate({
				type: "subscription-usage",
				usage: child.usage,
				runStartedAt: child.runStartedAt,
				snapshot: { agentId: "child", conversationId: "child-conv", parentAgentId: "old-root" } as never,
			}))
				bridge.dispatchAgentEvent("session-123", {} as never, event)
			expect(emitted[0]).toMatchObject({
				payload: { teamRole: undefined, event: { agentId: "child", parentAgentId: "old-root" } },
			})
			for (const event of emitted) await coordinator.handleSessionEvent(event)
			expect(coordinator.getSubscriptionUsage()).toBeUndefined()
			await coordinator.handleSessionEvent(subscriptionEvent({ runStartedAt: 4000, capturedAt: 4500 }))
			expect(coordinator.getSubscriptionUsage()).toBeDefined()
			clock.mockReturnValue(5000)
			coordinator.invalidateSubscriptionUsage()
			await coordinator.handleSessionEvent(subscriptionEvent({ runStartedAt: 4000, capturedAt: 6000 }))
			expect(coordinator.getSubscriptionUsage()).toBeUndefined()
			await coordinator.handleSessionEvent(subscriptionEvent({ runStartedAt: 6000, capturedAt: 6500 }))
			expect(coordinator.getSubscriptionUsage()).toBeDefined()
			options.getProviderId.mockReturnValue("anthropic")
			coordinator.handleSubscriptionUsageContextChange()
			expect(coordinator.getSubscriptionUsage()).toBeUndefined()
			options.getProviderId.mockReturnValue("openai-codex")
			await coordinator.handleSessionEvent(subscriptionEvent({ runStartedAt: 6000, capturedAt: 7000 }))
			options.sessions.getActiveSession.mockReturnValue({ ...makeActiveSession(), sessionId: "replacement" })
			expect(coordinator.getSubscriptionUsage()).toBeUndefined()
		} finally {
			clock.mockRestore()
		}
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

	it("marks turns complete through the session lifecycle", async () => {
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

	it("resolves the turn phase to 'error' when the turn surfaced a provider error", async () => {
		const { coordinator, options, event } = makeCoordinator({
			translation: {
				messages: [],
				sessionEnded: false,
				turnComplete: true,
			},
		})
		options.messageTranslatorState.setErrorSeen()

		await coordinator.handleSessionEvent(event)

		expect(options.setTurnPhase).toHaveBeenCalledWith("error")
		expect(options.setTurnPhase).not.toHaveBeenCalledWith("awaiting_followup")
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
		expect(options.beginProviderFailureTelemetryTurn).toHaveBeenCalledOnce()
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
			turnPhase: "resumable",
			translation: {
				messages: [],
				sessionEnded: false,
				turnComplete: true,
			},
		})

		await coordinator.handleSessionEvent(event)

		expect(options.setTurnPhase).not.toHaveBeenCalled()
	})

	it("resolves the phase when a queued turn completes after its running flag was clobbered", async () => {
		// When the SDK drains a queued prompt at turn end, the previous turn's send promise
		// settles after the queued turn already started and flips isRunning back to false
		// mid-turn. The queued turn's real completion must still resolve the terminal phase —
		// treating it as a cancel straggler leaves the phase stuck on "streaming" (endless
		// Thinking). Only an actual cancel (phase "resumable") is preserved.
		const { coordinator, options, event } = makeCoordinator({
			activeSession: makeActiveSession({ isRunning: false }),
			turnPhase: "streaming",
			translation: {
				messages: [],
				sessionEnded: false,
				turnComplete: true,
			},
		})

		await coordinator.handleSessionEvent(event)

		expect(options.setTurnPhase).toHaveBeenCalledWith("awaiting_followup")
		expect(options.sessions.setRunning).toHaveBeenCalledWith(false)
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
					recoverable: false,
				},
			},
		} as unknown as CoreSessionEvent

		await coordinator.handleSessionEvent(event)

		expect(options.captureProviderApiError).toHaveBeenCalledWith({
			sessionId: "session-123",
			error,
			errorType: PROVIDER_FAILURE_ERROR_TYPE.SDK_AGENT_ERROR,
			failurePhase: PROVIDER_FAILURE_PHASE.STREAMING,
		})
	})

	it("does not capture provider failure telemetry for SDK agent errors without an error payload", async () => {
		const { coordinator, options } = makeCoordinator()
		const event: CoreSessionEvent = {
			type: "agent_event",
			payload: {
				sessionId: "session-123",
				event: {
					type: "error",
				},
			},
		} as unknown as CoreSessionEvent

		await coordinator.handleSessionEvent(event)

		expect(options.captureProviderApiError).not.toHaveBeenCalled()
	})

	it("does not capture provider failure telemetry for recoverable error events (mistake notices)", async () => {
		const { coordinator, options } = makeCoordinator()
		const event: CoreSessionEvent = {
			type: "agent_event",
			payload: {
				sessionId: "session-123",
				event: {
					type: "error",
					// The MistakeTracker emits one of these per recorded mistake,
					// carrying tool-failure details — not a provider API error.
					error: new Error('2 tool call(s) failed: [shell] {"error":"command not found"}'),
					recoverable: true,
				},
			},
		} as unknown as CoreSessionEvent

		await coordinator.handleSessionEvent(event)

		expect(options.captureProviderApiError).not.toHaveBeenCalled()
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
			errorType: PROVIDER_FAILURE_ERROR_TYPE.SDK_AGENT_DONE_ERROR,
			failurePhase: PROVIDER_FAILURE_PHASE.STREAMING,
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
		getProviderId: vi.fn(() => "openai-codex"),
		getCodexAuthVersion: vi.fn(() => 0),
		messageTranslatorState: new MessageTranslatorState(),
		sessions: {
			getActiveSession: vi.fn(() => activeSession),
			setRunning: vi.fn(),
			setQueuedPromptCount: vi.fn(),
		},
		messages: {
			appendAndEmit: vi.fn(),
		},
		taskHistory: {
			updateTaskUsage: vi.fn(),
		},
		getTask: vi.fn(() => input.task),
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		setTurnPhase: vi.fn(),
		getTurnPhase: vi.fn(() => input.turnPhase ?? "streaming"),
		captureProviderApiError: vi.fn(),
		beginProviderFailureTelemetryTurn: vi.fn(),
		translateSessionEvent: vi.fn(() => input.translation ?? { messages: [], sessionEnded: false, turnComplete: false }),
		isClineFreeModel: input.isClineFreeModel,
	} as unknown as SdkSessionEventCoordinatorOptions & {
		getProviderId: ReturnType<typeof vi.fn>
		getCodexAuthVersion: ReturnType<typeof vi.fn>
		sessions: SdkSessionEventCoordinatorOptions["sessions"] & {
			getActiveSession: ReturnType<typeof vi.fn>
			setRunning: ReturnType<typeof vi.fn>
		}
		messages: SdkSessionEventCoordinatorOptions["messages"] & { appendAndEmit: ReturnType<typeof vi.fn> }
		taskHistory: SdkSessionEventCoordinatorOptions["taskHistory"] & { updateTaskUsage: ReturnType<typeof vi.fn> }
		postStateToWebview: ReturnType<typeof vi.fn>
		captureProviderApiError: ReturnType<typeof vi.fn>
		beginProviderFailureTelemetryTurn: ReturnType<typeof vi.fn>
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
	task: { taskId: string }
	turnPhase: "streaming" | "resumable"
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

function subscriptionEvent(
	input: Partial<{ capturedAt: number; runStartedAt: number; providerId: string }> = {},
): Extract<CoreSessionEvent, { type: "agent_event" }> {
	return {
		type: "agent_event",
		payload: {
			sessionId: "session-123",
			event: {
				type: "subscription_usage",
				runStartedAt: input.runStartedAt ?? 1000,
				usage: {
					providerId: input.providerId ?? "openai-codex",
					source: "codex-response-headers",
					capturedAt: input.capturedAt ?? 2000,
					windows: [{ id: "primary", usedPercent: 25, windowMinutes: 300 }],
				},
			},
		},
	}
}
