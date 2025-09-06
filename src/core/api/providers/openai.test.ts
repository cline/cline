import { Anthropic } from "@anthropic-ai/sdk"
import { expect } from "chai"
import { OpenAiHandler } from "./openai"

async function collectStream<T>(iter: AsyncGenerator<T, any, any>): Promise<T[]> {
	const out: T[] = []
	for await (const chunk of iter) out.push(chunk)
	return out
}

describe("OpenAiHandler.createMessage", () => {
	const systemPrompt = "You are a helpful assistant."
	const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Hello" }]

	it("routes gpt-5 models to Responses API and streams text, reasoning and usage", async () => {
		// Arrange: mock OpenAI client with responses.create stream
		const calls: any[] = []
		const mockClient = {
			responses: {
				// This async generator simulates the Responses API streaming shape
				create: async function* (args: any) {
					calls.push(args)
					// text delta
					yield { type: "response.output_text.delta", delta: "Hi " }
					// reasoning content attached to a delta event
					yield { type: "response.output_text.delta", delta: "there", reasoning_content: "thinking..." }
					// usage via response.usage
					yield {
						response: {
							usage: {
								input_tokens: 11,
								output_tokens: 7,
								cache_read_input_tokens: 2,
								cache_creation_input_tokens: 1,
							},
						},
					}
				},
			},
		} as any

		const handler = new OpenAiHandler({
			openAiApiKey: "test",
			openAiModelId: "gpt-5.0-mini",
			openAiModelInfo: { temperature: 0.2 } as any,
			reasoningEffort: "high",
		})
		// Inject mock client to bypass network and ensure Responses path
		;(handler as any).client = mockClient

		// Act
		const stream = handler.createMessage(systemPrompt, messages)
		const chunks = await collectStream(stream)

		// Assert: called with expected args
		expect(calls).to.have.length(1)
		expect(calls[0].model).to.equal("gpt-5.0-mini")
		expect(calls[0].stream).to.equal(true)
		// Provider may append batching or meta instructions for Responses API; assert it preserves the leading system prompt.
		expect(calls[0].instructions).to.be.a("string")
		expect((calls[0].instructions as string).startsWith(systemPrompt)).to.equal(true)
		expect(calls[0].reasoning).to.deep.equal({ effort: "high" })
		expect(calls[0].input).to.be.an("array") // converted via convertToOpenAiResponseInput

		// Assert: emitted expected chunk types in order
		expect(chunks[0]).to.deep.equal({ type: "text", text: "Hi " })
		expect(chunks[1]).to.deep.equal({ type: "text", text: "there" })
		expect(chunks[2]).to.deep.equal({ type: "reasoning", reasoning: "thinking..." })
		expect(chunks[3]).to.deep.equal({
			type: "usage",
			inputTokens: 11,
			outputTokens: 7,
			cacheReadTokens: 2,
			cacheWriteTokens: 1,
		})
	})

	it("routes non-gpt-5 models to chat.completions and streams text, reasoning_content and usage", async () => {
		// Arrange: mock OpenAI client with chat.completions.create stream
		const calls: any[] = []
		const mockClient = {
			chat: {
				completions: {
					create: async function* (args: any) {
						calls.push(args)
						// text delta
						yield { choices: [{ delta: { content: "Hello " } }] }
						// reasoning_content on delta
						yield { choices: [{ delta: { reasoning_content: "explain..." } }] }
						// usage on chunk
						yield {
							usage: {
								prompt_tokens: 12,
								completion_tokens: 6,
								prompt_tokens_details: { cached_tokens: 3 },
								prompt_cache_miss_tokens: 2,
							},
						}
					},
				},
			},
		} as any

		const handler = new OpenAiHandler({
			openAiApiKey: "test",
			openAiModelId: "gpt-4o-mini",
			openAiModelInfo: { temperature: 0.4 } as any,
		})
		;(handler as any).client = mockClient

		// Act
		const stream = handler.createMessage(systemPrompt, messages)
		const chunks = await collectStream(stream)

		// Assert: called with expected args
		expect(calls).to.have.length(1)
		expect(calls[0].model).to.equal("gpt-4o-mini")
		expect(calls[0].stream).to.equal(true)
		expect(calls[0].messages).to.be.an("array")
		expect(calls[0].messages[0]).to.deep.equal({ role: "system", content: systemPrompt })

		// Assert: emitted chunk types
		expect(chunks[0]).to.deep.equal({ type: "text", text: "Hello " })
		expect(chunks[1]).to.deep.equal({ type: "reasoning", reasoning: "explain..." })
		expect(chunks[2]).to.deep.equal({
			type: "usage",
			inputTokens: 12,
			outputTokens: 6,
			cacheReadTokens: 3,
			cacheWriteTokens: 2,
		})
	})
})
