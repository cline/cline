import OpenAI from "openai"
import { Anthropic } from "@anthropic-ai/sdk"

import { LiteLLMHandler } from "../lite-llm"
import { ApiHandlerOptions } from "../../../shared/api"
import { litellmDefaultModelId, litellmDefaultModelInfo } from "@roo-code/types"

// Mock vscode first to avoid import errors
vi.mock("vscode", () => ({}))

// Mock OpenAI
vi.mock("openai", () => {
	const mockStream = {
		[Symbol.asyncIterator]: vi.fn(),
	}

	const mockCreate = vi.fn().mockReturnValue({
		withResponse: vi.fn().mockResolvedValue({ data: mockStream }),
	})

	return {
		default: vi.fn().mockImplementation(() => ({
			chat: {
				completions: {
					create: mockCreate,
				},
			},
		})),
	}
})

// Mock model fetching
vi.mock("../fetchers/modelCache", () => ({
	getModels: vi.fn().mockImplementation(() => {
		return Promise.resolve({
			[litellmDefaultModelId]: litellmDefaultModelInfo,
		})
	}),
}))

describe("LiteLLMHandler", () => {
	let handler: LiteLLMHandler
	let mockOptions: ApiHandlerOptions
	let mockOpenAIClient: any

	beforeEach(() => {
		vi.clearAllMocks()
		mockOptions = {
			litellmApiKey: "test-key",
			litellmBaseUrl: "http://localhost:4000",
			litellmModelId: litellmDefaultModelId,
		}
		handler = new LiteLLMHandler(mockOptions)
		mockOpenAIClient = new OpenAI()
	})

	describe("prompt caching", () => {
		it("should add cache control headers when litellmUsePromptCache is enabled", async () => {
			const optionsWithCache: ApiHandlerOptions = {
				...mockOptions,
				litellmUsePromptCache: true,
			}
			handler = new LiteLLMHandler(optionsWithCache)

			const systemPrompt = "You are a helpful assistant"
			const messages: Anthropic.Messages.MessageParam[] = [
				{ role: "user", content: "Hello" },
				{ role: "assistant", content: "Hi there!" },
				{ role: "user", content: "How are you?" },
			]

			// Mock the stream response
			const mockStream = {
				async *[Symbol.asyncIterator]() {
					yield {
						choices: [{ delta: { content: "I'm doing well!" } }],
						usage: {
							prompt_tokens: 100,
							completion_tokens: 50,
							cache_creation_input_tokens: 20,
							cache_read_input_tokens: 30,
						},
					}
				},
			}

			mockOpenAIClient.chat.completions.create.mockReturnValue({
				withResponse: vi.fn().mockResolvedValue({ data: mockStream }),
			})

			const generator = handler.createMessage(systemPrompt, messages)
			const results = []
			for await (const chunk of generator) {
				results.push(chunk)
			}

			// Verify that create was called with cache control headers
			const createCall = mockOpenAIClient.chat.completions.create.mock.calls[0][0]

			// Check system message has cache control in the proper format
			expect(createCall.messages[0]).toMatchObject({
				role: "system",
				content: [
					{
						type: "text",
						text: systemPrompt,
						cache_control: { type: "ephemeral" },
					},
				],
			})

			// Check that the last two user messages have cache control
			const userMessageIndices = createCall.messages
				.map((msg: any, idx: number) => (msg.role === "user" ? idx : -1))
				.filter((idx: number) => idx !== -1)

			const lastUserIdx = userMessageIndices[userMessageIndices.length - 1]
			const secondLastUserIdx = userMessageIndices[userMessageIndices.length - 2]

			// Check last user message has proper structure with cache control
			expect(createCall.messages[lastUserIdx]).toMatchObject({
				role: "user",
				content: [
					{
						type: "text",
						text: "How are you?",
						cache_control: { type: "ephemeral" },
					},
				],
			})

			// Check second last user message (first user message in this case)
			if (secondLastUserIdx !== -1) {
				expect(createCall.messages[secondLastUserIdx]).toMatchObject({
					role: "user",
					content: [
						{
							type: "text",
							text: "Hello",
							cache_control: { type: "ephemeral" },
						},
					],
				})
			}

			// Verify usage includes cache tokens
			const usageChunk = results.find((chunk) => chunk.type === "usage")
			expect(usageChunk).toMatchObject({
				type: "usage",
				inputTokens: 100,
				outputTokens: 50,
				cacheWriteTokens: 20,
				cacheReadTokens: 30,
			})
		})
	})
})
