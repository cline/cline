// npx vitest run src/api/transform/caching/__tests__/vercel-ai-gateway.spec.ts

import OpenAI from "openai"
import { addCacheBreakpoints } from "../vercel-ai-gateway"

describe("Vercel AI Gateway Caching", () => {
	describe("addCacheBreakpoints", () => {
		it("adds cache control to system message", () => {
			const systemPrompt = "You are a helpful assistant."
			const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: "Hello" },
			]

			addCacheBreakpoints(systemPrompt, messages)

			expect(messages[0]).toEqual({
				role: "system",
				content: systemPrompt,
				cache_control: { type: "ephemeral" },
			})
		})

		it("adds cache control to last two user messages with string content", () => {
			const systemPrompt = "You are a helpful assistant."
			const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: "First message" },
				{ role: "assistant", content: "First response" },
				{ role: "user", content: "Second message" },
				{ role: "assistant", content: "Second response" },
				{ role: "user", content: "Third message" },
				{ role: "assistant", content: "Third response" },
				{ role: "user", content: "Fourth message" },
			]

			addCacheBreakpoints(systemPrompt, messages)

			const lastUserMessage = messages[7]
			expect(Array.isArray(lastUserMessage.content)).toBe(true)
			if (Array.isArray(lastUserMessage.content)) {
				const textPart = lastUserMessage.content.find((part) => part.type === "text")
				expect(textPart).toEqual({
					type: "text",
					text: "Fourth message",
					cache_control: { type: "ephemeral" },
				})
			}

			const secondLastUserMessage = messages[5]
			expect(Array.isArray(secondLastUserMessage.content)).toBe(true)
			if (Array.isArray(secondLastUserMessage.content)) {
				const textPart = secondLastUserMessage.content.find((part) => part.type === "text")
				expect(textPart).toEqual({
					type: "text",
					text: "Third message",
					cache_control: { type: "ephemeral" },
				})
			}
		})

		it("handles messages with existing array content", () => {
			const systemPrompt = "You are a helpful assistant."
			const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
				{ role: "system", content: systemPrompt },
				{
					role: "user",
					content: [
						{ type: "text", text: "Hello with image" },
						{ type: "image_url", image_url: { url: "data:image/png;base64,..." } },
					],
				},
			]

			addCacheBreakpoints(systemPrompt, messages)

			const userMessage = messages[1]
			expect(Array.isArray(userMessage.content)).toBe(true)
			if (Array.isArray(userMessage.content)) {
				const textPart = userMessage.content.find((part) => part.type === "text")
				expect(textPart).toEqual({
					type: "text",
					text: "Hello with image",
					cache_control: { type: "ephemeral" },
				})

				const imagePart = userMessage.content.find((part) => part.type === "image_url")
				expect(imagePart).toEqual({
					type: "image_url",
					image_url: { url: "data:image/png;base64,..." },
				})
			}
		})

		it("handles empty string content gracefully", () => {
			const systemPrompt = "You are a helpful assistant."
			const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: "" },
			]

			addCacheBreakpoints(systemPrompt, messages)

			const userMessage = messages[1]
			expect(userMessage.content).toBe("")
		})

		it("handles messages with no text parts", () => {
			const systemPrompt = "You are a helpful assistant."
			const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
				{ role: "system", content: systemPrompt },
				{
					role: "user",
					content: [{ type: "image_url", image_url: { url: "data:image/png;base64,..." } }],
				},
			]

			addCacheBreakpoints(systemPrompt, messages)

			const userMessage = messages[1]
			expect(Array.isArray(userMessage.content)).toBe(true)
			if (Array.isArray(userMessage.content)) {
				const textPart = userMessage.content.find((part) => part.type === "text")
				expect(textPart).toBeUndefined()

				const imagePart = userMessage.content.find((part) => part.type === "image_url")
				expect(imagePart).toEqual({
					type: "image_url",
					image_url: { url: "data:image/png;base64,..." },
				})
			}
		})

		it("processes only user messages for conversation caching", () => {
			const systemPrompt = "You are a helpful assistant."
			const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: "First user" },
				{ role: "assistant", content: "Assistant response" },
				{ role: "user", content: "Second user" },
			]

			addCacheBreakpoints(systemPrompt, messages)

			expect(messages[2]).toEqual({
				role: "assistant",
				content: "Assistant response",
			})

			const firstUser = messages[1]
			const secondUser = messages[3]

			expect(Array.isArray(firstUser.content)).toBe(true)
			expect(Array.isArray(secondUser.content)).toBe(true)
		})

		it("handles case with only one user message", () => {
			const systemPrompt = "You are a helpful assistant."
			const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: "Only message" },
			]

			addCacheBreakpoints(systemPrompt, messages)

			const userMessage = messages[1]
			expect(Array.isArray(userMessage.content)).toBe(true)
			if (Array.isArray(userMessage.content)) {
				const textPart = userMessage.content.find((part) => part.type === "text")
				expect(textPart).toEqual({
					type: "text",
					text: "Only message",
					cache_control: { type: "ephemeral" },
				})
			}
		})

		it("handles case with no user messages", () => {
			const systemPrompt = "You are a helpful assistant."
			const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
				{ role: "system", content: systemPrompt },
				{ role: "assistant", content: "Assistant only" },
			]

			addCacheBreakpoints(systemPrompt, messages)

			expect(messages[0]).toEqual({
				role: "system",
				content: systemPrompt,
				cache_control: { type: "ephemeral" },
			})

			expect(messages[1]).toEqual({
				role: "assistant",
				content: "Assistant only",
			})
		})

		it("handles messages with multiple text parts", () => {
			const systemPrompt = "You are a helpful assistant."
			const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
				{ role: "system", content: systemPrompt },
				{
					role: "user",
					content: [
						{ type: "text", text: "First part" },
						{ type: "image_url", image_url: { url: "data:image/png;base64,..." } },
						{ type: "text", text: "Second part" },
					],
				},
			]

			addCacheBreakpoints(systemPrompt, messages)

			const userMessage = messages[1]
			if (Array.isArray(userMessage.content)) {
				const textParts = userMessage.content.filter((part) => part.type === "text")
				expect(textParts).toHaveLength(2)

				expect(textParts[0]).toEqual({
					type: "text",
					text: "First part",
				})

				expect(textParts[1]).toEqual({
					type: "text",
					text: "Second part",
					cache_control: { type: "ephemeral" },
				})
			}
		})
	})
})
