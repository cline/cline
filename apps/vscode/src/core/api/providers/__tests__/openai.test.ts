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

	it("should deduplicate usage chunks when multiple chunk.usage objects are emitted", async () => {
		const handler = new OpenAiHandler({
			openAiApiKey: "test-api-key",
			openAiModelId: "gpt-4o",
		})

		const fakeClient = {
			chat: {
				completions: {
					create: sinon.stub().resolves(
						createAsyncIterable([
							{
								choices: [
									{
										delta: {
											content: "Hello",
										},
									},
								],
								usage: {
									prompt_tokens: 10,
									completion_tokens: 5,
									prompt_tokens_details: {},
								},
							},
							{
								choices: [
									{
										delta: {
											content: " world",
										},
									},
								],
								usage: {
									prompt_tokens: 10,
									completion_tokens: 5,
									prompt_tokens_details: {},
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

		// Filter to only usage chunks
		const usageChunks = chunks.filter((c: any) => c.type === "usage")

		// Should have exactly one usage chunk despite two usage objects in stream
		usageChunks.should.have.length(1)

		// Token values should match the first usage object
		usageChunks[0].inputTokens.should.equal(10)
		usageChunks[0].outputTokens.should.equal(5)
	})

	it("should emit a single usage chunk when only one usage object is provided", async () => {
		const handler = new OpenAiHandler({
			openAiApiKey: "test-api-key",
			openAiModelId: "gpt-4o",
		})

		const fakeClient = {
			chat: {
				completions: {
					create: sinon.stub().resolves(
						createAsyncIterable([
							{
								choices: [
									{
										delta: {
											content: "Hello world",
										},
									},
								],
								usage: {
									prompt_tokens: 10,
									completion_tokens: 5,
									prompt_tokens_details: {},
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

		// Filter to only usage chunks
		const usageChunks = chunks.filter((c: any) => c.type === "usage")

		// Should have exactly one usage chunk
		usageChunks.should.have.length(1)

		// Token values should match
		usageChunks[0].inputTokens.should.equal(10)
		usageChunks[0].outputTokens.should.equal(5)
	})
})
