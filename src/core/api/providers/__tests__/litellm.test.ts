import Anthropic from "@anthropic-ai/sdk"
import { expect } from "chai"
import proxyquire from "proxyquire"
import sinon from "sinon"
import { type LiteLlmModelInfoResponse } from "../litellm"

const fakeClient = {
	chat: {
		completions: {
			create: sinon.stub(),
		},
	},
}

class FakeOpenAI {
	chat = fakeClient.chat
	baseURL = "test"
	constructor() {}
}

const { LiteLlmHandler } = proxyquire("../litellm", {
	openai: FakeOpenAI,
})

describe("LiteLlmHandler", () => {
	const originalFetch = global.fetch
	const mockFetch = sinon.stub()
	const mockModelFetch = (modelInfo: LiteLlmModelInfoResponse["data"][number]) => {
		mockFetch.resolves({
			ok: true,
			json: () =>
				Promise.resolve({
					data: [modelInfo],
				}),
		})
	}

	beforeEach(() => {
		global.fetch = mockFetch
	})

	afterEach(() => {
		sinon.restore()
		global.fetch = originalFetch
	})

	const createAsyncIterable = (data: any[] = []) => {
		return {
			[Symbol.asyncIterator]: async function* () {
				yield* data
			},
		}
	}

	describe("prompt cache", () => {
		describe("when the model supports prompt cache", () => {
			const model = "anthropic/claude-sonnet-4-20250514"

			beforeEach(() => {
				mockModelFetch({
					model_name: model,
					litellm_params: {
						model,
					},
					model_info: {
						supports_prompt_caching: true,
						input_cost_per_token: 0.01,
						output_cost_per_token: 0.02,
					},
				})
			})

			it("inserts the cache control in the system prompt and the last two user messages", async () => {
				// Configure the stub to return a stream that closes immediately with usage data
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
								cache_creation_input_tokens: 20,
								cache_read_input_tokens: 10,
							},
						},
					]),
				)

				const handlerWithCache = new LiteLlmHandler({
					liteLlmApiKey: "test-api-key",
					liteLlmBaseUrl: "http://localhost:4000",
					liteLlmUsePromptCache: true,
					liteLlmModelId: model,
				})

				const systemPrompt = "Test System Prompt"
				const messages: Anthropic.Messages.MessageParam[] = [
					{
						role: "user",
						content: "first message",
					},
					{
						role: "assistant",
						content: "first response",
					},
					{
						role: "user",
						content: [
							{
								type: "text",
								text: "test",
							},
							{
								type: "text",
								text: "second message",
							},
						],
					},
				]

				for await (const _ of handlerWithCache.createMessage(systemPrompt, messages)) {
				}

				sinon.assert.calledOnce(fakeClient.chat.completions.create)

				const callArgs = fakeClient.chat.completions.create.getCall(0).args[0]

				expect(callArgs.messages[0]).to.deep.equal({
					role: "system",
					content: [
						{
							text: systemPrompt,
							type: "text",
							cache_control: {
								type: "ephemeral",
							},
						},
					],
				})

				const sentMessages = callArgs.messages
				expect(sentMessages.length).to.equal(4)

				const firstUserMessage = sentMessages[1]

				expect(firstUserMessage).to.deep.equal({
					role: "user",
					content: [
						{
							type: "text",
							text: "first message",
							cache_control: {
								type: "ephemeral",
							},
						},
					],
				})

				const lastUserMessage = sentMessages[3]
				expect(lastUserMessage.content[0]).to.deep.equal({
					type: "text",
					text: "test",
				})

				const lastContentBlock = lastUserMessage.content[lastUserMessage.content.length - 1]
				expect(lastContentBlock).to.deep.equal({
					type: "text",
					text: "second message",
					cache_control: {
						type: "ephemeral",
					},
				})

				expect(callArgs.model).to.be.a("string")
				expect(callArgs.stream).to.equal(true)
				expect(callArgs.stream_options).to.deep.equal({ include_usage: true })
			})
		})
	})
})
