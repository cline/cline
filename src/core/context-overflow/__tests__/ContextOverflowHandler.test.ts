import { describe, it, expect, beforeEach, vi } from "vitest"
import { ContextOverflowHandler } from "../ContextOverflowHandler"
import { Task } from "../../task/Task"
import { getModeBySlug } from "../../../shared/modes"

// Mock the dependencies
vi.mock("../../task/Task")
vi.mock("../../../shared/modes")

describe("ContextOverflowHandler", () => {
	let handler: ContextOverflowHandler
	let mockTask: any
	let mockProvider: any

	beforeEach(() => {
		mockProvider = {
			getState: vi.fn(),
			finishSubTask: vi.fn(),
		}

		mockTask = {
			taskId: "test-task-id",
			parentTask: null,
			providerRef: {
				deref: vi.fn().mockReturnValue(mockProvider),
			},
			say: vi.fn(),
		}

		handler = new ContextOverflowHandler(mockTask)
	})

	describe("recordToolUse", () => {
		it("should record the last tool used", () => {
			handler.recordToolUse("browser_action")
			expect(handler["lastToolUsed"]).toBe("browser_action")
		})
	})

	describe("shouldTriggerContingency", () => {
		it("should return false when contingency is disabled", async () => {
			mockProvider.getState.mockResolvedValue({
				mode: "code",
				customModes: [],
			})

			vi.mocked(getModeBySlug).mockReturnValue({
				slug: "code",
				name: "Code",
				roleDefinition: "test",
				groups: [],
				contextOverflowContingency: {
					enabled: false,
				},
			})

			const result = await handler.shouldTriggerContingency(100000, 200000, 50000)
			expect(result).toBe(false)
		})

		it("should return true when context is overflowing and contingency is enabled", async () => {
			mockProvider.getState.mockResolvedValue({
				mode: "code",
				customModes: [],
			})

			vi.mocked(getModeBySlug).mockReturnValue({
				slug: "code",
				name: "Code",
				roleDefinition: "test",
				groups: [],
				contextOverflowContingency: {
					enabled: true,
					message: "Context overflow detected",
				},
			})

			// Set context tokens to exceed the threshold (90% of context window - reserved tokens)
			// contextWindow = 200000, maxTokens = 50000
			// allowedTokens = 200000 * 0.9 - 50000 = 180000 - 50000 = 130000
			const result = await handler.shouldTriggerContingency(150000, 200000, 50000)
			expect(result).toBe(true)
		})

		it("should only trigger for specific tools when configured", async () => {
			handler.recordToolUse("browser_action")

			mockProvider.getState.mockResolvedValue({
				mode: "code",
				customModes: [],
			})

			vi.mocked(getModeBySlug).mockReturnValue({
				slug: "code",
				name: "Code",
				roleDefinition: "test",
				groups: [],
				contextOverflowContingency: {
					enabled: true,
					triggerTools: ["browser_action"],
				},
			})

			const result = await handler.shouldTriggerContingency(150000, 200000, 50000)
			expect(result).toBe(true)
		})

		it("should not trigger for non-configured tools", async () => {
			handler.recordToolUse("read_file")

			mockProvider.getState.mockResolvedValue({
				mode: "code",
				customModes: [],
			})

			vi.mocked(getModeBySlug).mockReturnValue({
				slug: "code",
				name: "Code",
				roleDefinition: "test",
				groups: [],
				contextOverflowContingency: {
					enabled: true,
					triggerTools: ["browser_action"],
				},
			})

			const result = await handler.shouldTriggerContingency(150000, 200000, 50000)
			expect(result).toBe(false)
		})
	})

	describe("triggerContingency", () => {
		it("should finish subtask when task has a parent", async () => {
			mockTask.parentTask = { taskId: "parent-task" }

			mockProvider.getState.mockResolvedValue({
				mode: "code",
				customModes: [],
			})

			vi.mocked(getModeBySlug).mockReturnValue({
				slug: "code",
				name: "Code",
				roleDefinition: "test",
				groups: [],
				contextOverflowContingency: {
					enabled: true,
					message: "Custom overflow message",
				},
			})

			await handler.triggerContingency()

			expect(mockProvider.finishSubTask).toHaveBeenCalledWith("Custom overflow message")
		})

		it("should show error message for main tasks", async () => {
			mockProvider.getState.mockResolvedValue({
				mode: "code",
				customModes: [],
			})

			vi.mocked(getModeBySlug).mockReturnValue({
				slug: "code",
				name: "Code",
				roleDefinition: "test",
				groups: [],
				contextOverflowContingency: {
					enabled: true,
					message: "Custom overflow message",
				},
			})

			await handler.triggerContingency()

			expect(mockTask.say).toHaveBeenCalledWith("error", "Custom overflow message")
		})

		it("should use default message when none is configured", async () => {
			mockProvider.getState.mockResolvedValue({
				mode: "code",
				customModes: [],
			})

			vi.mocked(getModeBySlug).mockReturnValue({
				slug: "code",
				name: "Code",
				roleDefinition: "test",
				groups: [],
				contextOverflowContingency: {
					enabled: true,
				},
			})

			await handler.triggerContingency()

			expect(mockTask.say).toHaveBeenCalledWith(
				"error",
				"Task failed because of a context overflow, possibly because webpage returned from the browser was too big",
			)
		})
	})
})
