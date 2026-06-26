import type { HistoryItem } from "@shared/HistoryItem"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { StateManager } from "@/core/storage/StateManager"
import { SdkTaskStartCoordinator, type SdkTaskStartCoordinatorOptions } from "./sdk-task-start-coordinator"

vi.mock("@/shared/services/Logger", () => ({
	Logger: {
		error: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
	},
}))

describe("SdkTaskStartCoordinator", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("initializes a new task, emits the task message, and sends the resolved prompt", async () => {
		const { coordinator, options, state } = makeCoordinator()

		const sessionId = await coordinator.initTask("hello @file", ["image.png"], ["a.ts"])

		expect(sessionId).toEqual(expect.any(String))
		expect(options.clearTask).toHaveBeenCalledOnce()
		expect(options.sessionConfigBuilder.build).toHaveBeenCalledWith({
			prompt: "hello @file",
			images: ["image.png"],
			files: ["a.ts"],
			historyItem: undefined,
			taskSettings: undefined,
			cwd: "/workspace",
			mode: "act",
		})
		expect(options.buildStartSessionInput).toHaveBeenCalledWith(
			expect.objectContaining({ providerId: "anthropic", modelId: "model", sessionId }),
			expect.objectContaining({
				prompt: "hello @file",
				images: ["image.png"],
				files: ["a.ts"],
				cwd: "/workspace",
				mode: "act",
			}),
		)
		expect(state.task?.taskId).toBe(sessionId)
		expect(options.taskHistory.updateTaskHistoryItem).toHaveBeenCalledWith(
			expect.objectContaining({ id: sessionId, task: "hello @file", modelId: "model" }),
		)
		expect(options.messages.appendAndEmit).toHaveBeenCalledWith(
			[expect.objectContaining({ type: "say", say: "task", text: "hello @file" })],
			{ type: "status", payload: { sessionId, status: "running" } },
		)
		expect(options.postStateToWebview).toHaveBeenCalledOnce()
		expect(options.messages.appendAndEmit.mock.invocationCallOrder[0]).toBeLessThan(
			options.sessions.startNewSession.mock.invocationCallOrder[0],
		)
		expect(options.resolveContextMentions).toHaveBeenCalledWith("hello @file")
		expect(options.sessions.fireAndForgetSend).toHaveBeenCalledWith(
			expect.objectContaining({ send: expect.any(Function) }),
			sessionId,
			"resolved: hello @file",
			["image.png"],
			["a.ts"],
		)
	})

	it("emits a Cline auth error instead of starting when the cline provider has no token", async () => {
		const { coordinator, options } = makeCoordinator({ config: { providerId: "cline", modelId: "model", apiKey: "" } })

		const sessionId = await coordinator.initTask("needs auth")

		expect(sessionId).toBeUndefined()
		expect(options.emitClineAuthError).toHaveBeenCalledWith("needs auth")
		expect(options.sessions.startNewSession).not.toHaveBeenCalled()
	})

	it("emits a Cline auth error instead of starting when ClinePass has no token", async () => {
		const { coordinator, options } = makeCoordinator({ config: { providerId: "cline-pass", modelId: "model", apiKey: "" } })

		const sessionId = await coordinator.initTask("needs clinepass auth")

		expect(sessionId).toBeUndefined()
		expect(options.emitClineAuthError).toHaveBeenCalledWith("needs clinepass auth")
		expect(options.sessions.startNewSession).not.toHaveBeenCalled()
	})

	it("emits a plain chat error when session start fails (e.g. provider misconfigured)", async () => {
		const { coordinator, options, state } = makeCoordinator()
		const error = new Error("No model configured for provider openai")
		options.sessions.startNewSession.mockRejectedValue(error)

		const sessionId = await coordinator.initTask("do something")

		expect(sessionId).toBeUndefined()
		expect(options.emitClineAuthError).not.toHaveBeenCalled()
		expect(options.captureProviderApiError).toHaveBeenCalledWith({
			sessionId: state.task?.taskId,
			error,
			providerId: "anthropic",
			modelId: "model",
			errorType: "task_init",
			failurePhase: "preflight",
		})
		expect(state.task?.taskId).toEqual(expect.any(String))
		expect(options.messages.appendAndEmit).toHaveBeenCalledWith(
			[
				expect.objectContaining({
					type: "say",
					say: "error",
					text: expect.stringContaining("No model configured for provider openai"),
				}),
			],
			{ type: "status", payload: { sessionId: state.task?.taskId, status: "error" } },
		)
		expect(options.postStateToWebview).toHaveBeenCalledOnce()
	})

	it.each([true, false])("forwards task useAutoCondense=%s into SDK session config inputs", async (useAutoCondense) => {
		const { coordinator, options } = makeCoordinator()
		const taskSettings = { useAutoCondense }

		await coordinator.initTask("hello", undefined, undefined, undefined, taskSettings)

		expect(options.sessionConfigBuilder.build).toHaveBeenCalledWith(
			expect.objectContaining({
				taskSettings,
			}),
		)
		expect(options.buildStartSessionInput).toHaveBeenCalledWith(
			expect.any(Object),
			expect.objectContaining({
				taskSettings,
			}),
		)
	})

	it("reinitializes an existing task with preserved initial messages", async () => {
		const historyItem: HistoryItem = {
			id: "task-1",
			task: "old task",
			ts: 1,
			tokensIn: 0,
			tokensOut: 0,
			totalCost: 0,
			cwdOnTaskInitialization: "/task-cwd",
		}
		const { coordinator, options, state, tempHost } = makeCoordinator({ historyItem })

		await coordinator.reinitExistingTaskFromId("task-1")

		expect(options.clearTask).toHaveBeenCalledOnce()
		expect(options.taskHistory.findHistoryItem).toHaveBeenCalledWith("task-1")
		expect(options.sessionConfigBuilder.build).toHaveBeenCalledWith({ cwd: "/task-cwd", mode: "act" })
		expect(options.createTempSessionHost).toHaveBeenCalledOnce()
		expect(options.loadInitialMessages).toHaveBeenCalledWith(tempHost, "task-1")
		expect(tempHost.dispose).toHaveBeenCalledWith("readMessages")
		expect(options.sessions.startNewSession).toHaveBeenCalledWith({
			config: expect.objectContaining({ providerId: "anthropic", modelId: "model" }),
			interactive: true,
			initialMessages: [{ role: "user", content: "hello" }],
			sessionMetadata: expect.objectContaining({
				title: "old task",
				modelId: "model",
			}),
		})
		expect(state.task?.taskId).toBe("session-123")
		expect(options.postStateToWebview).toHaveBeenCalledOnce()
	})

	it("emits Cline auth errors when reinitialization fails due auth", async () => {
		const { coordinator, options } = makeCoordinator()
		options.sessionConfigBuilder.build.mockRejectedValue(new Error("missing api key"))
		options.isClineProviderActive.mockReturnValue(true)

		await coordinator.reinitExistingTaskFromId("task-1")

		expect(options.emitClineAuthError).toHaveBeenCalledWith()
		expect(options.messages.emitSessionEvents).not.toHaveBeenCalled()
	})
})

