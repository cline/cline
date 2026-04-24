import { beforeEach, describe, expect, it, vi } from "vitest"
import type { StateManager } from "@/core/storage/StateManager"
import { SdkFollowupCoordinator, type SdkFollowupCoordinatorOptions } from "./sdk-followup-coordinator"

vi.mock("@/shared/services/Logger", () => ({
	Logger: {
		error: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
	},
}))

describe("SdkFollowupCoordinator", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("resolves pending tool approvals without sending a follow-up", async () => {
		const { coordinator, options } = makeCoordinator()
		options.interactions.resolvePendingToolApproval.mockReturnValue(true)

		await coordinator.askResponse("yes", undefined, undefined, "yesButtonClicked")

		expect(options.interactions.resolvePendingToolApproval).toHaveBeenCalledWith("yes", "yesButtonClicked")
		expect(options.sessions.fireAndForgetSend).not.toHaveBeenCalled()
	})

	it("resolves pending ask_question responses without sending a follow-up", async () => {
		const { coordinator, options } = makeCoordinator()
		options.interactions.resolvePendingAskQuestion.mockReturnValue(true)

		await coordinator.askResponse("answer")

		expect(options.interactions.resolvePendingAskQuestion).toHaveBeenCalledWith("answer")
		expect(options.sessions.fireAndForgetSend).not.toHaveBeenCalled()
	})

	it("sends a follow-up to an idle active session", async () => {
		const activeSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({ activeSession })

		await coordinator.askResponse("hello @file", ["image.png"], ["a.ts"])

		expect(options.sessions.setRunning).toHaveBeenCalledWith(true)
		expect(options.messages.appendAndEmit).toHaveBeenCalledWith(
			[
				expect.objectContaining({
					type: "say",
					say: "user_feedback",
					text: "hello @file",
					images: ["image.png"],
					files: ["a.ts"],
				}),
			],
			{ type: "status", payload: { sessionId: "session-123", status: "running" } },
		)
		expect(options.resetMessageTranslator).toHaveBeenCalledOnce()
		expect(options.resolveContextMentions).toHaveBeenCalledWith("hello @file")
		expect(options.sessions.fireAndForgetSend).toHaveBeenCalledWith(
			activeSession.sessionManager,
			"session-123",
			"resolved: hello @file",
			["image.png"],
			["a.ts"],
			undefined,
		)
	})

	it("queues a follow-up when the active session is already running", async () => {
		const activeSession = makeActiveSession({ isRunning: true })
		const { coordinator, options } = makeCoordinator({ activeSession })

		await coordinator.askResponse("queued")

		expect(options.resetMessageTranslator).not.toHaveBeenCalled()
		expect(options.sessions.fireAndForgetSend).toHaveBeenCalledWith(
			activeSession.sessionManager,
			"session-123",
			"resolved: queued",
			undefined,
			undefined,
			"queue",
		)
	})

	it("resumes a displayed task before sending a follow-up when there is no live session", async () => {
		const task = makeTask("task-1")
		const historyItem = {
			id: "task-1",
			ts: 1,
			task: "Original task",
			tokensIn: 0,
			tokensOut: 0,
			totalCost: 0,
			cwdOnTaskInitialization: "/task-cwd",
		}
		const { coordinator, options } = makeCoordinator({ task, historyItem })

		await coordinator.askResponse("continue")

		expect(options.sessionConfigBuilder.build).toHaveBeenCalledWith({ cwd: "/task-cwd", mode: "act" })
		expect(options.createTempSessionHost).toHaveBeenCalledOnce()
		expect(options.loadInitialMessages).toHaveBeenCalledWith(
			expect.objectContaining({ readMessages: expect.any(Function) }),
			"task-1",
		)
		expect(options.sessions.startNewSession).toHaveBeenCalledWith({
			config: expect.objectContaining({ sessionId: "task-1" }),
			interactive: true,
			initialMessages: [{ role: "user", content: "hello" }],
		})
		expect(options.taskHistory.updateTaskHistory).toHaveBeenCalledWith(
			expect.objectContaining({ id: "task-1", modelId: "model" }),
		)
		expect(options.resolveContextMentions).toHaveBeenCalledWith("continue")
		expect(options.sessions.fireAndForgetSend).toHaveBeenCalledWith(
			expect.objectContaining({ send: expect.any(Function) }),
			"resumed-session",
			"resolved: continue",
			undefined,
			undefined,
		)
		expect(options.postStateToWebview).toHaveBeenCalledOnce()
	})

	it("emits auth errors when resume fails because the cline provider is unauthenticated", async () => {
		const task = makeTask("task-1")
		const { coordinator, options } = makeCoordinator({ task })
		options.sessionConfigBuilder.build.mockRejectedValue(new Error("missing api key"))
		options.isClineProviderActive.mockReturnValue(true)

		await coordinator.askResponse("continue")

		expect(options.emitClineAuthError).toHaveBeenCalledOnce()
		expect(options.postStateToWebview).toHaveBeenCalledOnce()
	})
})

