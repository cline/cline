import "should"
import { moonshotModels } from "@shared/api"
import type { ClineStorageMessage } from "@shared/messages/content"
import sinon from "sinon"
import { MoonshotHandler } from "../moonshot"

interface MoonshotRequestPayload {
	model: string
	messages?: Array<{ role: string; reasoning_content?: string }>
	temperature?: number
	max_tokens?: number
	max_completion_tokens?: number
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
		should(payload.temperature).equal(moonshotModels["kimi-k2.6"].temperature)
		should(payload.max_tokens).equal(moonshotModels["kimi-k2.6"].maxTokens)
	})

	it("supports kimi-k3 with its required request parameters", async () => {
		const handler = new MoonshotHandler({
			moonshotApiKey: "test-api-key",
			apiModelId: "kimi-k3",
		})

		const createStub = sinon.stub().resolves(createAsyncIterable([]))
		sinon.stub(handler as unknown as { ensureClient: () => unknown }, "ensureClient").returns({
			chat: {
				completions: {
					create: createStub,
				},
			},
		})

		const messages: ClineStorageMessage[] = [
			{ role: "user", content: "first question" },
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "Previous reasoning", signature: "" },
					{ type: "text", text: "First answer" },
				],
			},
			{ role: "user", content: "follow-up question" },
		]
		for await (const _chunk of handler.createMessage("system", messages)) {
			// Consume stream to trigger request execution.
		}

		const payload = createStub.firstCall.args[0] as MoonshotRequestPayload
		payload.model.should.equal("kimi-k3")
		should(payload.max_completion_tokens).equal(moonshotModels["kimi-k3"].maxTokens)
		should(payload.max_tokens).equal(undefined)
		should(payload.temperature).equal(undefined)
		const assistantMessage = payload.messages?.find((message) => message.role === "assistant")
		should(assistantMessage?.reasoning_content).equal("Previous reasoning")
	})
})
