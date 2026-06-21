import { expect } from "chai"
import type { ToolUse } from "@core/assistant-message"
import { MAX_TOOL_RESULT_TEXT_CHARS, ToolResultUtils } from "../ToolResultUtils"

describe("ToolResultUtils", () => {
	const block: ToolUse = {
		type: "tool_use",
		name: "list_code_definition_names",
		params: { path: "src" },
		partial: false,
		call_id: "tool-call-1",
	}

	it("caps fallback text tool results before adding them to task history", () => {
		const userMessageContent: any[] = []
		const oversizedResult = `${"a".repeat(MAX_TOOL_RESULT_TEXT_CHARS)}${"b".repeat(10_000)}`

		ToolResultUtils.pushToolResult(
			oversizedResult,
			block,
			userMessageContent,
			() => "[list_code_definition_names for 'src']",
		)

		expect(userMessageContent).to.have.length(1)
		expect(userMessageContent[0].type).to.equal("text")
		expect(userMessageContent[0].text.length).to.equal(MAX_TOOL_RESULT_TEXT_CHARS)
		expect(userMessageContent[0].text).to.contain("tool result truncated")
		expect(userMessageContent[0].text).to.contain("[list_code_definition_names for 'src'] Result:")
		expect(userMessageContent[0].text.endsWith("b".repeat(20))).to.equal(true)
	})

	it("caps matched native tool_result string content", () => {
		const userMessageContent: any[] = []
		const oversizedResult = `${"x".repeat(MAX_TOOL_RESULT_TEXT_CHARS)}${"y".repeat(10_000)}`
		const toolUseIdMap = new Map([["tool-call-1", "provider-tool-use-1"]])

		ToolResultUtils.pushToolResult(
			oversizedResult,
			block,
			userMessageContent,
			() => "[replace_in_file for 'src/main.cpp']",
			undefined,
			toolUseIdMap,
		)

		expect(userMessageContent).to.have.length(1)
		expect(userMessageContent[0].type).to.equal("tool_result")
		expect(userMessageContent[0].tool_use_id).to.equal("provider-tool-use-1")
		expect(userMessageContent[0].content.length).to.equal(MAX_TOOL_RESULT_TEXT_CHARS)
		expect(userMessageContent[0].content).to.contain("tool result truncated")
		expect(userMessageContent[0].content.endsWith("y".repeat(20))).to.equal(true)
	})

	it("does not alter small string results", () => {
		const userMessageContent: any[] = []

		ToolResultUtils.pushToolResult("small result", block, userMessageContent, () => "[test tool]")

		expect(userMessageContent).to.deep.equal([
			{
				type: "text",
				text: "[test tool] Result:\nsmall result",
			},
		])
	})
})
