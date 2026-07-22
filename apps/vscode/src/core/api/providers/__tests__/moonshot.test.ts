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

	it("supports kimi-k3 request requirements and scopes reasoning replay", async () => {
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
			{ role: "user", content: "foreign-provider question" },
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "Foreign reasoning", signature: "" },
					{ type: "text", text: "Foreign answer" },
				],
				modelInfo: { providerId: "anthropic", modelId: "claude-sonnet-4", mode: "act" },
			},
			{ role: "user", content: "K3 question" },
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "K3 reasoning", signature: "" },
					{ type: "text", text: "K3 answer" },
				],
				modelInfo: { providerId: "moonshot", modelId: "kimi-k3", mode: "act" },
			},
			{ role: "user", content: "legacy question" },
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "Unattributed reasoning", signature: "" },
					{ type: "text", text: "Legacy answer" },
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
		const assistantReasoning = payload.messages
			?.filter((message) => message.role === "assistant")
			.map((message) => message.reasoning_content)
		should(assistantReasoning).deepEqual([undefined, "K3 reasoning", undefined])
	})
})
