import { GlobalState, ClineMessage } from "@roo-code/types"

import { AutoApprovalHandler } from "../AutoApprovalHandler"

// Mock getApiMetrics
vi.mock("../../../shared/getApiMetrics", () => ({
	getApiMetrics: vi.fn(),
}))

import { getApiMetrics } from "../../../shared/getApiMetrics"

describe("AutoApprovalHandler", () => {
	let handler: AutoApprovalHandler
	let mockAskForApproval: any
	let mockState: GlobalState
	const mockGetApiMetrics = getApiMetrics as any

	beforeEach(() => {
		handler = new AutoApprovalHandler()
		mockAskForApproval = vi.fn()
		mockState = {} as GlobalState
		vi.clearAllMocks()

		// Default mock for getApiMetrics
		mockGetApiMetrics.mockReturnValue({ totalCost: 0 })
	})

	describe("checkAutoApprovalLimits", () => {
		it("should proceed when no limits are set", async () => {
			const messages: ClineMessage[] = []
			const result = await handler.checkAutoApprovalLimits(mockState, messages, mockAskForApproval)

			expect(result.shouldProceed).toBe(true)
			expect(result.requiresApproval).toBe(false)
			expect(mockAskForApproval).not.toHaveBeenCalled()
		})

		it("should check request limit before cost limit", async () => {
			mockState.allowedMaxRequests = 1
			mockState.allowedMaxCost = 10
			const messages: ClineMessage[] = []

			// First call should be under limit (count = 1)
			const result1 = await handler.checkAutoApprovalLimits(mockState, messages, mockAskForApproval)
			expect(result1.shouldProceed).toBe(true)
			expect(result1.requiresApproval).toBe(false)

			// Add a message to simulate first request completed
			messages.push({ type: "say", say: "api_req_started", text: "{}", ts: 1000 })

			// Second call should trigger request limit (1 message + current = 2 > 1)
			mockAskForApproval.mockResolvedValue({ response: "yesButtonClicked" })
			const result2 = await handler.checkAutoApprovalLimits(mockState, messages, mockAskForApproval)

			expect(mockAskForApproval).toHaveBeenCalledWith(
				"auto_approval_max_req_reached",
				JSON.stringify({ count: 1, type: "requests" }),
			)
			expect(result2.shouldProceed).toBe(true)
			expect(result2.requiresApproval).toBe(true)
			expect(result2.approvalType).toBe("requests")
		})
	})

	describe("request limit handling", () => {
		beforeEach(() => {
			mockState.allowedMaxRequests = 3
		})

		it("should calculate request count from messages", async () => {
			const messages: ClineMessage[] = []

			// First check - no messages yet, count should be 1 (for current request)
			await handler.checkAutoApprovalLimits(mockState, messages, mockAskForApproval)
			let state = handler.getApprovalState()
			expect(state.requestCount).toBe(1)

			// Add API request messages
			messages.push({ type: "say", say: "api_req_started", text: "{}", ts: 1000 })
			await handler.checkAutoApprovalLimits(mockState, messages, mockAskForApproval)
			state = handler.getApprovalState()
			expect(state.requestCount).toBe(2) // 1 message + current request

			messages.push({ type: "say", say: "api_req_started", text: "{}", ts: 2000 })
			await handler.checkAutoApprovalLimits(mockState, messages, mockAskForApproval)
			state = handler.getApprovalState()
			expect(state.requestCount).toBe(3) // 2 messages + current request
		})

		it("should ask for approval when limit is exceeded", async () => {
			const messages: ClineMessage[] = []

			// Add 3 API request messages (to simulate 3 requests made)
			for (let i = 0; i < 3; i++) {
				messages.push({ type: "say", say: "api_req_started", text: "{}", ts: 1000 + i })
			}

			// Next check should trigger approval (3 messages + current = 4 > 3)
			mockAskForApproval.mockResolvedValue({ response: "yesButtonClicked" })
			const result = await handler.checkAutoApprovalLimits(mockState, messages, mockAskForApproval)

			expect(mockAskForApproval).toHaveBeenCalledWith(
				"auto_approval_max_req_reached",
				JSON.stringify({ count: 3, type: "requests" }),
			)
			expect(result.shouldProceed).toBe(true)
			expect(result.requiresApproval).toBe(true)
		})

		it("should reset count when user approves", async () => {
			const messages: ClineMessage[] = []

			// Add messages to exceed limit
			for (let i = 0; i < 3; i++) {
				messages.push({ type: "say", say: "api_req_started", text: "{}", ts: 1000 + i })
			}

			// Next request should trigger approval and reset
			mockAskForApproval.mockResolvedValue({ response: "yesButtonClicked" })
			await handler.checkAutoApprovalLimits(mockState, messages, mockAskForApproval)

			// Add more messages after reset
			messages.push({ type: "say", say: "api_req_started", text: "{}", ts: 4000 })

			// Next check should only count messages after reset
			const result = await handler.checkAutoApprovalLimits(mockState, messages, mockAskForApproval)
			expect(result.requiresApproval).toBe(false) // Should not require approval (1 message + current = 2 <= 3)

			const state = handler.getApprovalState()
			expect(state.requestCount).toBe(2) // 1 message after reset + current request
		})

		it("should not proceed when user rejects", async () => {
			const messages: ClineMessage[] = []

			// Add messages to exceed limit
			for (let i = 0; i < 3; i++) {
				messages.push({ type: "say", say: "api_req_started", text: "{}", ts: 1000 + i })
			}

			// Next request with rejection
			mockAskForApproval.mockResolvedValue({ response: "noButtonClicked" })
			const result = await handler.checkAutoApprovalLimits(mockState, messages, mockAskForApproval)

			expect(result.shouldProceed).toBe(false)
			expect(result.requiresApproval).toBe(true)
		})
	})

	describe("cost limit handling", () => {
		beforeEach(() => {
			mockState.allowedMaxCost = 5.0
		})

		it("should calculate cost from messages", async () => {
			const messages: ClineMessage[] = []

			mockGetApiMetrics.mockReturnValue({ totalCost: 3.5 })
			const result = await handler.checkAutoApprovalLimits(mockState, messages, mockAskForApproval)

			expect(mockGetApiMetrics).toHaveBeenCalledWith(messages)
			expect(result.shouldProceed).toBe(true)
			expect(result.requiresApproval).toBe(false)
		})

		it("should ask for approval when cost limit is exceeded", async () => {
			const messages: ClineMessage[] = []

			mockGetApiMetrics.mockReturnValue({ totalCost: 5.5 })
			mockAskForApproval.mockResolvedValue({ response: "yesButtonClicked" })

			const result = await handler.checkAutoApprovalLimits(mockState, messages, mockAskForApproval)

			expect(mockAskForApproval).toHaveBeenCalledWith(
				"auto_approval_max_req_reached",
				JSON.stringify({ count: "5.00", type: "cost" }),
			)
			expect(result.shouldProceed).toBe(true)
			expect(result.requiresApproval).toBe(true)
			expect(result.approvalType).toBe("cost")
		})

		it("should handle floating-point precision correctly", async () => {
			const messages: ClineMessage[] = []

			// Test edge case where cost is exactly at limit (should not trigger)
			mockGetApiMetrics.mockReturnValue({ totalCost: 5.0 })
			const result1 = await handler.checkAutoApprovalLimits(mockState, messages, mockAskForApproval)
			expect(result1.requiresApproval).toBe(false)

			// Test with slight floating-point error (should not trigger)
			mockGetApiMetrics.mockReturnValue({ totalCost: 5.00009 })
			const result2 = await handler.checkAutoApprovalLimits(mockState, messages, mockAskForApproval)
			expect(result2.requiresApproval).toBe(false)

			// Test when actually exceeded (should trigger)
			mockGetApiMetrics.mockReturnValue({ totalCost: 5.001 })
			mockAskForApproval.mockResolvedValue({ response: "yesButtonClicked" })
			const result3 = await handler.checkAutoApprovalLimits(mockState, messages, mockAskForApproval)
			expect(result3.requiresApproval).toBe(true)
		})

		it("should reset cost tracking on approval", async () => {
			const messages: ClineMessage[] = [
				{ type: "say", say: "api_req_started", text: '{"cost": 3.0}', ts: 1000 },
				{ type: "say", say: "api_req_started", text: '{"cost": 3.0}', ts: 2000 },
			]

			// First check - cost exceeds limit (6.0 > 5.0)
			mockGetApiMetrics.mockReturnValue({ totalCost: 6.0 })
			mockAskForApproval.mockResolvedValue({ response: "yesButtonClicked" })

			const result1 = await handler.checkAutoApprovalLimits(mockState, messages, mockAskForApproval)
			expect(result1.shouldProceed).toBe(true)
			expect(result1.requiresApproval).toBe(true)

			// Add more messages after reset
			messages.push(
				{ type: "say", say: "api_req_started", text: '{"cost": 2.0}', ts: 3000 },
				{ type: "say", say: "api_req_started", text: '{"cost": 1.0}', ts: 4000 },
			)

			// Second check - should only count messages after reset (3.0 < 5.0)
			mockGetApiMetrics.mockReturnValue({ totalCost: 3.0 })
			const result2 = await handler.checkAutoApprovalLimits(mockState, messages, mockAskForApproval)

			// Should not require approval since cost after reset is under limit
			expect(result2.shouldProceed).toBe(true)
			expect(result2.requiresApproval).toBe(false)

			// Verify it's only calculating cost from messages after reset point
			expect(mockGetApiMetrics).toHaveBeenLastCalledWith(messages.slice(2))
		})

		it("should track multiple cost resets correctly", async () => {
			const messages: ClineMessage[] = []

			// First cost limit hit
			messages.push({ type: "say", say: "api_req_started", text: '{"cost": 6.0}', ts: 1000 })
			mockGetApiMetrics.mockReturnValue({ totalCost: 6.0 })
			mockAskForApproval.mockResolvedValue({ response: "yesButtonClicked" })

			await handler.checkAutoApprovalLimits(mockState, messages, mockAskForApproval)

			// Add more messages
			messages.push(
				{ type: "say", say: "api_req_started", text: '{"cost": 3.0}', ts: 2000 },
				{ type: "say", say: "api_req_started", text: '{"cost": 3.0}', ts: 3000 },
			)

			// Second cost limit hit (only counting from index 1)
			mockGetApiMetrics.mockReturnValue({ totalCost: 6.0 })
			await handler.checkAutoApprovalLimits(mockState, messages, mockAskForApproval)

			// Add more messages after second reset
			messages.push({ type: "say", say: "api_req_started", text: '{"cost": 2.0}', ts: 4000 })

			// Third check - should only count from last reset
			mockGetApiMetrics.mockReturnValue({ totalCost: 2.0 })
			const result = await handler.checkAutoApprovalLimits(mockState, messages, mockAskForApproval)

			expect(result.requiresApproval).toBe(false)
			expect(mockGetApiMetrics).toHaveBeenLastCalledWith(messages.slice(3))
		})
	})

	describe("combined limits", () => {
		it("should handle both request and cost limits", async () => {
			mockState.allowedMaxRequests = 2
			mockState.allowedMaxCost = 10.0
			const messages: ClineMessage[] = []

			mockGetApiMetrics.mockReturnValue({ totalCost: 3.0 })

			// First request should pass (count = 1)
			let result = await handler.checkAutoApprovalLimits(mockState, messages, mockAskForApproval)
			expect(result.shouldProceed).toBe(true)
			expect(result.requiresApproval).toBe(false)

			// Add a message and check again (count = 2)
			messages.push({ type: "say", say: "api_req_started", text: "{}", ts: 1000 })
			result = await handler.checkAutoApprovalLimits(mockState, messages, mockAskForApproval)
			expect(result.shouldProceed).toBe(true)
			expect(result.requiresApproval).toBe(false)

			// Add another message - third request should trigger request limit (count = 3 > 2)
			messages.push({ type: "say", say: "api_req_started", text: "{}", ts: 2000 })
			mockAskForApproval.mockResolvedValue({ response: "yesButtonClicked" })
			result = await handler.checkAutoApprovalLimits(mockState, messages, mockAskForApproval)

			expect(mockAskForApproval).toHaveBeenCalledWith(
				"auto_approval_max_req_reached",
				JSON.stringify({ count: 2, type: "requests" }),
			)
			expect(result.shouldProceed).toBe(true)
			expect(result.requiresApproval).toBe(true)
			expect(result.approvalType).toBe("requests")
		})
	})

	describe("resetRequestCount", () => {
		it("should reset tracking", async () => {
			mockState.allowedMaxRequests = 5
			mockState.allowedMaxCost = 10.0
			const messages: ClineMessage[] = []

			// Add some messages
			for (let i = 0; i < 3; i++) {
				messages.push({ type: "say", say: "api_req_started", text: "{}", ts: 1000 + i })
			}

			mockGetApiMetrics.mockReturnValue({ totalCost: 5.0 })
			await handler.checkAutoApprovalLimits(mockState, messages, mockAskForApproval)

			let state = handler.getApprovalState()
			expect(state.requestCount).toBe(4) // 3 messages + current
			expect(state.currentCost).toBe(5.0)

			// Reset
			handler.resetRequestCount()

			// After reset, counts should be zero
			state = handler.getApprovalState()
			expect(state.requestCount).toBe(0)
			expect(state.currentCost).toBe(0)

			// Next check should start fresh
			mockGetApiMetrics.mockReturnValue({ totalCost: 8.0 })
			await handler.checkAutoApprovalLimits(mockState, messages, mockAskForApproval)

			state = handler.getApprovalState()
			expect(state.requestCount).toBe(4) // All messages counted again
			expect(state.currentCost).toBe(8.0)
		})
	})
})
