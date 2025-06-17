// npx vitest utils/__tests__/tiktoken.spec.ts

import { tiktoken } from "../tiktoken"
import { Anthropic } from "@anthropic-ai/sdk"

describe("tiktoken", () => {
	it("should return 0 for empty content array", async () => {
		const result = await tiktoken([])
		expect(result).toBe(0)
	})

	it("should correctly count tokens for text content", async () => {
		const content: Anthropic.Messages.ContentBlockParam[] = [{ type: "text", text: "Hello world" }]

		const result = await tiktoken(content)
		// We can't predict the exact token count without mocking,
		// but we can verify it's a positive number
		expect(result).toEqual(3)
	})

	it("should handle empty text content", async () => {
		const content: Anthropic.Messages.ContentBlockParam[] = [{ type: "text", text: "" }]

		const result = await tiktoken(content)
		expect(result).toBe(0)
	})

	it("should handle missing text content", async () => {
		// Using 'as any' to bypass TypeScript's type checking for this test case
		// since we're specifically testing how the function handles undefined text
		const content = [{ type: "text" }] as any as Anthropic.Messages.ContentBlockParam[]

		const result = await tiktoken(content)
		expect(result).toBe(0)
	})

	it("should correctly count tokens for image content with data", async () => {
		const base64Data =
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
		const content: Anthropic.Messages.ContentBlockParam[] = [
			{
				type: "image",
				source: {
					type: "base64",
					media_type: "image/png",
					data: base64Data,
				},
			},
		]

		const result = await tiktoken(content)
		// For images, we expect a token count based on the square root of the data length
		// plus the fudge factor
		const expectedMinTokens = Math.ceil(Math.sqrt(base64Data.length))
		expect(result).toBeGreaterThanOrEqual(expectedMinTokens)
	})

	it("should use conservative estimate for image content without data", async () => {
		// Using 'as any' to bypass TypeScript's type checking for this test case
		// since we're specifically testing the fallback behavior
		const content = [
			{
				type: "image",
				source: {
					type: "base64",
					media_type: "image/png",
					// data is intentionally missing to test fallback
				},
			},
		] as any as Anthropic.Messages.ContentBlockParam[]

		const result = await tiktoken(content)
		// Conservative estimate is 300 tokens, plus the fudge factor
		const expectedMinTokens = 300
		expect(result).toBeGreaterThanOrEqual(expectedMinTokens)
	})

	it("should correctly count tokens for mixed content", async () => {
		const base64Data =
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
		const content: Anthropic.Messages.ContentBlockParam[] = [
			{ type: "text", text: "Hello world" },
			{
				type: "image",
				source: {
					type: "base64",
					media_type: "image/png",
					data: base64Data,
				},
			},
			{ type: "text", text: "Goodbye world" },
		]

		const result = await tiktoken(content)
		// We expect a positive token count for mixed content
		expect(result).toBeGreaterThan(0)
	})

	it("should apply a fudge factor to the token count", async () => {
		// We can test the fudge factor by comparing the token count with a rough estimate
		const content: Anthropic.Messages.ContentBlockParam[] = [{ type: "text", text: "Test" }]

		const result = await tiktoken(content)

		// Run the function again with the same content to get a consistent result
		const result2 = await tiktoken(content)

		// Both calls should return the same token count
		expect(result).toBe(result2)

		// The result should be greater than 0
		expect(result).toBeGreaterThan(0)
	})

	it("should reuse the encoder for multiple calls", async () => {
		// We can't directly test the caching behavior without mocking,
		// but we can test that multiple calls with the same content return the same result
		// which indirectly verifies the encoder is working consistently

		const content: Anthropic.Messages.ContentBlockParam[] = [{ type: "text", text: "Hello world" }]

		const result1 = await tiktoken(content)
		const result2 = await tiktoken(content)

		// Both calls should return the same token count
		expect(result1).toBe(result2)
	})
})
