import type { ClineMessage, ExtensionState } from "@shared/ExtensionMessage"
import type { HistoryItem } from "@shared/HistoryItem"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { GrpcHandler, type GrpcHandlerDelegate } from "../grpc-handler"
import { buildExtensionState } from "../state-builder"

// ---------------------------------------------------------------------------
// Mock delegate
// ---------------------------------------------------------------------------

function createMockDelegate(overrides: Partial<GrpcHandlerDelegate> = {}): GrpcHandlerDelegate {
	const state = buildExtensionState({ version: "3.5.0" })
	return {
		getState: vi.fn(() => state),
		newTask: vi.fn(async () => {}),
		askResponse: vi.fn(async () => {}),
		clearTask: vi.fn(async () => {}),
		cancelTask: vi.fn(async () => {}),
		getTaskHistory: vi.fn(() => []),
		showTaskWithId: vi.fn(async () => {}),
		deleteTasksWithIds: vi.fn(async () => {}),
		updateApiConfiguration: vi.fn(async () => {}),
		togglePlanActMode: vi.fn(async () => {}),
		updateSettings: vi.fn(async () => {}),
		updateAutoApprovalSettings: vi.fn(async () => {}),
		...overrides,
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GrpcHandler", () => {
	let handler: GrpcHandler
	let delegate: GrpcHandlerDelegate

	beforeEach(() => {
		delegate = createMockDelegate()
		handler = new GrpcHandler(delegate)
	})

	// -----------------------------------------------------------------------
	// getLatestState
	// -----------------------------------------------------------------------

	describe("getLatestState", () => {
		it("returns valid state JSON", async () => {
			const response = await handler.handleRequest({ method: "getLatestState" })

			expect(response.error).toBeUndefined()
			expect(response.data).toBeDefined()

			const state = response.data as ExtensionState
			expect(state.version).toBe("3.5.0")
			expect(state.clineMessages).toBeInstanceOf(Array)
			expect(delegate.getState).toHaveBeenCalled()
		})
	})

	// -----------------------------------------------------------------------
	// subscribeToState
	// -----------------------------------------------------------------------

	describe("subscribeToState", () => {
		it("stores subscription and returns ID", async () => {
			const callback = vi.fn()
			const response = await handler.handleRequest({
				method: "subscribeToState",
				params: { callback },
			})

			expect(response.error).toBeUndefined()
			const data = response.data as { subscriptionId: string }
			expect(data.subscriptionId).toBeDefined()
			expect(handler.getStateSubscriptionCount()).toBe(1)
		})

		it("immediately pushes current state to subscriber", async () => {
			const callback = vi.fn()
			await handler.handleRequest({
				method: "subscribeToState",
				params: { callback },
			})

			expect(callback).toHaveBeenCalledTimes(1)
			const pushedState = callback.mock.calls[0][0] as ExtensionState
			expect(pushedState.version).toBe("3.5.0")
		})

		it("pushState sends to all subscribers", async () => {
			const cb1 = vi.fn()
			const cb2 = vi.fn()
			await handler.handleRequest({ method: "subscribeToState", params: { callback: cb1 } })
			await handler.handleRequest({ method: "subscribeToState", params: { callback: cb2 } })

			// Reset from initial push
			cb1.mockClear()
			cb2.mockClear()

			const state = buildExtensionState({ version: "4.0.0" })
			handler.pushState(state)

			expect(cb1).toHaveBeenCalledTimes(1)
			expect(cb2).toHaveBeenCalledTimes(1)
		})
	})

	// -----------------------------------------------------------------------
	// subscribeToPartialMessage
	// -----------------------------------------------------------------------

	describe("subscribeToPartialMessage", () => {
		it("stores subscription", async () => {
			const callback = vi.fn()
			const response = await handler.handleRequest({
				method: "subscribeToPartialMessage",
				params: { callback },
			})

			expect(response.error).toBeUndefined()
			expect(handler.getPartialMessageSubscriptionCount()).toBe(1)
		})

		it("pushPartialMessage sends to subscribers", async () => {
			const callback = vi.fn()
			await handler.handleRequest({
				method: "subscribeToPartialMessage",
				params: { callback },
			})

			const message: ClineMessage = {
				ts: Date.now(),
				type: "say",
				say: "text",
				text: "Hello",
				partial: true,
			}
			handler.pushPartialMessage(message)

			expect(callback).toHaveBeenCalledWith(message)
		})
	})

	// -----------------------------------------------------------------------
	// newTask
	// -----------------------------------------------------------------------

	describe("newTask", () => {
		it("creates session and calls delegate", async () => {
			const response = await handler.handleRequest({
				method: "newTask",
				params: { text: "Build a web app", images: [] },
			})

			expect(response.error).toBeUndefined()
			expect(delegate.newTask).toHaveBeenCalledWith("Build a web app", [])
		})

		it("handles missing text gracefully", async () => {
			const response = await handler.handleRequest({
				method: "newTask",
				params: {},
			})

			expect(response.error).toBeUndefined()
			expect(delegate.newTask).toHaveBeenCalledWith("", undefined)
		})
	})

	// -----------------------------------------------------------------------
	// askResponse
	// -----------------------------------------------------------------------

	describe("askResponse", () => {
		it("sends response to delegate", async () => {
			const response = await handler.handleRequest({
				method: "askResponse",
				params: { response: "yesButtonClicked", text: "Go ahead" },
			})

			expect(response.error).toBeUndefined()
			expect(delegate.askResponse).toHaveBeenCalledWith("yesButtonClicked", "Go ahead", undefined)
		})

		it("defaults to messageResponse", async () => {
			const response = await handler.handleRequest({
				method: "askResponse",
				params: { text: "Sure" },
			})

			expect(delegate.askResponse).toHaveBeenCalledWith("messageResponse", "Sure", undefined)
		})
	})

	// -----------------------------------------------------------------------
	// clearTask
	// -----------------------------------------------------------------------

	describe("clearTask", () => {
		it("resets state and calls delegate", async () => {
			const response = await handler.handleRequest({ method: "clearTask" })

			expect(response.error).toBeUndefined()
			expect(delegate.clearTask).toHaveBeenCalled()
		})
	})

	// -----------------------------------------------------------------------
	// cancelTask
	// -----------------------------------------------------------------------

	describe("cancelTask", () => {
		it("aborts task via delegate", async () => {
			const response = await handler.handleRequest({ method: "cancelTask" })

			expect(response.error).toBeUndefined()
			expect(delegate.cancelTask).toHaveBeenCalled()
		})
	})

	// -----------------------------------------------------------------------
	// getTaskHistory
	// -----------------------------------------------------------------------

	describe("getTaskHistory", () => {
		it("returns history from delegate", async () => {
			const mockHistory: HistoryItem[] = [
				{ id: "1", ts: 1000, task: "Task 1", tokensIn: 10, tokensOut: 5, totalCost: 0.01 },
			]
			const d = createMockDelegate({
				getTaskHistory: vi.fn(() => mockHistory),
			})
			const h = new GrpcHandler(d)

			const response = await h.handleRequest({
				method: "getTaskHistory",
				params: { offset: 0, limit: 50 },
			})

			expect(response.error).toBeUndefined()
			const data = response.data as { history: HistoryItem[] }
			expect(data.history).toHaveLength(1)
			expect(data.history[0].task).toBe("Task 1")
			expect(d.getTaskHistory).toHaveBeenCalledWith(0, 50)
		})
	})

	// -----------------------------------------------------------------------
	// showTaskWithId
	// -----------------------------------------------------------------------

	describe("showTaskWithId", () => {
		it("calls delegate with task ID", async () => {
			const response = await handler.handleRequest({
				method: "showTaskWithId",
				params: { value: "task_123" },
			})

			expect(response.error).toBeUndefined()
			expect(delegate.showTaskWithId).toHaveBeenCalledWith("task_123")
		})
	})

	// -----------------------------------------------------------------------
	// updateApiConfiguration
	// -----------------------------------------------------------------------

	describe("updateApiConfiguration", () => {
		it("updates provider and model via delegate", async () => {
			const response = await handler.handleRequest({
				method: "updateApiConfigurationProto",
				params: { apiProvider: "anthropic", apiModelId: "claude-sonnet-4-20250514" },
			})

			expect(response.error).toBeUndefined()
			expect(delegate.updateApiConfiguration).toHaveBeenCalledWith({
				apiProvider: "anthropic",
				apiModelId: "claude-sonnet-4-20250514",
			})
		})

		it("also handles plain updateApiConfiguration method", async () => {
			await handler.handleRequest({
				method: "updateApiConfiguration",
				params: { apiProvider: "openrouter" },
			})

			expect(delegate.updateApiConfiguration).toHaveBeenCalled()
		})
	})

	// -----------------------------------------------------------------------
	// togglePlanActMode
	// -----------------------------------------------------------------------

	describe("togglePlanActModeProto", () => {
		it("switches mode via delegate", async () => {
			const response = await handler.handleRequest({
				method: "togglePlanActModeProto",
				params: { mode: "plan" },
			})

			expect(response.error).toBeUndefined()
			expect(delegate.togglePlanActMode).toHaveBeenCalledWith("plan")
		})
	})

	// -----------------------------------------------------------------------
	// updateSettings
	// -----------------------------------------------------------------------

	describe("updateSettings", () => {
		it("passes settings to delegate", async () => {
			const response = await handler.handleRequest({
				method: "updateSettings",
				params: { shellIntegrationTimeout: 30000, maxConsecutiveMistakes: 5 },
			})

			expect(response.error).toBeUndefined()
			expect(delegate.updateSettings).toHaveBeenCalledWith({
				shellIntegrationTimeout: 30000,
				maxConsecutiveMistakes: 5,
			})
		})
	})

	// -----------------------------------------------------------------------
	// updateAutoApprovalSettings
	// -----------------------------------------------------------------------

	describe("updateAutoApprovalSettings", () => {
		it("passes auto-approval settings to delegate", async () => {
			const response = await handler.handleRequest({
				method: "updateAutoApprovalSettings",
				params: { enabled: true, maxRequests: 50 },
			})

			expect(response.error).toBeUndefined()
			expect(delegate.updateAutoApprovalSettings).toHaveBeenCalledWith({
				enabled: true,
				maxRequests: 50,
			})
		})
	})

	// -----------------------------------------------------------------------
	// initializeWebview
	// -----------------------------------------------------------------------

	describe("initializeWebview", () => {
		it("pushes initial state to subscribers", async () => {
			const callback = vi.fn()
			await handler.handleRequest({
				method: "subscribeToState",
				params: { callback },
			})
			callback.mockClear()

			const response = await handler.handleRequest({ method: "initializeWebview" })

			expect(response.error).toBeUndefined()
			expect(callback).toHaveBeenCalledTimes(1)
		})
	})

	// -----------------------------------------------------------------------
	// Unknown methods return empty (not error)
	// -----------------------------------------------------------------------

	describe("unknown methods", () => {
		it("returns empty response for totally unknown method", async () => {
			const response = await handler.handleRequest({
				method: "someNonExistentMethod",
			})

			expect(response.error).toBeUndefined()
			expect(response.data).toEqual({})
		})

		it("returns empty for non-critical stubbed methods", async () => {
			const stubbedMethods = [
				"getAvailableTerminalProfiles",
				"refreshOpenRouterModelsRpc",
				"getLatestMcpServers",
				"openFile",
				"checkpointRestore",
				"accountLoginClicked",
				"listWorktrees",
				"getTotalTasksSize",
			]

			for (const method of stubbedMethods) {
				const response = await handler.handleRequest({ method })
				expect(response.error).toBeUndefined()
				expect(response.data).toEqual({})
			}
		})
	})

	// -----------------------------------------------------------------------
	// Error handling
	// -----------------------------------------------------------------------

	describe("error handling", () => {
		it("returns error when delegate throws", async () => {
			const d = createMockDelegate({
				newTask: vi.fn(async () => {
					throw new Error("Session creation failed")
				}),
			})
			const h = new GrpcHandler(d)

			const response = await h.handleRequest({
				method: "newTask",
				params: { text: "hello" },
			})

			expect(response.error).toBe("Session creation failed")
		})

		it("handles non-Error throws gracefully", async () => {
			const d = createMockDelegate({
				cancelTask: vi.fn(async () => {
					throw "string error"
				}),
			})
			const h = new GrpcHandler(d)

			const response = await h.handleRequest({ method: "cancelTask" })

			expect(response.error).toBe("string error")
		})
	})

	// -----------------------------------------------------------------------
	// deleteTasksWithIds
	// -----------------------------------------------------------------------

	describe("deleteTasksWithIds", () => {
		it("passes IDs to delegate", async () => {
			const response = await handler.handleRequest({
				method: "deleteTasksWithIds",
				params: { value: ["id1", "id2"] },
			})

			expect(response.error).toBeUndefined()
			expect(delegate.deleteTasksWithIds).toHaveBeenCalledWith(["id1", "id2"])
		})
	})

	// -----------------------------------------------------------------------
	// Push notification resilience
	// -----------------------------------------------------------------------

	describe("push notification resilience", () => {
		it("pushState continues if one subscriber throws", async () => {
			const badCb = vi.fn(() => {
				throw new Error("boom")
			})
			const goodCb = vi.fn()

			await handler.handleRequest({ method: "subscribeToState", params: { callback: badCb } })
			await handler.handleRequest({ method: "subscribeToState", params: { callback: goodCb } })
			badCb.mockClear()
			goodCb.mockClear()

			const state = buildExtensionState()
			handler.pushState(state)

			expect(badCb).toHaveBeenCalledTimes(1)
			expect(goodCb).toHaveBeenCalledTimes(1)
		})
	})
})
