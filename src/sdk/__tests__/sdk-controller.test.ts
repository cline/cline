import type { ClineMessage, ExtensionState } from "@shared/ExtensionMessage"
import type { HistoryItem } from "@shared/HistoryItem"
import { describe, expect, it, vi } from "vitest"
import type { AgentEvent } from "../message-translator"
import { SdkController, type SdkSession } from "../SdkController"

// ---------------------------------------------------------------------------
// Mock session
// ---------------------------------------------------------------------------

function createMockSession(): SdkSession & { eventHandler?: (e: AgentEvent) => void } {
	const session: SdkSession & { eventHandler?: (e: AgentEvent) => void } = {
		sendPrompt: vi.fn(async () => {}),
		sendResponse: vi.fn(async () => {}),
		abort: vi.fn(async () => {}),
		onEvent: vi.fn((handler) => {
			session.eventHandler = handler
		}),
		isRunning: vi.fn(() => true),
	}
	return session
}

function makeHistoryItem(overrides: Partial<HistoryItem> = {}): HistoryItem {
	return {
		id: `task_${Date.now()}_${Math.random()}`,
		ts: Date.now(),
		task: "Test task",
		tokensIn: 100,
		tokensOut: 50,
		totalCost: 0.001,
		...overrides,
	}
}

function createMockDiskState() {
	return {
		saveApiConfiguration: vi.fn(),
		saveMode: vi.fn(),
		saveTaskHistory: vi.fn(),
		saveUiMessages: vi.fn(),
		deleteTaskDirectory: vi.fn(),
		readGlobalState: vi.fn(() => ({})),
		readSecrets: vi.fn(() => ({})),
		buildApiConfiguration: vi.fn(() => ({})),
		readTaskHistory: vi.fn(() => []),
		readUiMessages: vi.fn((): unknown[] => []),
		readAutoApprovalSettings: vi.fn(() => ({})),
		readClineAuthInfo: vi.fn(() => null),
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SdkController", () => {
	describe("initialization", () => {
		it("creates with default options", () => {
			const ctrl = new SdkController()
			expect(ctrl.getGrpcHandler()).toBeDefined()
			expect(ctrl.getTranslator()).toBeDefined()
		})

		it("provides valid initial state", () => {
			const ctrl = new SdkController({
				version: "3.5.0",
				mode: "act",
				apiConfiguration: { actModeApiProvider: "anthropic" as const },
			})

			const state = ctrl.getState()
			expect(state.version).toBe("3.5.0")
			expect(state.mode).toBe("act")
			expect(state.apiConfiguration?.actModeApiProvider).toBe("anthropic")
			expect(state.clineMessages).toEqual([])
			expect(state.taskHistory).toEqual([])
		})
	})

	describe("gRPC handler integration", () => {
		it("getLatestState returns same as getState()", async () => {
			const ctrl = new SdkController({ version: "3.5.0" })
			const handler = ctrl.getGrpcHandler()

			const response = await handler.handleRequest({ method: "getLatestState" })
			const state = response.data as ExtensionState

			expect(state.version).toBe("3.5.0")
			expect(state.mode).toBe("act")
		})

		it("subscribeToState receives initial state", async () => {
			const ctrl = new SdkController({ version: "3.5.0" })
			const handler = ctrl.getGrpcHandler()
			const callback = vi.fn()

			await handler.handleRequest({
				method: "subscribeToState",
				params: { callback },
			})

			expect(callback).toHaveBeenCalledTimes(1)
			const state = callback.mock.calls[0][0] as ExtensionState
			expect(state.version).toBe("3.5.0")
		})
	})

	describe("newTask (without session factory)", () => {
		it("creates task item and pushes state", async () => {
			const ctrl = new SdkController({ version: "3.5.0" })
			const handler = ctrl.getGrpcHandler()
			const callback = vi.fn()

			await handler.handleRequest({
				method: "subscribeToState",
				params: { callback },
			})
			callback.mockClear()

			await ctrl.newTask("Build a web app")

			// Should have pushed state
			expect(callback).toHaveBeenCalled()
			const state = callback.mock.lastCall![0] as ExtensionState
			expect(state.currentTaskItem).toBeDefined()
			expect(state.currentTaskItem!.task).toBe("Build a web app")
			expect(state.clineMessages.length).toBeGreaterThan(0)
			expect(state.clineMessages[0].say).toBe("task")
		})
	})

	describe("newTask (with session factory)", () => {
		it("creates session and sends prompt", async () => {
			const mockSession = createMockSession()
			const factory = vi.fn(async () => mockSession)

			const ctrl = new SdkController({
				version: "3.5.0",
				sessionFactory: factory,
				apiConfiguration: { actModeApiProvider: "anthropic" as const },
			})

			await ctrl.newTask("Build a web app", ["image.png"])

			expect(factory).toHaveBeenCalledWith({
				apiConfiguration: { actModeApiProvider: "anthropic" },
				mode: "act",
				cwd: expect.any(String),
			})
			expect(mockSession.sendPrompt).toHaveBeenCalledWith("Build a web app", ["image.png"])
			expect(mockSession.onEvent).toHaveBeenCalled()
		})
	})

	describe("session event processing", () => {
		it("translates SDK events into ClineMessages and pushes updates", async () => {
			const mockSession = createMockSession()
			const factory = vi.fn(async () => mockSession)

			const ctrl = new SdkController({
				version: "3.5.0",
				sessionFactory: factory,
			})

			const stateCallback = vi.fn()
			const partialCallback = vi.fn()
			const handler = ctrl.getGrpcHandler()
			await handler.handleRequest({ method: "subscribeToState", params: { callback: stateCallback } })
			await handler.handleRequest({ method: "subscribeToPartialMessage", params: { callback: partialCallback } })
			stateCallback.mockClear()
			partialCallback.mockClear()

			await ctrl.newTask("Hello")
			stateCallback.mockClear()
			partialCallback.mockClear()

			// Simulate SDK session emitting events using actual SDK AgentEvent types
			mockSession.eventHandler!({
				type: "content_start",
				contentType: "text",
				text: "I will help you",
			} as AgentEvent)

			mockSession.eventHandler!({
				type: "content_end",
				contentType: "text",
				text: "I will help you",
			} as AgentEvent)

			// Should have pushed state and partial message
			expect(stateCallback).toHaveBeenCalled()
			expect(partialCallback).toHaveBeenCalled()

			// Messages should include the translated text
			const state = ctrl.getState()
			const textMessages = state.clineMessages.filter((m) => m.say === "text")
			expect(textMessages.length).toBeGreaterThan(0)
		})
	})

	describe("askResponse", () => {
		it("adds user feedback message and sends to session", async () => {
			const mockSession = createMockSession()
			const factory = vi.fn(async () => mockSession)

			const ctrl = new SdkController({ sessionFactory: factory })
			await ctrl.newTask("Hello")

			await ctrl.askResponse("messageResponse", "Sure, go ahead")

			expect(mockSession.sendResponse).toHaveBeenCalledWith("Sure, go ahead")
			const state = ctrl.getState()
			const feedback = state.clineMessages.filter((m) => m.say === "user_feedback")
			expect(feedback).toHaveLength(1)
			expect(feedback[0].text).toBe("Sure, go ahead")
		})
	})

	describe("clearTask", () => {
		it("aborts session and resets state", async () => {
			const mockSession = createMockSession()
			const factory = vi.fn(async () => mockSession)

			const ctrl = new SdkController({ sessionFactory: factory })
			await ctrl.newTask("Hello")

			await ctrl.clearTask()

			expect(mockSession.abort).toHaveBeenCalled()
			const state = ctrl.getState()
			expect(state.currentTaskItem).toBeUndefined()
			expect(state.clineMessages).toEqual([])
		})

		it("persists task to history before clearing", async () => {
			const mockSession = createMockSession()
			const factory = vi.fn(async () => mockSession)

			const ctrl = new SdkController({ sessionFactory: factory })
			await ctrl.newTask("Build a feature")

			// Before clearing, history should be empty (task is in-progress)
			expect(ctrl.getTaskHistory()).toHaveLength(0)

			await ctrl.clearTask()

			// After clearing, the task should be in history
			expect(ctrl.getTaskHistory()).toHaveLength(1)
			expect(ctrl.getTaskHistory()[0].task).toBe("Build a feature")
		})

		it("persists task to disk via diskState", async () => {
			const mockDiskState = createMockDiskState()
			const mockSession = createMockSession()
			const factory = vi.fn(async () => mockSession)

			const ctrl = new SdkController({
				sessionFactory: factory,
				diskState: mockDiskState as any,
			})
			await ctrl.newTask("Save me to disk")
			await ctrl.clearTask()

			expect(mockDiskState.saveTaskHistory).toHaveBeenCalled()
			expect(mockDiskState.saveUiMessages).toHaveBeenCalled()
			const savedHistory = mockDiskState.saveTaskHistory.mock.calls[0][0]
			expect(savedHistory).toHaveLength(1)
			expect(savedHistory[0].task).toBe("Save me to disk")
		})
	})

	describe("cancelTask", () => {
		it("aborts session", async () => {
			const mockSession = createMockSession()
			const factory = vi.fn(async () => mockSession)

			const ctrl = new SdkController({ sessionFactory: factory })
			await ctrl.newTask("Hello")

			await ctrl.cancelTask()

			expect(mockSession.abort).toHaveBeenCalled()
		})
	})

	describe("task history management", () => {
		it("returns task history with offset/limit", () => {
			const history = Array.from({ length: 10 }, (_, i) => makeHistoryItem({ ts: i + 1, task: `Task ${i}` }))
			const ctrl = new SdkController({ taskHistory: history })

			expect(ctrl.getTaskHistory()).toHaveLength(10)
			expect(ctrl.getTaskHistory(0, 3)).toHaveLength(3)
			expect(ctrl.getTaskHistory(5, 3)).toHaveLength(3)
			expect(ctrl.getTaskHistory(8, 5)).toHaveLength(2) // only 2 left
		})

		it("deleteTasksWithIds removes specific tasks", async () => {
			const history = [
				makeHistoryItem({ id: "a", task: "Task A" }),
				makeHistoryItem({ id: "b", task: "Task B" }),
				makeHistoryItem({ id: "c", task: "Task C" }),
			]
			const ctrl = new SdkController({ taskHistory: history })

			await ctrl.deleteTasksWithIds(["a", "c"])

			expect(ctrl.getTaskHistory()).toHaveLength(1)
			expect(ctrl.getTaskHistory()[0].id).toBe("b")
		})

		it("deleteTasksWithIds([]) clears all history", async () => {
			const history = [makeHistoryItem({ id: "a" }), makeHistoryItem({ id: "b" })]
			const ctrl = new SdkController({ taskHistory: history })

			await ctrl.deleteTasksWithIds([])

			expect(ctrl.getTaskHistory()).toHaveLength(0)
		})
	})

	describe("configuration updates", () => {
		it("updateApiConfiguration updates state", async () => {
			const ctrl = new SdkController()

			await ctrl.updateApiConfiguration({
				actModeApiProvider: "openrouter" as const,
				actModeApiModelId: "some-model",
			})

			const state = ctrl.getState()
			expect(state.apiConfiguration?.actModeApiProvider).toBe("openrouter")
			expect(state.apiConfiguration?.actModeApiModelId).toBe("some-model")
		})

		it("togglePlanActMode updates mode", async () => {
			const ctrl = new SdkController({ mode: "act" })

			await ctrl.togglePlanActMode("plan")

			expect(ctrl.getState().mode).toBe("plan")
		})

		it("configuration updates push state to subscribers", async () => {
			const ctrl = new SdkController()
			const callback = vi.fn()
			const handler = ctrl.getGrpcHandler()
			await handler.handleRequest({ method: "subscribeToState", params: { callback } })
			callback.mockClear()

			await ctrl.updateApiConfiguration({ actModeApiProvider: "anthropic" as const })

			expect(callback).toHaveBeenCalled()
		})

		it("updateApiConfigurationProto unwraps nested apiConfiguration and converts proto enum providers", async () => {
			const ctrl = new SdkController()
			const handler = ctrl.getGrpcHandler()

			// Simulate what the webview sends: proto-JSON-encoded message with
			// nested apiConfiguration and proto enum string names for providers
			await handler.handleRequest({
				method: "updateApiConfigurationProto",
				params: {
					apiConfiguration: {
						actModeApiProvider: "OLLAMA",
						planModeApiProvider: "OLLAMA",
						actModeOllamaModelId: "phi4-mini:latest",
						planModeOllamaModelId: "phi4-mini:latest",
						ollamaBaseUrl: "http://localhost:11434",
					},
				},
			})

			const state = ctrl.getState()
			// Provider should be converted from proto enum "OLLAMA" to app string "ollama"
			expect(state.apiConfiguration?.actModeApiProvider).toBe("ollama")
			expect(state.apiConfiguration?.planModeApiProvider).toBe("ollama")
			expect(state.apiConfiguration?.actModeOllamaModelId).toBe("phi4-mini:latest")
			expect(state.apiConfiguration?.ollamaBaseUrl).toBe("http://localhost:11434")
		})

		it("updateApiConfigurationProto handles numeric enum values (VSCode messageEncoding=none)", async () => {
			const ctrl = new SdkController()
			const handler = ctrl.getGrpcHandler()

			// VSCode passes proto objects as-is (messageEncoding: "none"),
			// so enum values arrive as numbers, not strings.
			// CLINE = 16, OLLAMA = 5 in the proto enum
			await handler.handleRequest({
				method: "updateApiConfigurationProto",
				params: {
					apiConfiguration: {
						actModeApiProvider: 16, // CLINE
						planModeApiProvider: 16,
						actModeClineModelId: "claude-sonnet-4-5-20250929",
					},
				},
			})

			const state = ctrl.getState()
			expect(state.apiConfiguration?.actModeApiProvider).toBe("cline")
			expect(state.apiConfiguration?.planModeApiProvider).toBe("cline")
			expect(state.apiConfiguration?.actModeClineModelId).toBe("claude-sonnet-4-5-20250929")
		})

		it("updateApiConfigurationProto handles numeric enum for Ollama (5)", async () => {
			const ctrl = new SdkController()
			const handler = ctrl.getGrpcHandler()

			await handler.handleRequest({
				method: "updateApiConfigurationProto",
				params: {
					apiConfiguration: {
						actModeApiProvider: 5, // OLLAMA
						planModeApiProvider: 5,
						actModeOllamaModelId: "phi4-mini:latest",
						ollamaBaseUrl: "http://localhost:11434",
					},
				},
			})

			const state = ctrl.getState()
			expect(state.apiConfiguration?.actModeApiProvider).toBe("ollama")
			expect(state.apiConfiguration?.planModeApiProvider).toBe("ollama")
		})

		it("updateApiConfigurationProto handles already-lowercase provider strings", async () => {
			const ctrl = new SdkController()
			const handler = ctrl.getGrpcHandler()

			// If the provider is already in app format (shouldn't happen normally, but be safe)
			await handler.handleRequest({
				method: "updateApiConfigurationProto",
				params: {
					apiConfiguration: {
						actModeApiProvider: "cline",
						planModeApiProvider: "cline",
					},
				},
			})

			const state = ctrl.getState()
			expect(state.apiConfiguration?.actModeApiProvider).toBe("cline")
			expect(state.apiConfiguration?.planModeApiProvider).toBe("cline")
		})

		it("updateApiConfigurationProto handles switching from one provider to another", async () => {
			const ctrl = new SdkController({
				apiConfiguration: {
					actModeApiProvider: "ollama",
					planModeApiProvider: "ollama",
					actModeOllamaModelId: "phi4-mini:latest",
				},
			})
			const handler = ctrl.getGrpcHandler()

			// Switch to Cline provider (webview sends numeric proto format)
			await handler.handleRequest({
				method: "updateApiConfigurationProto",
				params: {
					apiConfiguration: {
						actModeApiProvider: 16, // CLINE
						planModeApiProvider: 16,
						actModeClineModelId: "claude-sonnet-4-5-20250929",
					},
				},
			})

			const state = ctrl.getState()
			expect(state.apiConfiguration?.actModeApiProvider).toBe("cline")
			expect(state.apiConfiguration?.planModeApiProvider).toBe("cline")
			// Old Ollama model ID should still be preserved (merge behavior)
			expect(state.apiConfiguration?.actModeOllamaModelId).toBe("phi4-mini:latest")
			// New Cline model ID should be set
			expect(state.apiConfiguration?.actModeClineModelId).toBe("claude-sonnet-4-5-20250929")
		})
	})

	describe("end-to-end flow", () => {
		it("full conversation cycle: new task → events → ask → clear", async () => {
			const mockSession = createMockSession()
			const factory = vi.fn(async () => mockSession)

			const ctrl = new SdkController({
				version: "3.5.0",
				sessionFactory: factory,
				apiConfiguration: { actModeApiProvider: "anthropic" as const },
			})

			// Subscribe to updates
			const states: ExtensionState[] = []
			const handler = ctrl.getGrpcHandler()
			await handler.handleRequest({
				method: "subscribeToState",
				params: {
					callback: (s: unknown) => states.push(s as ExtensionState),
				},
			})

			// 1. New task
			await ctrl.newTask("Write tests")
			expect(states.length).toBeGreaterThan(1) // initial + task creation

			// 2. Simulate agent iteration start
			mockSession.eventHandler!({
				type: "iteration_start",
				iteration: 1,
			} as AgentEvent)

			// 3. Simulate agent sending text content
			mockSession.eventHandler!({
				type: "content_start",
				contentType: "text",
				text: "I'll write tests for you.",
			} as AgentEvent)

			mockSession.eventHandler!({
				type: "content_end",
				contentType: "text",
				text: "I'll write tests for you.",
			} as AgentEvent)

			// 4. Simulate usage event
			mockSession.eventHandler!({
				type: "usage",
				inputTokens: 100,
				outputTokens: 50,
				totalInputTokens: 100,
				totalOutputTokens: 50,
				cost: 0.001,
				totalCost: 0.001,
			} as AgentEvent)

			// 5. Verify messages accumulated (task + api_req_started + text at minimum)
			const state = ctrl.getState()
			expect(state.clineMessages.length).toBeGreaterThanOrEqual(1) // at least the task message
			expect(state.currentTaskItem).toBeDefined()

			// 5. User responds
			await ctrl.askResponse("messageResponse", "Looks good!")

			// 6. Clear task
			await ctrl.clearTask()
			const finalState = ctrl.getState()
			expect(finalState.clineMessages).toEqual([])
			expect(finalState.currentTaskItem).toBeUndefined()
		})
	})

	describe("task persistence on done event", () => {
		it("persists task to history when done event fires", async () => {
			const mockDiskState = createMockDiskState()
			const mockSession = createMockSession()
			const factory = vi.fn(async () => mockSession)

			const ctrl = new SdkController({
				sessionFactory: factory,
				diskState: mockDiskState as any,
			})

			await ctrl.newTask("Hello world")

			// Simulate done event
			mockSession.eventHandler!({
				type: "done",
				reason: "completed",
				text: "Done!",
				iterations: 1,
				usage: {
					inputTokens: 200,
					outputTokens: 100,
					totalCost: 0.005,
					cacheReadTokens: 10,
					cacheWriteTokens: 20,
				},
			} as AgentEvent)

			// Task should now be in history
			expect(ctrl.getTaskHistory()).toHaveLength(1)
			const saved = ctrl.getTaskHistory()[0]
			expect(saved.task).toBe("Hello world")
			expect(saved.tokensIn).toBe(200)
			expect(saved.tokensOut).toBe(100)
			expect(saved.totalCost).toBe(0.005)
			expect(saved.cacheReads).toBe(10)
			expect(saved.cacheWrites).toBe(20)

			// Should have saved to disk
			expect(mockDiskState.saveTaskHistory).toHaveBeenCalled()
			expect(mockDiskState.saveUiMessages).toHaveBeenCalled()
		})

		it("updates currentTaskItem with usage events", async () => {
			const mockSession = createMockSession()
			const factory = vi.fn(async () => mockSession)

			const ctrl = new SdkController({ sessionFactory: factory })
			await ctrl.newTask("Track usage")

			// Simulate usage event
			mockSession.eventHandler!({
				type: "usage",
				inputTokens: 150,
				outputTokens: 75,
				totalInputTokens: 150,
				totalOutputTokens: 75,
				totalCost: 0.003,
				cacheWriteTokens: 30,
				cacheReadTokens: 5,
			} as AgentEvent)

			const state = ctrl.getState()
			expect(state.currentTaskItem?.tokensIn).toBe(150)
			expect(state.currentTaskItem?.tokensOut).toBe(75)
			expect(state.currentTaskItem?.totalCost).toBe(0.003)
			expect(state.currentTaskItem?.cacheWrites).toBe(30)
			expect(state.currentTaskItem?.cacheReads).toBe(5)
		})

		it("does not duplicate task in history on clearTask after done", async () => {
			const mockSession = createMockSession()
			const factory = vi.fn(async () => mockSession)

			const ctrl = new SdkController({ sessionFactory: factory })
			await ctrl.newTask("No dupes")

			// Done event persists the task
			mockSession.eventHandler!({
				type: "done",
				reason: "completed",
				text: "Done!",
				iterations: 1,
			} as AgentEvent)

			expect(ctrl.getTaskHistory()).toHaveLength(1)

			// clearTask also persists — should update, not duplicate
			await ctrl.clearTask()

			expect(ctrl.getTaskHistory()).toHaveLength(1)
			expect(ctrl.getTaskHistory()[0].task).toBe("No dupes")
		})

		it("persists task on cancelTask", async () => {
			const mockDiskState = createMockDiskState()
			const mockSession = createMockSession()
			const factory = vi.fn(async () => mockSession)

			const ctrl = new SdkController({
				sessionFactory: factory,
				diskState: mockDiskState as any,
			})
			await ctrl.newTask("Cancel me")
			await ctrl.cancelTask()

			expect(ctrl.getTaskHistory()).toHaveLength(1)
			expect(ctrl.getTaskHistory()[0].task).toBe("Cancel me")
			expect(mockDiskState.saveTaskHistory).toHaveBeenCalled()
		})
	})

	describe("task resumption (showTaskWithId)", () => {
		it("restores task and messages from history", async () => {
			const savedMessages: ClineMessage[] = [
				{ ts: 1000, type: "say", say: "task", text: "Build it" },
				{ ts: 1001, type: "say", say: "text", text: "I'll help you build it." },
			]

			const mockDiskState = createMockDiskState()
			mockDiskState.readUiMessages.mockReturnValue(savedMessages)

			const history = [makeHistoryItem({ id: "task_resume_1", task: "Build it", tokensIn: 500, tokensOut: 200 })]

			const ctrl = new SdkController({
				taskHistory: history,
				diskState: mockDiskState as any,
			})

			await ctrl.showTaskWithId("task_resume_1")

			const state = ctrl.getState()
			expect(state.currentTaskItem).toBeDefined()
			expect(state.currentTaskItem!.id).toBe("task_resume_1")
			expect(state.currentTaskItem!.task).toBe("Build it")
			expect(state.clineMessages).toHaveLength(2)
			expect(state.clineMessages[0].say).toBe("task")
			expect(state.clineMessages[1].say).toBe("text")
		})

		it("does nothing for unknown task ID", async () => {
			const ctrl = new SdkController({
				taskHistory: [makeHistoryItem({ id: "known" })],
			})

			await ctrl.showTaskWithId("unknown_id")

			const state = ctrl.getState()
			expect(state.currentTaskItem).toBeUndefined()
			expect(state.clineMessages).toEqual([])
		})

		it("handles missing messages gracefully", async () => {
			const mockDiskState = createMockDiskState()
			mockDiskState.readUiMessages.mockReturnValue([])

			const history = [makeHistoryItem({ id: "task_no_msgs", task: "Old task" })]

			const ctrl = new SdkController({
				taskHistory: history,
				diskState: mockDiskState as any,
			})

			await ctrl.showTaskWithId("task_no_msgs")

			const state = ctrl.getState()
			expect(state.currentTaskItem).toBeDefined()
			expect(state.currentTaskItem!.task).toBe("Old task")
			expect(state.clineMessages).toEqual([])
		})
	})

	describe("deleteTasksWithIds disk persistence", () => {
		it("deletes task directories from disk", async () => {
			const mockDiskState = createMockDiskState()
			const history = [makeHistoryItem({ id: "del_a" }), makeHistoryItem({ id: "del_b" }), makeHistoryItem({ id: "del_c" })]

			const ctrl = new SdkController({
				taskHistory: history,
				diskState: mockDiskState as any,
			})

			await ctrl.deleteTasksWithIds(["del_a", "del_c"])

			expect(mockDiskState.deleteTaskDirectory).toHaveBeenCalledWith("del_a")
			expect(mockDiskState.deleteTaskDirectory).toHaveBeenCalledWith("del_c")
			expect(mockDiskState.deleteTaskDirectory).not.toHaveBeenCalledWith("del_b")
			expect(mockDiskState.saveTaskHistory).toHaveBeenCalled()
		})

		it("deletes all task directories when ids is empty", async () => {
			const mockDiskState = createMockDiskState()
			const history = [makeHistoryItem({ id: "all_a" }), makeHistoryItem({ id: "all_b" })]

			const ctrl = new SdkController({
				taskHistory: history,
				diskState: mockDiskState as any,
			})

			await ctrl.deleteTasksWithIds([])

			expect(mockDiskState.deleteTaskDirectory).toHaveBeenCalledWith("all_a")
			expect(mockDiskState.deleteTaskDirectory).toHaveBeenCalledWith("all_b")
			expect(ctrl.getTaskHistory()).toHaveLength(0)
		})
	})

	describe("settings persistence", () => {
		it("updateApiConfiguration calls diskState.saveApiConfiguration", async () => {
			const mockDiskState = createMockDiskState()
			const ctrl = new SdkController({ diskState: mockDiskState as any })
			await ctrl.updateApiConfiguration({ actModeApiProvider: "ollama" } as any)

			expect(mockDiskState.saveApiConfiguration).toHaveBeenCalledWith({ actModeApiProvider: "ollama" })
		})

		it("togglePlanActMode calls diskState.saveMode", async () => {
			const mockDiskState = createMockDiskState()
			const ctrl = new SdkController({ diskState: mockDiskState as any })
			await ctrl.togglePlanActMode("plan")

			expect(mockDiskState.saveMode).toHaveBeenCalledWith("plan")
		})

		it("does not throw when diskState is not provided", async () => {
			const ctrl = new SdkController()
			await expect(ctrl.updateApiConfiguration({ actModeApiProvider: "ollama" } as any)).resolves.not.toThrow()
			await expect(ctrl.togglePlanActMode("plan")).resolves.not.toThrow()
		})

		it("updateSettings persists to disk via diskState", async () => {
			const mockDiskState = createMockDiskState()
			const ctrl = new SdkController({ diskState: mockDiskState as any })

			await ctrl.updateSettings({ customInstructions: "Be concise" })

			expect(mockDiskState.saveApiConfiguration).toHaveBeenCalledWith(
				expect.objectContaining({ customInstructions: "Be concise" }),
			)
		})

		it("updateSettings does not throw without diskState", async () => {
			const ctrl = new SdkController()
			await expect(ctrl.updateSettings({ customInstructions: "Be concise" })).resolves.not.toThrow()
		})
	})
})