function makeCoordinator(input: Partial<MakeCoordinatorInput> = {}) {
	const config = {
		providerId: "anthropic",
		modelId: "model",
		apiKey: "key",
	}
	const tempHost = {
		readMessages: vi.fn().mockResolvedValue([{ role: "user", content: "hello" }]),
		dispose: vi.fn().mockResolvedValue(undefined),
	}
	const options = {
		stateManager: {
			getGlobalSettingsKey: vi.fn(() => input.mode ?? "act"),
		} as unknown as StateManager,
		interactions: {
			resolvePendingToolApproval: vi.fn(() => false),
			resolvePendingAskQuestion: vi.fn(() => false),
		},
		sessions: {
			getActiveSession: vi.fn(() => input.activeSession),
			setRunning: vi.fn(),
			fireAndForgetSend: vi.fn(),
			startNewSession: vi.fn().mockResolvedValue({
				startResult: { sessionId: "resumed-session" },
				sessionManager: { send: vi.fn() },
			}),
		},
		messages: {
			appendAndEmit: vi.fn(),
			emitSessionEvents: vi.fn(),
		},
		taskHistory: {
			findHistoryItem: vi.fn(() => input.historyItem),
			updateTaskHistory: vi.fn().mockResolvedValue([]),
		},
		sessionConfigBuilder: {
			build: vi.fn().mockResolvedValue(config),
		},
		getTask: vi.fn(() => input.task),
		createTempSessionHost: vi.fn().mockResolvedValue(tempHost),
		getWorkspaceRoot: vi.fn().mockResolvedValue("/workspace"),
		loadInitialMessages: vi.fn().mockResolvedValue([{ role: "user", content: "hello" }]),
		buildStartSessionInput: vi.fn(() => ({ prompt: "start" })),
		resolveContextMentions: vi.fn(async (text: string) => `resolved: ${text}`),
		isClineProviderActive: vi.fn(() => false),
		emitClineAuthError: vi.fn(),
		resetMessageTranslator: vi.fn(),
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
	} as unknown as SdkFollowupCoordinatorOptions & {
		interactions: SdkFollowupCoordinatorOptions["interactions"] & {
			resolvePendingToolApproval: ReturnType<typeof vi.fn>
			resolvePendingAskQuestion: ReturnType<typeof vi.fn>
		}
		sessions: SdkFollowupCoordinatorOptions["sessions"] & {
			getActiveSession: ReturnType<typeof vi.fn>
			setRunning: ReturnType<typeof vi.fn>
			fireAndForgetSend: ReturnType<typeof vi.fn>
			startNewSession: ReturnType<typeof vi.fn>
		}
		messages: SdkFollowupCoordinatorOptions["messages"] & {
			appendAndEmit: ReturnType<typeof vi.fn>
			emitSessionEvents: ReturnType<typeof vi.fn>
		}
		taskHistory: SdkFollowupCoordinatorOptions["taskHistory"] & {
			findHistoryItem: ReturnType<typeof vi.fn>
			updateTaskHistory: ReturnType<typeof vi.fn>
		}
		sessionConfigBuilder: SdkFollowupCoordinatorOptions["sessionConfigBuilder"] & { build: ReturnType<typeof vi.fn> }
		getTask: ReturnType<typeof vi.fn>
		createTempSessionHost: ReturnType<typeof vi.fn>
		getWorkspaceRoot: ReturnType<typeof vi.fn>
		loadInitialMessages: ReturnType<typeof vi.fn>
		resolveContextMentions: ReturnType<typeof vi.fn>
		isClineProviderActive: ReturnType<typeof vi.fn>
		emitClineAuthError: ReturnType<typeof vi.fn>
		resetMessageTranslator: ReturnType<typeof vi.fn>
		postStateToWebview: ReturnType<typeof vi.fn>
	}

	return {
		coordinator: new SdkFollowupCoordinator(options),
		options,
		tempHost,
	}
}

interface MakeCoordinatorInput {
	activeSession: ReturnType<typeof makeActiveSession>
	task: ReturnType<typeof makeTask>
	historyItem: {
		id: string
		ts: number
		task: string
		tokensIn: number
		tokensOut: number
		totalCost: number
		cwdOnTaskInitialization?: string
	}
	mode: "act" | "plan"
}

function makeActiveSession(input: { isRunning?: boolean } = {}) {
	return {
		sessionId: "session-123",
		sessionManager: {
			send: vi.fn(),
		},
		isRunning: input.isRunning ?? false,
	}
}

function makeTask(taskId: string) {
	return {
		taskId,
		taskState: {},
	}
}
