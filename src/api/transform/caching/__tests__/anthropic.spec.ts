// npx vitest run src/api/transform/caching/__tests__/anthropic.spec.ts

import { describe, it, expect } from "vitest"
import OpenAI from "openai"

import { addCacheBreakpoints } from "../anthropic"

describe("addCacheBreakpoints (Anthropic)", () => {
	const systemPrompt = "You are a helpful assistant."

	it("should always add a cache breakpoint to the system prompt", () => {
		const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: "Hello" },
		]

		addCacheBreakpoints(systemPrompt, messages)

		expect(messages[0].content).toEqual([
			{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
		])
	})

	it("should not add breakpoints to user messages if there are none", () => {
		const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: "system", content: systemPrompt }]
		const originalMessages = JSON.parse(JSON.stringify(messages))

		addCacheBreakpoints(systemPrompt, messages)

		expect(messages[0].content).toEqual([
			{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
		])

		expect(messages.length).toBe(originalMessages.length)
	})

	it("should add a breakpoint to the only user message if only one exists", () => {
		const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: "User message 1" },
		]

		addCacheBreakpoints(systemPrompt, messages)

		expect(messages[1].content).toEqual([
			{ type: "text", text: "User message 1", cache_control: { type: "ephemeral" } },
		])
	})

	it("should add breakpoints to both user messages if only two exist", () => {
		const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: "User message 1" },
			{ role: "user", content: "User message 2" },
		]

		addCacheBreakpoints(systemPrompt, messages)

		expect(messages[1].content).toEqual([
			{ type: "text", text: "User message 1", cache_control: { type: "ephemeral" } },
		])

		expect(messages[2].content).toEqual([
			{ type: "text", text: "User message 2", cache_control: { type: "ephemeral" } },
		])
	})

	it("should add breakpoints to the last two user messages when more than two exist", () => {
		const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: "User message 1" }, // Should not get breakpoint.
			{ role: "user", content: "User message 2" }, // Should get breakpoint.
			{ role: "user", content: "User message 3" }, // Should get breakpoint.
		]
		addCacheBreakpoints(systemPrompt, messages)

		expect(messages[1].content).toEqual([{ type: "text", text: "User message 1" }])

		expect(messages[2].content).toEqual([
			{ type: "text", text: "User message 2", cache_control: { type: "ephemeral" } },
		])

		expect(messages[3].content).toEqual([
			{ type: "text", text: "User message 3", cache_control: { type: "ephemeral" } },
		])
	})

	it("should handle assistant messages correctly when finding last two user messages", () => {
		const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: "User message 1" }, // Should not get breakpoint.
			{ role: "assistant", content: "Assistant response 1" },
			{ role: "user", content: "User message 2" }, // Should get breakpoint (second to last user).
			{ role: "assistant", content: "Assistant response 2" },
			{ role: "user", content: "User message 3" }, // Should get breakpoint (last user).
			{ role: "assistant", content: "Assistant response 3" },
		]
		addCacheBreakpoints(systemPrompt, messages)

		const userMessages = messages.filter((m) => m.role === "user")

		expect(userMessages[0].content).toEqual([{ type: "text", text: "User message 1" }])

		expect(userMessages[1].content).toEqual([
			{ type: "text", text: "User message 2", cache_control: { type: "ephemeral" } },
		])

		expect(userMessages[2].content).toEqual([
			{ type: "text", text: "User message 3", cache_control: { type: "ephemeral" } },
		])
	})

	it("should add breakpoint to the last text part if content is an array", () => {
		const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: "User message 1" },
			{
				role: "user",
				content: [
					{ type: "text", text: "This is the last user message." },
					{ type: "image_url", image_url: { url: "data:image/png;base64,..." } },
					{ type: "text", text: "This part should get the breakpoint." },
				],
			},
		]

		addCacheBreakpoints(systemPrompt, messages)

		expect(messages[1].content).toEqual([
			{ type: "text", text: "User message 1", cache_control: { type: "ephemeral" } },
		])

		expect(messages[2].content).toEqual([
			{ type: "text", text: "This is the last user message." },
			{ type: "image_url", image_url: { url: "data:image/png;base64,..." } },
			{ type: "text", text: "This part should get the breakpoint.", cache_control: { type: "ephemeral" } },
		])
	})

	it("should add a placeholder text part if the target message has no text parts", () => {
		const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: "User message 1" },
			{
				role: "user",
				content: [{ type: "image_url", image_url: { url: "data:image/png;base64,..." } }],
			},
		]

		addCacheBreakpoints(systemPrompt, messages)

		expect(messages[1].content).toEqual([
			{ type: "text", text: "User message 1", cache_control: { type: "ephemeral" } },
		])

		expect(messages[2].content).toEqual([
			{ type: "image_url", image_url: { url: "data:image/png;base64,..." } },
			{ type: "text", text: "...", cache_control: { type: "ephemeral" } }, // Placeholder added.
		])
	})

	it("should ensure content is array format even if no breakpoint added", () => {
		const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: "User message 1" }, // String content, no breakpoint.
			{ role: "user", content: "User message 2" }, // Gets breakpoint.
			{ role: "user", content: "User message 3" }, // Gets breakpoint.
		]

		addCacheBreakpoints(systemPrompt, messages)

		expect(messages[1].content).toEqual([{ type: "text", text: "User message 1" }])

		expect(messages[2].content).toEqual([
			{ type: "text", text: "User message 2", cache_control: { type: "ephemeral" } },
		])

		expect(messages[3].content).toEqual([
			{ type: "text", text: "User message 3", cache_control: { type: "ephemeral" } },
		])
	})
})
