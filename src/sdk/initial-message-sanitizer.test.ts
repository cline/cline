import { describe, expect, it } from "vitest"
import { sanitizeInitialMessagesForSessionStart } from "./initial-message-sanitizer"

describe("sanitizeInitialMessagesForSessionStart", () => {
	it("returns original array when no tool_use blocks exist", () => {
		const input = [
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "hi" },
		]
		const result = sanitizeInitialMessagesForSessionStart(input)
		expect(result).toBe(input)
	})

	it("adds missing tool_result blocks to the next user message", () => {
		const input = [
			{
				role: "assistant",
				content: [{ type: "tool_use", id: "toolu_1", name: "read_file", input: { path: "a.ts" } }],
			},
			{
				role: "user",
				content: [{ type: "text", text: "continue" }],
			},
		]

		const result = sanitizeInitialMessagesForSessionStart(input)
		expect(result).not.toBe(input)

		const nextContent = (result[1] as { content: Array<Record<string, unknown>> }).content
		expect(nextContent).toEqual([
			expect.objectContaining({
				type: "tool_result",
				tool_use_id: "toolu_1",
			}),
		])
		expect(result[2]).toMatchObject({
			role: "user",
			content: [expect.objectContaining({ type: "text", text: "continue" })],
		})
	})

	it("inserts synthetic user tool_result message when missing next user message", () => {
		const input = [
			{
				role: "assistant",
				content: [{ type: "tool_use", id: "toolu_1", name: "read_file", input: { path: "a.ts" } }],
			},
			{ role: "assistant", content: [{ type: "text", text: "extra" }] },
		]

		const result = sanitizeInitialMessagesForSessionStart(input)
		expect(result).toHaveLength(3)
		expect(result[1]).toMatchObject({
			role: "user",
			content: [{ type: "tool_result", tool_use_id: "toolu_1" }],
		})
	})

	it("reorders existing tool_result blocks to match tool_use order", () => {
		const input = [
			{
				role: "assistant",
				content: [
					{ type: "tool_use", id: "toolu_1", name: "read_file", input: { path: "a.ts" } },
					{ type: "tool_use", id: "toolu_2", name: "read_file", input: { path: "b.ts" } },
				],
			},
			{
				role: "user",
				content: [
					{ type: "tool_result", tool_use_id: "toolu_2", content: "b" },
					{ type: "text", text: "keep me" },
					{ type: "tool_result", tool_use_id: "toolu_1", content: "a" },
				],
			},
		]

		const result = sanitizeInitialMessagesForSessionStart(input)
		const nextContent = (result[1] as { content: Array<Record<string, unknown>> }).content
		expect(nextContent[0]).toMatchObject({ type: "tool_result", tool_use_id: "toolu_1" })
		expect(nextContent[1]).toMatchObject({ type: "tool_result", tool_use_id: "toolu_2" })
		expect(nextContent[2]).toMatchObject({ type: "text", text: "keep me" })
	})
})
