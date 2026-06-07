import "should"
import { moonshotModels } from "@shared/api"
import type { ClineStorageMessage } from "@shared/messages/content"
import sinon from "sinon"
import { MoonshotHandler } from "../moonshot"

interface MoonshotRequestPayload {
	model: string
	temperature: number
	max_tokens: number
}

describe("MoonshotHandler", () => {
	afterEach(() => {
		sinon.restore()
	})

	const createAsyncIterable = (data: unknown[] = []): AsyncIterable<unknown> => ({
		[Symbol.asyncIterator]: async function* () {
			yield* data
		},
	})

	it("supports kimi-k2.6 model metadata", async () => {
		const handler = new MoonshotHandler({
			moonshotApiKey: "test-api-key",
			apiModelId: "kimi-k2.6",
		})

		const model = handler.getModel()
		model.id.should.equal("kimi-k2.6")
		model.info.should.deepEqual(moonshotModels["kimi-k2.6"])

		const createStub = sinon.stub().resolves(createAsyncIterable([]))
		sinon.stub(handler as unknown as { ensureClient: () => unknown }, "ensureClient").returns({
			chat: {
				completions: {
					create: createStub,
				},
			},
		})

		const messages: ClineStorageMessage[] = [{ role: "user", content: "hi" }]
		for await (const _chunk of handler.createMessage("system", messages)) {
			// Consume stream to trigger request execution.
		}

		const payload = createStub.firstCall.args[0] as MoonshotRequestPayload
		payload.model.should.equal("kimi-k2.6")
		payload.temperature.should.equal(moonshotModels["kimi-k2.6"].temperature)
		payload.max_tokens.should.equal(moonshotModels["kimi-k2.6"].maxTokens)
	})
})
