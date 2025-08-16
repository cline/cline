// npx vitest run api/providers/__tests__/native-ollama.spec.ts

import { NativeOllamaHandler } from "../native-ollama"
import { ApiHandlerOptions } from "../../../shared/api"

// Mock the ollama package
const mockChat = vitest.fn()
vitest.mock("ollama", () => {
	return {
		Ollama: vitest.fn().mockImplementation(() => ({
			chat: mockChat,
		})),
		Message: vitest.fn(),
	}
})

// Mock the getOllamaModels function
vitest.mock("../fetchers/ollama", () => ({
	getOllamaModels: vitest.fn().mockResolvedValue({
		llama2: {
			contextWindow: 4096,
			maxTokens: 4096,
			supportsImages: false,
			supportsPromptCache: false,
		},
	}),
}))

describe("NativeOllamaHandler", () => {
	let handler: NativeOllamaHandler

	beforeEach(() => {
		vitest.clearAllMocks()

		const options: ApiHandlerOptions = {
			apiModelId: "llama2",
			ollamaModelId: "llama2",
			ollamaBaseUrl: "http://localhost:11434",
		}

		handler = new NativeOllamaHandler(options)
	})

	describe("createMessage", () => {
		it("should stream messages from Ollama", async () => {
			// Mock the chat response as an async generator
			mockChat.mockImplementation(async function* () {
				yield {
					message: { content: "Hello" },
					eval_count: undefined,
					prompt_eval_count: undefined,
				}
				yield {
					message: { content: " world" },
					eval_count: 2,
					prompt_eval_count: 10,
				}
			})

			const systemPrompt = "You are a helpful assistant"
			const messages = [{ role: "user" as const, content: "Hi there" }]

			const stream = handler.createMessage(systemPrompt, messages)
			const results = []

			for await (const chunk of stream) {
				results.push(chunk)
			}

			expect(results).toHaveLength(3)
			expect(results[0]).toEqual({ type: "text", text: "Hello" })
			expect(results[1]).toEqual({ type: "text", text: " world" })
			expect(results[2]).toEqual({ type: "usage", inputTokens: 10, outputTokens: 2 })
		})

		it("should handle DeepSeek R1 models with reasoning detection", async () => {
			const options: ApiHandlerOptions = {
				apiModelId: "deepseek-r1",
				ollamaModelId: "deepseek-r1",
				ollamaBaseUrl: "http://localhost:11434",
			}

			handler = new NativeOllamaHandler(options)

			// Mock response with thinking tags
			mockChat.mockImplementation(async function* () {
				yield { message: { content: "<think>Let me think" } }
				yield { message: { content: " about this</think>" } }
				yield { message: { content: "The answer is 42" } }
			})

			const stream = handler.createMessage("System", [{ role: "user" as const, content: "Question?" }])
			const results = []

			for await (const chunk of stream) {
				results.push(chunk)
			}

			// Should detect reasoning vs regular text
			expect(results.some((r) => r.type === "reasoning")).toBe(true)
			expect(results.some((r) => r.type === "text")).toBe(true)
		})
	})

	describe("completePrompt", () => {
		it("should complete a prompt without streaming", async () => {
			mockChat.mockResolvedValue({
				message: { content: "This is the response" },
			})

			const result = await handler.completePrompt("Tell me a joke")

			expect(mockChat).toHaveBeenCalledWith({
				model: "llama2",
				messages: [{ role: "user", content: "Tell me a joke" }],
				stream: false,
				options: {
					temperature: 0,
				},
			})
			expect(result).toBe("This is the response")
		})
	})

	describe("error handling", () => {
		it("should handle connection refused errors", async () => {
			const error = new Error("ECONNREFUSED") as any
			error.code = "ECONNREFUSED"
			mockChat.mockRejectedValue(error)

			const stream = handler.createMessage("System", [{ role: "user" as const, content: "Test" }])

			await expect(async () => {
				for await (const _ of stream) {
					// consume stream
				}
			}).rejects.toThrow("Ollama service is not running")
		})

		it("should handle model not found errors", async () => {
			const error = new Error("Not found") as any
			error.status = 404
			mockChat.mockRejectedValue(error)

			const stream = handler.createMessage("System", [{ role: "user" as const, content: "Test" }])

			await expect(async () => {
				for await (const _ of stream) {
					// consume stream
				}
			}).rejects.toThrow("Model llama2 not found in Ollama")
		})
	})

	describe("getModel", () => {
		it("should return the configured model", () => {
			const model = handler.getModel()
			expect(model.id).toBe("llama2")
			expect(model.info).toBeDefined()
		})
	})
})
