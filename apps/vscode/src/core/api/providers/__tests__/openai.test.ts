import { OpenAiHandler } from "@core/api/providers/openai"
import { expect } from "chai"
import sinon from "sinon"
import { ClineStorageMessage } from "@/shared/messages/content"

const fakeClient = {
	chat: {
		completions: {
			create: sinon.stub(),
		},
	},
}

describe("OpenAiHandler", () => {
	const createAsyncIterable = (data: unknown[] = []) => {
		return {
			[Symbol.asyncIterator]: async function* () {
				yield* data
			},
		}
	}

	afterEach(() => {
		sinon.restore()
		fakeClient.chat.completions.create.reset()
	})

	it("normalizes OpenAI-compatible usage to non-cached input tokens", async () => {
		fakeClient.chat.completions.create.resolves(
			createAsyncIterable([
				{
					choices: [{ delta: { content: "test response" } }],
				},
				{
					choices: [{}],
					usage: {
						prompt_tokens: 100,
						completion_tokens: 50,
						prompt_tokens_details: {
							cached_tokens: 10,
						},
						prompt_cache_miss_tokens: 20,
					},
				},
			]),
		)

		const handler = new OpenAiHandler({
			openAiApiKey: "test-api-key",
			openAiModelId: "claude-sonnet-via-compatible-api",
		})
		sinon.stub(handler as unknown as { ensureClient: () => typeof fakeClient }, "ensureClient").returns(fakeClient)

		const messages: ClineStorageMessage[] = [{ role: "user", content: "hello" }]
		const chunks = []

		for await (const chunk of handler.createMessage("Test System Prompt", messages)) {
			chunks.push(chunk)
		}

		const usage = chunks.find((chunk) => chunk.type === "usage")
		expect(usage).to.include({
			type: "usage",
			inputTokens: 70,
			outputTokens: 50,
			cacheWriteTokens: 20,
			cacheReadTokens: 10,
		})
	})
})
