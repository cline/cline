import { afterEach, describe, it } from "mocha"
import sinon from "sinon"
import "should"
import type { ClineStorageMessage } from "@shared/messages/content"
import { OpenAiHandler } from "../openai"

interface OpenAiRequestPayload {
	model: string
	temperature?: number
	max_tokens: number | undefined
	messages: any[]
	stream: boolean
}

describe("OpenAiHandler kimi-k2 temperature", () => {
	afterEach(() => {
		sinon.restore()
	})

	const createAsyncIterable = (data: unknown[] = []): AsyncIterable<unknown> => ({
		[Symbol.asyncIterator]: async function* () {
			yield* data
		},
	})

	it("should override temperature to 1 for kimi-k2 on moonshot.ai endpoint", async () => {
		const handler = new OpenAiHandler({
			openAiApiKey: "test-api-key",
			openAiBaseUrl: "https://api.moonshot.ai/v1",
			openAiModelId: "kimi-k2",
		})

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

		const payload = createStub.firstCall.args[0] as OpenAiRequestPayload
		payload.temperature!.should.equal(1)
	})

	it("should override temperature to 1 for kimi-k2 even with explicit user config", async () => {
		const handler = new OpenAiHandler({
			openAiApiKey: "test-api-key",
			openAiBaseUrl: "https://api.moonshot.ai/v1",
			openAiModelId: "kimi-k2",
			openAiModelInfo: {
				temperature: 0.5,
				maxTokens: 4096,
			} as any,
		})

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

		const payload = createStub.firstCall.args[0] as OpenAiRequestPayload
		payload.temperature!.should.equal(1)
	})

	it("should not override temperature for kimi-k2 on non-moonshot endpoints", async () => {
		const handler = new OpenAiHandler({
			openAiApiKey: "test-api-key",
			openAiBaseUrl: "https://api.openai.com/v1",
			openAiModelId: "kimi-k2",
			openAiModelInfo: {
				temperature: 0.7,
				maxTokens: 4096,
			} as any,
		})

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

		const payload = createStub.firstCall.args[0] as OpenAiRequestPayload
		payload.temperature!.should.equal(0.7)
	})

	it("should not override temperature for non-kimi models on moonshot.ai endpoint", async () => {
		const handler = new OpenAiHandler({
			openAiApiKey: "test-api-key",
			openAiBaseUrl: "https://api.moonshot.ai/v1",
			openAiModelId: "gpt-4",
			openAiModelInfo: {
				temperature: 0.7,
				maxTokens: 4096,
			} as any,
		})

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

		const payload = createStub.firstCall.args[0] as OpenAiRequestPayload
		payload.temperature!.should.equal(0.7)
	})
})
