import { LiteLlmHandler, type LiteLlmModelInfoResponse } from "@core/api/providers/litellm"
import { convertToOpenAiMessages } from "@core/api/transform/openai-format"
import { expect } from "chai"
import sinon from "sinon"
import { ClineStorageMessage } from "@/shared/messages/content"
import { mockFetchForTesting } from "@/shared/net"

const fakeClient = {
	chat: {
		completions: {
			create: sinon.stub(),
		},
	},
	baseURL: "https://fake.example",
}

describe("LiteLlmHandler", () => {
	const mockFetch = sinon.stub()
	let doneMockingFetch: (value: any) => void = () => {}

	const mockModelFetch = (modelInfo: LiteLlmModelInfoResponse["data"][number]) => {
		mockFetch.resolves({
			ok: true,
			json: () =>
				Promise.resolve({
					data: [modelInfo],
				}),
		})
	}

	let handler: LiteLlmHandler

	const mockHandlerChat = () => {
		sinon.stub(handler, "ensureClient" as any).returns(fakeClient)
	}

	const initializeHandler = (model: string) => {
		handler = new LiteLlmHandler({
			liteLlmApiKey: "test-api-key",
			liteLlmBaseUrl: "http://localhost:4000",
			liteLlmUsePromptCache: true,
			liteLlmModelId: model,
		})

		mockHandlerChat()
	}

	beforeEach(() => {
		mockFetchForTesting(mockFetch, () => {
			return new Promise((resolve) => {
				doneMockingFetch = resolve
			})
		})

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
	})

	afterEach(() => {
		sinon.reset()
		doneMockingFetch(void 0)
	})

	const createAsyncIterable = (data: any[] = []) => {
		return {
			[Symbol.asyncIterator]: async function* () {
				yield* data
			},
		}
	}

	describe("prompt cache", () => {
		const setModelData = (model: string, supportsPromptCaching: boolean) => {
			mockModelFetch({
				model_name: model,
				litellm_params: {
					model,
				},
				model_info: {
					supports_prompt_caching: supportsPromptCaching,
					input_cost_per_token: 0.01,
					output_cost_per_token: 0.02,
				},
			})
		}

		describe("when the model doesn't support prompt caching", () => {
			const model = "openai/gpt-5"

			beforeEach(() => {
				initializeHandler(model)
				setModelData(model, false)
			})

			it("sends the system prompt and messages with the openai format", async () => {
				const systemPrompt = "Test System Prompt"
				const messages: ClineStorageMessage[] = [
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

				for await (const _ of handler.createMessage(systemPrompt, messages)) {
				}

				sinon.assert.calledOnce(fakeClient.chat.completions.create)

				const callArgs = fakeClient.chat.completions.create.getCall(0).args[0]

				const systemPromptMessage = callArgs.messages.shift()
				expect(systemPromptMessage).to.deep.equal({
					role: "system",
					content: systemPrompt,
				})

				expect(callArgs.messages).to.deep.equal(convertToOpenAiMessages(messages))
			})
		})

		describe("when the model supports prompt caching", () => {
			const model = "anthropic/claude-sonnet-4-20250514"

			beforeEach(() => {
				initializeHandler(model)

				setModelData(model, true)
			})

			it("inserts the cache control in the system prompt and the last two user messages", async () => {
				const systemPrompt = "Test System Prompt"
				const messages: ClineStorageMessage[] = [
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

				for await (const _ of handler.createMessage(systemPrompt, messages)) {
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
