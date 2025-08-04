import { describe, it, expect, vi, beforeEach } from "vitest"
import { AutoApprovalHandler } from "../AutoApprovalHandler"
import { GlobalState, ClineMessage } from "@roo-code/types"

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

			// First call should be under limit
			const result1 = await handler.checkAutoApprovalLimits(mockState, messages, mockAskForApproval)
			expect(result1.shouldProceed).toBe(true)
			expect(result1.requiresApproval).toBe(false)

			// Second call should trigger request limit
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

		it("should increment request count on each check", async () => {
			const messages: ClineMessage[] = []

			// Check state after each call
			for (let i = 1; i <= 3; i++) {
				await handler.checkAutoApprovalLimits(mockState, messages, mockAskForApproval)
				const state = handler.getApprovalState()
				expect(state.requestCount).toBe(i)
			}
		})

		it("should ask for approval when limit is exceeded", async () => {
			const messages: ClineMessage[] = []

			// Make 3 requests (within limit)
			for (let i = 0; i < 3; i++) {
				await handler.checkAutoApprovalLimits(mockState, messages, mockAskForApproval)
			}
			expect(mockAskForApproval).not.toHaveBeenCalled()

			// 4th request should trigger approval
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

			// Exceed limit
			for (let i = 0; i < 3; i++) {
				await handler.checkAutoApprovalLimits(mockState, messages, mockAskForApproval)
			}

			// 4th request should trigger approval and reset
			mockAskForApproval.mockResolvedValue({ response: "yesButtonClicked" })
			await handler.checkAutoApprovalLimits(mockState, messages, mockAskForApproval)

			// Count should be reset
			const state = handler.getApprovalState()
			expect(state.requestCount).toBe(0)
		})

		it("should not proceed when user rejects", async () => {
			const messages: ClineMessage[] = []

			// Exceed limit
			for (let i = 0; i < 3; i++) {
				await handler.checkAutoApprovalLimits(mockState, messages, mockAskForApproval)
			}

			// 4th request with rejection
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

		it("should not reset cost to zero on approval", async () => {
			const messages: ClineMessage[] = []

			mockGetApiMetrics.mockReturnValue({ totalCost: 6.0 })
			mockAskForApproval.mockResolvedValue({ response: "yesButtonClicked" })

			await handler.checkAutoApprovalLimits(mockState, messages, mockAskForApproval)

			// Cost should still be calculated from messages, not reset
			const state = handler.getApprovalState()
			expect(state.currentCost).toBe(6.0)
		})
	})

	describe("combined limits", () => {
		it("should handle both request and cost limits", async () => {
			mockState.allowedMaxRequests = 2
			mockState.allowedMaxCost = 10.0
			const messages: ClineMessage[] = []

			mockGetApiMetrics.mockReturnValue({ totalCost: 3.0 })

			// First two requests should pass
			for (let i = 0; i < 2; i++) {
				const result = await handler.checkAutoApprovalLimits(mockState, messages, mockAskForApproval)
				expect(result.shouldProceed).toBe(true)
				expect(result.requiresApproval).toBe(false)
			}

			// Third request should trigger request limit (not cost limit)
			mockAskForApproval.mockResolvedValue({ response: "yesButtonClicked" })
			const result = await handler.checkAutoApprovalLimits(mockState, messages, mockAskForApproval)

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
		it("should reset the request counter", async () => {
			mockState.allowedMaxRequests = 5
			const messages: ClineMessage[] = []

			// Make some requests
			for (let i = 0; i < 3; i++) {
				await handler.checkAutoApprovalLimits(mockState, messages, mockAskForApproval)
			}

			let state = handler.getApprovalState()
			expect(state.requestCount).toBe(3)

			// Reset
			handler.resetRequestCount()

			state = handler.getApprovalState()
			expect(state.requestCount).toBe(0)
		})
	})
})
