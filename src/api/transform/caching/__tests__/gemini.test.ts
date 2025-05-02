// npx jest src/api/transform/caching/__tests__/gemini.test.ts

import OpenAI from "openai"

import { addCacheBreakpoints } from "../gemini"

describe("addCacheBreakpoints", () => {
	const systemPrompt = "You are a helpful assistant."

	it("should always add a cache breakpoint to the system prompt", () => {
		const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: "Hello" },
		]
		addCacheBreakpoints(systemPrompt, messages, 10) // Pass frequency
		expect(messages[0].content).toEqual([
			{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
		])
	})

	it("should not add breakpoints for fewer than N user messages", () => {
		const frequency = 5

		const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...Array.from({ length: frequency - 1 }, (_, i) => ({
				role: "user" as const,
				content: `User message ${i + 1}`,
			})),
		]

		const originalMessages = JSON.parse(JSON.stringify(messages))

		addCacheBreakpoints(systemPrompt, messages, frequency)

		expect(messages[0].content).toEqual([
			{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
		])

		for (let i = 1; i < messages.length; i++) {
			const originalContent = originalMessages[i].content

			const expectedContent =
				typeof originalContent === "string" ? [{ type: "text", text: originalContent }] : originalContent

			expect(messages[i].content).toEqual(expectedContent)
		}
	})

	it("should add a breakpoint to the Nth user message", () => {
		const frequency = 5

		const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...Array.from({ length: frequency }, (_, i) => ({
				role: "user" as const,
				content: `User message ${i + 1}`,
			})),
		]

		addCacheBreakpoints(systemPrompt, messages, frequency)

		// Check Nth user message (index 'frequency' in the full array).
		expect(messages[frequency].content).toEqual([
			{ type: "text", text: `User message ${frequency}`, cache_control: { type: "ephemeral" } },
		])

		// Check (N-1)th user message (index frequency-1) - should be unchanged.
		expect(messages[frequency - 1].content).toEqual([{ type: "text", text: `User message ${frequency - 1}` }])
	})

	it("should add breakpoints to the Nth and 2*Nth user messages", () => {
		const frequency = 5

		const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...Array.from({ length: frequency * 2 }, (_, i) => ({
				role: "user" as const,
				content: `User message ${i + 1}`,
			})),
		]

		expect(messages.length).toEqual(frequency * 2 + 1)

		addCacheBreakpoints(systemPrompt, messages, frequency)

		const indices = []

		for (let i = 0; i < messages.length; i++) {
			const content = messages[i].content?.[0]

			if (typeof content === "object" && "cache_control" in content) {
				indices.push(i)
			}
		}

		expect(indices).toEqual([0, 5, 10])

		// Check Nth user message (index frequency)
		expect(messages[frequency].content).toEqual([
			{ type: "text", text: `User message ${frequency}`, cache_control: { type: "ephemeral" } },
		])

		// Check (2*N-1)th user message (index 2*frequency-1) - unchanged
		expect(messages[frequency * 2 - 1].content).toEqual([
			{ type: "text", text: `User message ${frequency * 2 - 1}` },
		])

		// Check 2*Nth user message (index 2*frequency)
		expect(messages[frequency * 2].content).toEqual([
			{ type: "text", text: `User message ${frequency * 2}`, cache_control: { type: "ephemeral" } },
		])
	})

	it("should handle assistant messages correctly when counting user messages", () => {
		const frequency = 5

		const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			// N-1 user messages
			...Array.from({ length: frequency - 1 }, (_, i) => ({
				role: "user" as const,
				content: `User message ${i + 1}`,
			})),
			{ role: "assistant", content: "Assistant response" },
			{ role: "user", content: `User message ${frequency}` }, // This is the Nth user message.
			{ role: "assistant", content: "Another response" },
			{ role: "user", content: `User message ${frequency + 1}` },
		]

		addCacheBreakpoints(systemPrompt, messages, frequency)

		// Find the Nth user message.
		const nthUserMessage = messages.filter((m) => m.role === "user")[frequency - 1]
		expect(nthUserMessage.content).toEqual([
			{ type: "text", text: `User message ${frequency}`, cache_control: { type: "ephemeral" } },
		])

		// Check the (N+1)th user message is unchanged.
		const nPlusOneUserMessage = messages.filter((m) => m.role === "user")[frequency]
		expect(nPlusOneUserMessage.content).toEqual([{ type: "text", text: `User message ${frequency + 1}` }])
	})

	it("should add breakpoint to the last text part if content is an array", () => {
		const frequency = 5

		const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...Array.from({ length: frequency - 1 }, (_, i) => ({
				role: "user" as const,
				content: `User message ${i + 1}`,
			})),
			{
				role: "user", // Nth user message
				content: [
					{ type: "text", text: `This is the ${frequency}th user message.` },
					{ type: "image_url", image_url: { url: "data:image/png;base64,..." } },
					{ type: "text", text: "This part should get the breakpoint." },
				],
			},
		]

		addCacheBreakpoints(systemPrompt, messages, frequency)

		expect(messages[frequency].content).toEqual([
			{ type: "text", text: `This is the ${frequency}th user message.` },
			{ type: "image_url", image_url: { url: "data:image/png;base64,..." } },
			{ type: "text", text: "This part should get the breakpoint.", cache_control: { type: "ephemeral" } },
		])
	})

	it("should add a placeholder text part if the target message has no text parts", () => {
		const frequency = 5

		const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...Array.from({ length: frequency - 1 }, (_, i) => ({
				role: "user" as const,
				content: `User message ${i + 1}`,
			})),
			{
				role: "user", // Nth user message.
				content: [{ type: "image_url", image_url: { url: "data:image/png;base64,..." } }],
			},
		]

		addCacheBreakpoints(systemPrompt, messages, frequency)

		expect(messages[frequency].content).toEqual([
			{ type: "image_url", image_url: { url: "data:image/png;base64,..." } },
			{ type: "text", text: "...", cache_control: { type: "ephemeral" } },
		])
	})

	it("should add breakpoints correctly with frequency 5", () => {
		const frequency = 5

		const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...Array.from({ length: 12 }, (_, i) => ({
				role: "user" as const,
				content: `User message ${i + 1}`,
			})),
		]

		addCacheBreakpoints(systemPrompt, messages, frequency)

		// Check 5th user message (index 5).
		expect(messages[5].content).toEqual([
			{ type: "text", text: "User message 5", cache_control: { type: "ephemeral" } },
		])

		// Check 9th user message (index 9) - unchanged
		expect(messages[9].content).toEqual([{ type: "text", text: "User message 9" }])

		// Check 10th user message (index 10).
		expect(messages[10].content).toEqual([
			{ type: "text", text: "User message 10", cache_control: { type: "ephemeral" } },
		])

		// Check 11th user message (index 11) - unchanged
		expect(messages[11].content).toEqual([{ type: "text", text: "User message 11" }])
	})

	it("should not add breakpoints (except system) if frequency is 0", () => {
		const frequency = 0
		const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...Array.from({ length: 15 }, (_, i) => ({
				role: "user" as const,
				content: `User message ${i + 1}`,
			})),
		]
		const originalMessages = JSON.parse(JSON.stringify(messages))

		addCacheBreakpoints(systemPrompt, messages, frequency)

		// Check system prompt.
		expect(messages[0].content).toEqual([
			{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
		])

		// Check all user messages - none should have cache_control
		for (let i = 1; i < messages.length; i++) {
			const originalContent = originalMessages[i].content

			const expectedContent =
				typeof originalContent === "string" ? [{ type: "text", text: originalContent }] : originalContent

			expect(messages[i].content).toEqual(expectedContent) // Should match original (after string->array conversion).

			// Ensure no cache_control was added to user messages.
			const content = messages[i].content

			if (Array.isArray(content)) {
				// Assign to new variable after type check.
				const contentParts = content

				contentParts.forEach((part: any) => {
					// Iterate over the correctly typed variable.
					expect(part).not.toHaveProperty("cache_control")
				})
			}
		}
	})
})