function makeCoordinator(input: Partial<MakeCoordinatorInput> = {}) {
	const state: { task?: { taskId: string } } = {}
	const config = input.config ?? {
		providerId: "anthropic",
		modelId: "model",
		apiKey: "key",
	}
	const historyItem = input.historyItem ?? {
		id: "task-1",
		task: "old task",
		ts: 1,
		tokensIn: 0,
		tokensOut: 0,
		totalCost: 0,
	}
	const tempHost = {
		readMessages: vi.fn().mockResolvedValue([{ role: "user", content: "hello" }]),
		dispose: vi.fn().mockResolvedValue(undefined),
	}
	const sdkHost = {
		send: vi.fn(),
	}
	const options = {
		stateManager: {
			getGlobalSettingsKey: vi.fn(() => input.mode ?? "act"),
		} as unknown as StateManager,
		sessions: {
			startNewSession: vi.fn((startInput?: { config?: { sessionId?: string } }) => ({
				startResult: { sessionId: startInput?.config?.sessionId ?? "session-123" },
				sdkHost,
			})),
			fireAndForgetSend: vi.fn(),
		},
		messages: {
			appendAndEmit: vi.fn(),
			emitSessionEvents: vi.fn(),
		},
		taskHistory: {
			findHistoryItem: vi.fn(() => (input.hasHistoryItem === false ? undefined : historyItem)),
			updateTaskHistory: vi.fn().mockResolvedValue([]),
			updateTaskHistoryItem: vi.fn().mockResolvedValue(undefined),
		},
		sessionConfigBuilder: {
			build: vi.fn().mockResolvedValue(config),
		},
		buildStartSessionInput: vi.fn((startConfig, startInput) => ({
			config: startConfig,
			interactive: true,
			prompt: startInput.prompt,
		})),
		createHistoryItemFromSession: vi.fn((sessionId, task, modelId, cwd) => ({
			id: sessionId,
			task,
			ts: 1,
			tokensIn: 0,
			tokensOut: 0,
			totalCost: 0,
			modelId,
			cwdOnTaskInitialization: cwd,
		})),
		clearTask: vi.fn().mockResolvedValue(undefined),
		setTask: vi.fn((task) => {
			state.task = task as { taskId: string } | undefined
		}),
		onAskResponse: vi.fn().mockResolvedValue(undefined),
		onCancelTask: vi.fn().mockResolvedValue(undefined),
		getWorkspaceRoot: vi.fn().mockResolvedValue("/workspace"),
		createTempSessionHost: vi.fn().mockResolvedValue(tempHost),
		loadInitialMessages: vi.fn().mockResolvedValue([{ role: "user", content: "hello" }]),
		resolveContextMentions: vi.fn(async (text: string) => `resolved: ${text}`),
		isClineProviderActive: vi.fn(() => false),
		emitClineAuthError: vi.fn(),
		captureProviderApiError: vi.fn(),
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
	} as unknown as SdkTaskStartCoordinatorOptions & {
		sessions: SdkTaskStartCoordinatorOptions["sessions"] & {
			startNewSession: ReturnType<typeof vi.fn>
			fireAndForgetSend: ReturnType<typeof vi.fn>
		}
		messages: SdkTaskStartCoordinatorOptions["messages"] & {
			appendAndEmit: ReturnType<typeof vi.fn>
			emitSessionEvents: ReturnType<typeof vi.fn>
		}
		taskHistory: SdkTaskStartCoordinatorOptions["taskHistory"] & {
			findHistoryItem: ReturnType<typeof vi.fn>
			updateTaskHistory: ReturnType<typeof vi.fn>
			updateTaskHistoryItem: ReturnType<typeof vi.fn>
		}
		sessionConfigBuilder: SdkTaskStartCoordinatorOptions["sessionConfigBuilder"] & { build: ReturnType<typeof vi.fn> }
		buildStartSessionInput: ReturnType<typeof vi.fn>
		createHistoryItemFromSession: ReturnType<typeof vi.fn>
		clearTask: ReturnType<typeof vi.fn>
		createTempSessionHost: ReturnType<typeof vi.fn>
		loadInitialMessages: ReturnType<typeof vi.fn>
		resolveContextMentions: ReturnType<typeof vi.fn>
		isClineProviderActive: ReturnType<typeof vi.fn>
		emitClineAuthError: ReturnType<typeof vi.fn>
		captureProviderApiError: ReturnType<typeof vi.fn>
		postStateToWebview: ReturnType<typeof vi.fn>
	}

	return {
		coordinator: new SdkTaskStartCoordinator(options),
		options,
		state,
		tempHost,
	}
}

interface MakeCoordinatorInput {
	mode: "act" | "plan"
	config: {
		providerId: string
		modelId: string
		apiKey: string
	}
	historyItem: HistoryItem
	hasHistoryItem: boolean
}
