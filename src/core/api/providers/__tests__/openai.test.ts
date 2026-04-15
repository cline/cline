import "should"
import sinon from "sinon"
import { OpenAiHandler } from "../openai"

describe("OpenAiHandler", () => {
	afterEach(() => {
		sinon.restore()
	})

	const createAsyncIterable = (data: any[] = []) => ({
		[Symbol.asyncIterator]: async function* () {
			yield* data
		},
	})

	it("should read cache write tokens from cache_creation_input_tokens", async () => {
		const handler = new OpenAiHandler({
			openAiApiKey: "test-api-key",
			openAiBaseUrl: "https://ai-gateway.vercel.sh/v1",
			openAiModelId: "anthropic/claude-sonnet-4.6",
		})
		const fakeClient = {
			chat: {
				completions: {
					create: sinon.stub().resolves(
						createAsyncIterable([
							{
								choices: [{}],
								usage: {
									prompt_tokens: 90,
									completion_tokens: 6,
									cache_creation_input_tokens: 20,
									prompt_tokens_details: {
										cached_tokens: 60,
									},
								},
							},
						]),
					),
				},
			},
		}
		sinon.stub(handler as any, "ensureClient").returns(fakeClient as any)

		const chunks: any[] = []
		for await (const chunk of handler.createMessage("system", [{ role: "user", content: "hi" }])) {
			chunks.push(chunk)
		}

		chunks.should.deepEqual([
			{
				type: "usage",
				cacheWriteTokens: 20,
				cacheReadTokens: 60,
				inputTokens: 10,
				outputTokens: 6,
			},
		])
	})

	it("should add cache_control blocks for anthropic models on openrouter base URL", async () => {
		const createStub = sinon.stub().resolves(createAsyncIterable([]))
		const handler = new OpenAiHandler({
			openAiApiKey: "test-api-key",
			openAiBaseUrl: "https://openrouter.ai/api/v1",
			openAiModelId: "anthropic/claude-sonnet-4.6",
		})
		const fakeClient = {
			chat: {
				completions: {
					create: createStub,
				},
			},
		}
		sinon.stub(handler as any, "ensureClient").returns(fakeClient as any)

		for await (const _chunk of handler.createMessage("system", [{ role: "user", content: "hi" }])) {
			// drain stream
		}

		const payload = createStub.firstCall.args[0]
		const systemMessage = payload.messages[0]
		const userMessage = payload.messages.find((msg: any) => msg.role === "user")

		Array.isArray(systemMessage.content).should.equal(true)
		systemMessage.content[0].cache_control.should.deepEqual({ type: "ephemeral" })

		Array.isArray(userMessage.content).should.equal(true)
		const userLastTextPart = userMessage.content.filter((part: any) => part.type === "text").pop()
		userLastTextPart.cache_control.should.deepEqual({ type: "ephemeral" })
	})
})
