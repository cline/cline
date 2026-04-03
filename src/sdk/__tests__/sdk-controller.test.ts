import { describe, expect, it, beforeEach, vi } from "vitest"
import { SdkController, type SdkSession } from "../SdkController"
import type { AgentEvent } from "../message-translator"
import type { ExtensionState, ClineMessage } from "@shared/ExtensionMessage"
import type { HistoryItem } from "@shared/HistoryItem"

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
				apiConfiguration: { apiProvider: "anthropic" as const },
			})

			const state = ctrl.getState()
			expect(state.version).toBe("3.5.0")
			expect(state.mode).toBe("act")
			expect(state.apiConfiguration?.apiProvider).toBe("anthropic")
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
				apiConfiguration: { apiProvider: "anthropic" as const },
			})

			await ctrl.newTask("Build a web app", ["image.png"])

			expect(factory).toHaveBeenCalledWith({
				apiConfiguration: { apiProvider: "anthropic" },
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
			const history = Array.from({ length: 10 }, (_, i) =>
				makeHistoryItem({ ts: i + 1, task: `Task ${i}` }),
			)
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
			const history = [
				makeHistoryItem({ id: "a" }),
				makeHistoryItem({ id: "b" }),
			]
			const ctrl = new SdkController({ taskHistory: history })

			await ctrl.deleteTasksWithIds([])

			expect(ctrl.getTaskHistory()).toHaveLength(0)
		})
	})

	describe("configuration updates", () => {
		it("updateApiConfiguration updates state", async () => {
			const ctrl = new SdkController()

			await ctrl.updateApiConfiguration({
				apiProvider: "openrouter" as const,
				apiModelId: "some-model",
			})

			const state = ctrl.getState()
			expect(state.apiConfiguration?.apiProvider).toBe("openrouter")
			expect(state.apiConfiguration?.apiModelId).toBe("some-model")
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

			await ctrl.updateApiConfiguration({ apiProvider: "anthropic" as const })

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
				apiConfiguration: { apiProvider: "anthropic" as const },
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
})
