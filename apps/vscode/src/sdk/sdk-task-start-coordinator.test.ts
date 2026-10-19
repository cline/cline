import type { HistoryItem } from "@shared/HistoryItem"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { StateManager } from "@/core/storage/StateManager"
import { isDirectory } from "@/utils/fs"
import { PROVIDER_FAILURE_ERROR_TYPE, PROVIDER_FAILURE_PHASE } from "./provider-failure-telemetry"
import { SdkTaskStartCoordinator, type SdkTaskStartCoordinatorOptions } from "./sdk-task-start-coordinator"

vi.mock("@/shared/services/Logger", () => ({
	Logger: {
		error: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
	},
}))

vi.mock("@/utils/fs", () => ({
	isDirectory: vi.fn(),
}))

describe("SdkTaskStartCoordinator", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(isDirectory).mockResolvedValue(false)
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
		// Attachments must be on the authoritative task message so the webview's
		// optimistic pending copy (which carries them) gets confirmed and cleared.
		expect(options.messages.appendAndEmit).toHaveBeenCalledWith(
			[
				expect.objectContaining({
					type: "say",
					say: "task",
					text: "hello @file",
					images: ["image.png"],
					files: ["a.ts"],
				}),
			],
			{ type: "status", payload: { sessionId, status: "running" } },
		)
		expect(options.postStateToWebview).toHaveBeenCalledTimes(2)
		expect(options.messages.appendAndEmit.mock.invocationCallOrder[0]).toBeLessThan(
			options.sessions.startNewSession.mock.invocationCallOrder[0],
		)
		// The first state post carries the streaming TurnState to the webview (thinking
		// indicator) and must not wait for the potentially slow session startup.
		expect(options.postStateToWebview.mock.invocationCallOrder[0]).toBeLessThan(
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

	it("omits images/files from the task message when the task has no attachments", async () => {
		const { coordinator, options } = makeCoordinator()

		await coordinator.initTask("plain text task")

		const [emitted] = options.messages.appendAndEmit.mock.calls[0][0] as [Record<string, unknown>]
		expect(emitted).toMatchObject({ type: "say", say: "task", text: "plain text task" })
		expect(emitted).not.toHaveProperty("images")
		expect(emitted).not.toHaveProperty("files")
	})

	it("emits a Cline auth error instead of starting when the cline provider has no token", async () => {
		const { coordinator, options } = makeCoordinator({ config: { providerId: "cline", modelId: "model", apiKey: "" } })

		const sessionId = await coordinator.initTask("needs auth")

		expect(sessionId).toBeUndefined()
		expect(options.emitClineAuthError).toHaveBeenCalledWith("needs auth")
		expect(options.captureProviderApiError).not.toHaveBeenCalled()
		expect(options.sessions.startNewSession).not.toHaveBeenCalled()
	})

	it("emits a Cline auth error instead of starting when ClinePass has no token", async () => {
		const { coordinator, options } = makeCoordinator({ config: { providerId: "cline-pass", modelId: "model", apiKey: "" } })

		const sessionId = await coordinator.initTask("needs clinepass auth")

		expect(sessionId).toBeUndefined()
		expect(options.emitClineAuthError).toHaveBeenCalledWith("needs clinepass auth")
		expect(options.captureProviderApiError).not.toHaveBeenCalled()
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
			errorType: PROVIDER_FAILURE_ERROR_TYPE.TASK_INIT,
			failurePhase: PROVIDER_FAILURE_PHASE.PREFLIGHT,
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
		// One early post before session startup, one after the failure.
		expect(options.postStateToWebview).toHaveBeenCalledTimes(2)
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
		vi.mocked(isDirectory).mockResolvedValue(true)
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
		expect(isDirectory).toHaveBeenCalledWith("/task-cwd")
		expect(options.getWorkspaceRoot).not.toHaveBeenCalled()
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

	it("falls back to the workspace root when a stored task cwd is unavailable", async () => {
		const historyItem: HistoryItem = {
			id: "task-1",
			task: "old task",
			ts: 1,
			tokensIn: 0,
			tokensOut: 0,
			totalCost: 0,
			cwdOnTaskInitialization: "/missing-task-cwd",
		}
		const { coordinator, options } = makeCoordinator({ historyItem })

		await coordinator.reinitExistingTaskFromId("task-1")

		expect(isDirectory).toHaveBeenCalledWith("/missing-task-cwd")
		expect(options.getWorkspaceRoot).toHaveBeenCalledOnce()
		expect(options.sessionConfigBuilder.build).toHaveBeenCalledWith({ cwd: "/workspace", mode: "act" })
	})

	it("emits Cline auth errors when reinitialization fails due auth", async () => {
		const { coordinator, options } = makeCoordinator()
		options.sessionConfigBuilder.build.mockRejectedValue(new Error("missing api key"))
		options.isClineManagedProviderActive.mockReturnValue(true)

		await coordinator.reinitExistingTaskFromId("task-1")

		expect(options.emitClineAuthError).toHaveBeenCalledWith()
		expect(options.messages.emitSessionEvents).not.toHaveBeenCalled()
	})
})

it("persists durable history before clear can erase a prompted task (#13781)", async () => {
	const { coordinator, options, sdkHost, historyStore, durableHistoryIds } = makeCoordinator()

	const sessionId = await coordinator.initTask("ship the fix")
	expect(sessionId).toEqual(expect.any(String))
	expect(sdkHost.ensureSessionPersisted).toHaveBeenCalledWith(sessionId, { prompt: "ship the fix" })
	expect(sdkHost.ensureSessionPersisted.mock.invocationCallOrder[0]).toBeLessThan(
		options.taskHistory.updateTaskHistoryItem.mock.invocationCallOrder[0],
	)
	expect(durableHistoryIds.has(sessionId!)).toBe(true)
	expect(historyStore.get(sessionId!)?.task).toBe("ship the fix")

	// Immediate New Task / clear before first model token: durable row remains exactly once.
	await options.clearTask()
	expect([...historyStore.keys()]).toEqual([sessionId])
})

it("keeps exactly one history entry after immediate close of a prompted task", async () => {
	const { coordinator, options, historyStore, sdkHost } = makeCoordinator()
	const sessionId = await coordinator.initTask("close me next")
	expect(sdkHost.ensureSessionPersisted).toHaveBeenCalledOnce()
	// Simulate Close Task disposing the active session without waiting for send.
	await options.clearTask()
	expect(historyStore.size).toBe(1)
	expect(historyStore.get(sessionId!)?.id).toBe(sessionId)
})

it("still sends the first turn after early persistence (no normal-path regression)", async () => {
	const { coordinator, options, sdkHost } = makeCoordinator()
	const sessionId = await coordinator.initTask("normal path")
	expect(sdkHost.ensureSessionPersisted).toHaveBeenCalledOnce()
	expect(options.sessions.fireAndForgetSend).toHaveBeenCalledWith(
		sdkHost,
		sessionId,
		"resolved: normal path",
		undefined,
		undefined,
	)
})

it("does not create duplicate durable + synthetic history rows", async () => {
	const { coordinator, historyStore, sdkHost } = makeCoordinator()
	const sessionId = await coordinator.initTask("once only")
	// Second early-persist call would still be the same session id; store stays size 1.
	await sdkHost.ensureSessionPersisted(sessionId!, { prompt: "once only" })
	expect(historyStore.size).toBe(1)
	expect([...historyStore.keys()]).toEqual([sessionId])
})

it("does not materialize durable history for a truly empty task/session", async () => {
	const { coordinator, options, sdkHost, historyStore, durableHistoryIds } = makeCoordinator()
	const sessionId = await coordinator.initTask("   ")
	expect(sessionId).toEqual(expect.any(String))
	expect(sdkHost.ensureSessionPersisted).not.toHaveBeenCalled()
	expect(options.sessions.fireAndForgetSend).not.toHaveBeenCalled()
	// update may be attempted, but without durable id it does not land in History.
	expect(historyStore.size).toBe(0)
	expect(durableHistoryIds.size).toBe(0)
})

it("does not fabricate successful history when startup fails", async () => {
	const { coordinator, options, sdkHost, historyStore } = makeCoordinator()
	options.sessions.startNewSession.mockRejectedValue(new Error("session start failed"))
	const sessionId = await coordinator.initTask("do something")
	expect(sessionId).toBeUndefined()
	expect(sdkHost.ensureSessionPersisted).not.toHaveBeenCalled()
	expect(options.taskHistory.updateTaskHistoryItem).not.toHaveBeenCalled()
	expect(historyStore.size).toBe(0)
})

it("proves the durable row exists at the corrected lifecycle boundary before send", async () => {
	const { coordinator, options, sdkHost, durableHistoryIds } = makeCoordinator()
	const sessionId = await coordinator.initTask("boundary proof")
	expect(durableHistoryIds.has(sessionId!)).toBe(true)
	expect(sdkHost.ensureSessionPersisted.mock.invocationCallOrder[0]).toBeLessThan(
		options.sessions.fireAndForgetSend.mock.invocationCallOrder[0],
	)
	expect(options.taskHistory.updateTaskHistoryItem.mock.invocationCallOrder[0]).toBeLessThan(
		options.sessions.fireAndForgetSend.mock.invocationCallOrder[0],
	)
})

it("persists attachment-only tasks without waiting for model output", async () => {
	const { coordinator, sdkHost, historyStore } = makeCoordinator()
	const sessionId = await coordinator.initTask("", ["shot.png"], undefined)
	expect(sdkHost.ensureSessionPersisted).toHaveBeenCalledWith(sessionId, { prompt: "" })
	expect(historyStore.size).toBe(1)
})

it("does not fabricate history or send when ensureSessionPersisted throws after start (#13781)", async () => {
	const { coordinator, options, state, sdkHost, historyStore } = makeCoordinator()
	const persistError = new Error("materialize failed")
	sdkHost.ensureSessionPersisted.mockRejectedValue(persistError)

	const sessionId = await coordinator.initTask("persist then explode")

	expect(sessionId).toBeUndefined()
	expect(options.sessions.startNewSession).toHaveBeenCalledOnce()
	expect(sdkHost.ensureSessionPersisted).toHaveBeenCalledOnce()
	expect(options.sessions.fireAndForgetSend).not.toHaveBeenCalled()
	expect(options.taskHistory.updateTaskHistoryItem).not.toHaveBeenCalled()
	expect(historyStore.size).toBe(0)
	expect(options.captureProviderApiError).toHaveBeenCalledWith({
		sessionId: expect.any(String),
		error: persistError,
		providerId: "anthropic",
		modelId: "model",
		errorType: PROVIDER_FAILURE_ERROR_TYPE.TASK_INIT,
		failurePhase: PROVIDER_FAILURE_PHASE.PREFLIGHT,
	})
	expect(options.messages.appendAndEmit).toHaveBeenCalledWith(
		[
			expect.objectContaining({
				type: "say",
				say: "error",
				text: expect.stringContaining("materialize failed"),
			}),
		],
		expect.objectContaining({
			type: "status",
			payload: expect.objectContaining({ status: "error" }),
		}),
	)
	// Early streaming post + post-error post (handleInitError path).
	expect(options.postStateToWebview).toHaveBeenCalled()

	// CURRENT BEHAVIOR (#13781 evidence): clearTask runs once at init start only.
	// After startNewSession succeeded and ensureSessionPersisted threw, production
	// catch does NOT call clearTask again — so createAndSetTask's resident task
	// may remain on state. Document, do not "fix" with product cleanup here.
	expect(options.clearTask).toHaveBeenCalledOnce()
	expect(state.task).toBeDefined()
	expect(state.task?.taskId).toEqual(expect.any(String))
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
	const durableHistoryIds = new Set<string>()
	const sdkHost = {
		send: vi.fn(),
		ensureSessionPersisted: vi.fn(async (sessionId: string, _options?: { prompt?: string }) => {
			durableHistoryIds.add(sessionId)
			return true
		}),
	}
	const historyStore = new Map<string, HistoryItem>()
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
			updateTaskHistoryItem: vi.fn(async (item: HistoryItem) => {
				// Mirrors production: update is a no-op until a durable session row exists.
				if (!durableHistoryIds.has(item.id)) {
					return
				}
				historyStore.set(item.id, item)
			}),
			listDurableHistory: () => [...historyStore.values()],
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
		isClineManagedProviderActive: vi.fn(() => false),
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
		isClineManagedProviderActive: ReturnType<typeof vi.fn>
		emitClineAuthError: ReturnType<typeof vi.fn>
		captureProviderApiError: ReturnType<typeof vi.fn>
		postStateToWebview: ReturnType<typeof vi.fn>
	}

	return {
		coordinator: new SdkTaskStartCoordinator(options),
		options,
		state,
		tempHost,
		sdkHost,
		durableHistoryIds,
		historyStore,
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
