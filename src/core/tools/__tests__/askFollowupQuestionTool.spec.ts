import { describe, it, expect, vi } from "vitest"
import { askFollowupQuestionTool } from "../askFollowupQuestionTool"
import { ToolUse } from "../../../shared/tools"

describe("askFollowupQuestionTool", () => {
	let mockCline: any
	let mockPushToolResult: any
	let toolResult: any

	beforeEach(() => {
		vi.clearAllMocks()

		mockCline = {
			ask: vi.fn().mockResolvedValue({ text: "Test response" }),
			say: vi.fn().mockResolvedValue(undefined),
			consecutiveMistakeCount: 0,
		}

		mockPushToolResult = vi.fn((result) => {
			toolResult = result
		})
	})

	it("should parse suggestions without mode attributes", async () => {
		const block: ToolUse = {
			type: "tool_use",
			name: "ask_followup_question",
			params: {
				question: "What would you like to do?",
				follow_up: "<suggest>Option 1</suggest><suggest>Option 2</suggest>",
			},
			partial: false,
		}

		await askFollowupQuestionTool(
			mockCline,
			block,
			vi.fn(),
			vi.fn(),
			mockPushToolResult,
			vi.fn((tag, content) => content),
		)

		expect(mockCline.ask).toHaveBeenCalledWith(
			"followup",
			expect.stringContaining('"suggest":[{"answer":"Option 1"},{"answer":"Option 2"}]'),
			false,
		)
	})

	it("should parse suggestions with mode attributes", async () => {
		const block: ToolUse = {
			type: "tool_use",
			name: "ask_followup_question",
			params: {
				question: "What would you like to do?",
				follow_up: '<suggest mode="code">Write code</suggest><suggest mode="debug">Debug issue</suggest>',
			},
			partial: false,
		}

		await askFollowupQuestionTool(
			mockCline,
			block,
			vi.fn(),
			vi.fn(),
			mockPushToolResult,
			vi.fn((tag, content) => content),
		)

		expect(mockCline.ask).toHaveBeenCalledWith(
			"followup",
			expect.stringContaining(
				'"suggest":[{"answer":"Write code","mode":"code"},{"answer":"Debug issue","mode":"debug"}]',
			),
			false,
		)
	})

	it("should handle mixed suggestions with and without mode attributes", async () => {
		const block: ToolUse = {
			type: "tool_use",
			name: "ask_followup_question",
			params: {
				question: "What would you like to do?",
				follow_up: '<suggest>Regular option</suggest><suggest mode="architect">Plan architecture</suggest>',
			},
			partial: false,
		}

		await askFollowupQuestionTool(
			mockCline,
			block,
			vi.fn(),
			vi.fn(),
			mockPushToolResult,
			vi.fn((tag, content) => content),
		)

		expect(mockCline.ask).toHaveBeenCalledWith(
			"followup",
			expect.stringContaining(
				'"suggest":[{"answer":"Regular option"},{"answer":"Plan architecture","mode":"architect"}]',
			),
			false,
		)
	})
})
