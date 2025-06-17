// npx vitest run src/api/transform/caching/__tests__/vertex.spec.ts

import { Anthropic } from "@anthropic-ai/sdk"

import { addCacheBreakpoints } from "../vertex"

describe("addCacheBreakpoints (Vertex)", () => {
	it("should return an empty array if input is empty", () => {
		const messages: Anthropic.Messages.MessageParam[] = []
		const result = addCacheBreakpoints(messages)
		expect(result).toEqual([])
		expect(result).not.toBe(messages) // Ensure new array.
	})

	it("should not add breakpoints if there are no user messages", () => {
		const messages: Anthropic.Messages.MessageParam[] = [{ role: "assistant", content: "Hello" }]
		const originalMessages = JSON.parse(JSON.stringify(messages))
		const result = addCacheBreakpoints(messages)
		expect(result).toEqual(originalMessages) // Should be unchanged.
		expect(result).not.toBe(messages) // Ensure new array.
	})

	it("should add a breakpoint to the only user message if only one exists", () => {
		const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "User message 1" }]
		const result = addCacheBreakpoints(messages)

		expect(result).toHaveLength(1)

		expect(result[0].content).toEqual([
			{ type: "text", text: "User message 1", cache_control: { type: "ephemeral" } },
		])

		expect(result).not.toBe(messages) // Ensure new array.
	})

	it("should add breakpoints to both user messages if only two exist", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{ role: "user", content: "User message 1" },
			{ role: "user", content: "User message 2" },
		]

		const result = addCacheBreakpoints(messages)
		expect(result).toHaveLength(2)

		expect(result[0].content).toEqual([
			{ type: "text", text: "User message 1", cache_control: { type: "ephemeral" } },
		])

		expect(result[1].content).toEqual([
			{ type: "text", text: "User message 2", cache_control: { type: "ephemeral" } },
		])

		expect(result).not.toBe(messages) // Ensure new array.
	})

	it("should add breakpoints only to the last two user messages when more than two exist", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{ role: "user", content: "User message 1" }, // Should not get breakpoint.
			{ role: "user", content: "User message 2" }, // Should get breakpoint.
			{ role: "user", content: "User message 3" }, // Should get breakpoint.
		]

		const originalMessage1 = JSON.parse(JSON.stringify(messages[0]))
		const result = addCacheBreakpoints(messages)

		expect(result).toHaveLength(3)
		expect(result[0]).toEqual(originalMessage1)

		expect(result[1].content).toEqual([
			{ type: "text", text: "User message 2", cache_control: { type: "ephemeral" } },
		])

		expect(result[2].content).toEqual([
			{ type: "text", text: "User message 3", cache_control: { type: "ephemeral" } },
		])

		expect(result).not.toBe(messages) // Ensure new array.
	})

	it("should handle assistant messages correctly when finding last two user messages", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{ role: "user", content: "User message 1" }, // Should not get breakpoint.
			{ role: "assistant", content: "Assistant response 1" }, // Should be unchanged.
			{ role: "user", content: "User message 2" }, // Should get breakpoint (second to last user).
			{ role: "assistant", content: "Assistant response 2" }, // Should be unchanged.
			{ role: "user", content: "User message 3" }, // Should get breakpoint (last user).
			{ role: "assistant", content: "Assistant response 3" }, // Should be unchanged.
		]
		const originalMessage1 = JSON.parse(JSON.stringify(messages[0]))
		const originalAssistant1 = JSON.parse(JSON.stringify(messages[1]))
		const originalAssistant2 = JSON.parse(JSON.stringify(messages[3]))
		const originalAssistant3 = JSON.parse(JSON.stringify(messages[5]))

		const result = addCacheBreakpoints(messages)
		expect(result).toHaveLength(6)

		expect(result[0]).toEqual(originalMessage1)
		expect(result[1]).toEqual(originalAssistant1)

		expect(result[2].content).toEqual([
			{ type: "text", text: "User message 2", cache_control: { type: "ephemeral" } },
		])

		expect(result[3]).toEqual(originalAssistant2)

		expect(result[4].content).toEqual([
			{ type: "text", text: "User message 3", cache_control: { type: "ephemeral" } },
		])

		expect(result[5]).toEqual(originalAssistant3)
		expect(result).not.toBe(messages) // Ensure new array.
	})

	it("should add breakpoint only to the last text part if content is an array", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{ role: "user", content: "User message 1" }, // Gets breakpoint.
			{
				role: "user", // Gets breakpoint.
				content: [
					{ type: "text", text: "First text part." }, // No breakpoint.
					{ type: "image", source: { type: "base64", media_type: "image/png", data: "..." } },
					{ type: "text", text: "Last text part." }, // Gets breakpoint.
				],
			},
		]

		const result = addCacheBreakpoints(messages)
		expect(result).toHaveLength(2)

		expect(result[0].content).toEqual([
			{ type: "text", text: "User message 1", cache_control: { type: "ephemeral" } },
		])

		expect(result[1].content).toEqual([
			{ type: "text", text: "First text part." }, // Unchanged.
			{ type: "image", source: { type: "base64", media_type: "image/png", data: "..." } }, // Unchanged.
			{ type: "text", text: "Last text part.", cache_control: { type: "ephemeral" } }, // Breakpoint added.
		])

		expect(result).not.toBe(messages) // Ensure new array.
	})

	it("should handle array content with no text parts gracefully", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{ role: "user", content: "User message 1" }, // Gets breakpoint.
			{
				role: "user", // Gets breakpoint, but has no text part to add it to.
				content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "..." } }],
			},
		]

		const originalMessage2 = JSON.parse(JSON.stringify(messages[1]))

		const result = addCacheBreakpoints(messages)
		expect(result).toHaveLength(2)

		expect(result[0].content).toEqual([
			{ type: "text", text: "User message 1", cache_control: { type: "ephemeral" } },
		])

		// Check second user message - should be unchanged as no text part found.
		expect(result[1]).toEqual(originalMessage2)
		expect(result).not.toBe(messages) // Ensure new array.
	})

	it("should not modify the original messages array", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{ role: "user", content: "User message 1" },
			{ role: "user", content: "User message 2" },
		]
		const originalMessagesCopy = JSON.parse(JSON.stringify(messages))

		addCacheBreakpoints(messages)

		// Verify original array is untouched.
		expect(messages).toEqual(originalMessagesCopy)
	})
})
