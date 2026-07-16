import "should"
import type OpenAI from "openai"
import sinon from "sinon"
import type { ApiStreamChunk } from "../../transform/stream"
import { OpenAiHandler } from "../openai"

describe("OpenAiHandler", () => {
	afterEach(() => {
		sinon.restore()
	})

	const createAsyncIterable = (data: unknown[] = []) => ({
		[Symbol.asyncIterator]: async function* () {
			yield* data
		},
	})

	const createHandler = (chunks: unknown[]) => {
		const handler = new OpenAiHandler({
			openAiApiKey: "test-api-key",
			openAiModelId: "test-model",
		})
		const fakeClient = {
			chat: {
				completions: {
					create: sinon.stub().resolves(createAsyncIterable(chunks)),
				},
			},
		}
		sinon.stub(handler as unknown as { ensureClient: () => OpenAI }, "ensureClient").returns(fakeClient as unknown as OpenAI)
		return handler
	}

	it("should emit the latest cumulative usage snapshot only once", async () => {
		const handler = createHandler([
			{
				choices: [{ delta: { content: "O" } }],
				usage: {
					prompt_tokens: 48,
					completion_tokens: 1,
					total_tokens: 49,
					prompt_tokens_details: { cached_tokens: 32 },
				},
			},
			{
				choices: [{ delta: { content: "K" } }],
				usage: {
					prompt_tokens: 48,
					completion_tokens: 2,
					total_tokens: 50,
					prompt_tokens_details: { cached_tokens: 32 },
				},
			},
			{ choices: [{ delta: {}, finish_reason: "stop" }], usage: null },
		])

		const chunks: ApiStreamChunk[] = []
		for await (const chunk of handler.createMessage("system", [{ role: "user", content: "hi" }])) {
			chunks.push(chunk)
		}

		chunks.should.deepEqual([
			{ type: "text", text: "O" },
			{ type: "text", text: "K" },
			{
				type: "usage",
				inputTokens: 48,
				outputTokens: 2,
				cacheReadTokens: 32,
				cacheWriteTokens: 0,
			},
		])
	})

	it("should preserve providers that emit usage only on the final chunk", async () => {
		const handler = createHandler([
			{ choices: [{ delta: { content: "OK" } }] },
			{
				choices: [],
				usage: {
					prompt_tokens: 17,
					completion_tokens: 9,
					total_tokens: 26,
				},
			},
		])

		const chunks: ApiStreamChunk[] = []
		for await (const chunk of handler.createMessage("system", [{ role: "user", content: "hi" }])) {
			chunks.push(chunk)
		}

		chunks.should.deepEqual([
			{ type: "text", text: "OK" },
			{
				type: "usage",
				inputTokens: 17,
				outputTokens: 9,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			},
		])
	})
})
