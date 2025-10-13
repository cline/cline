import { Anthropic } from "@anthropic-ai/sdk"
import { expect } from "chai"
import { OpenAiHandler } from "../openai"

async function collectStream<T>(iter: AsyncGenerator<T, any, any>): Promise<T[]> {
	const out: T[] = []
	for await (const chunk of iter) out.push(chunk)
	return out
}

describe("OpenAiHandler retry-after precedence (gpt-5 Responses API)", () => {
	const systemPrompt = "You are a helpful assistant."
	const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Hello" }]

	it("honors provider Retry-After (429) before exponential backoff", async () => {
		let callCount = 0

		// Mock client where first call throws a 429-like error with Retry-After: 1s
		// Second call succeeds and streams a small response
		const mockClient = {
			responses: {
				create: async (args: any) => {
					callCount++
					if (callCount === 1) {
						const err: any = new Error("Rate limit exceeded")
						err.status = 429
						err.response = {
							headers: {
								"retry-after": "1", // seconds
							},
							data: {},
						}
						throw err
					}
					// Success path: return an async generator (stream)
					async function* gen() {
						yield { type: "response.output_text.delta", delta: "OK" }
						yield {
							response: {
								usage: {
									input_tokens: 5,
									output_tokens: 2,
								},
							},
						}
					}
					return gen()
				},
			},
		} as any

		const handler = new OpenAiHandler({
			openAiApiKey: "test",
			openAiModelId: "gpt-5-foobar",
			// Avoid preflight dwell impacting timing
			rateLimitRpm: 999999,
			rateLimitTpm: 99999999,
			rateLimitNearThreshold: 0.99,
		})
		;(handler as any).client = mockClient

		const t0 = Date.now()
		const chunks = await collectStream(handler.createMessage(systemPrompt, messages))
		const elapsed = Date.now() - t0

		// Should retry once and respect ~1s delay (allow headroom for CI jitter)
		expect(callCount).to.equal(2)
		expect(elapsed).to.be.gte(800)

		// Stream chunks should arrive after retry
		expect(chunks[0]).to.deep.equal({ type: "text", text: "OK" })
		expect(chunks[chunks.length - 1]).to.deep.equal({
			type: "usage",
			inputTokens: 5,
			outputTokens: 2,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		})
	})
})
