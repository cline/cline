/**
 * Tests for ModelsLabHandler
 *
 * Run:  npx jest src/core/api/providers/__tests__/modelslab.test.ts
 */

import { ModelsLabHandler } from "../modelslab"
import { modelsLabDefaultModelId, modelsLabModels } from "@shared/api"

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCreate = jest.fn()

jest.mock("@/shared/net", () => ({
	createOpenAIClient: jest.fn().mockReturnValue({
		chat: {
			completions: {
				create: mockCreate,
			},
		},
	}),
}))

jest.mock("../retry", () => ({
	withRetry: () => (_target: any, _key: string, descriptor: PropertyDescriptor) => descriptor,
}))

const MOCK_API_KEY = "ml-test-key-123"
const MOCK_SYSTEM = "You are a helpful assistant."
const MOCK_MESSAGES = [{ role: "user" as const, content: "Hello" }]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHandler(modelId?: string) {
	return new ModelsLabHandler({
		modelsLabApiKey: MOCK_API_KEY,
		modelsLabModelId: modelId,
	})
}

function makeAsyncStream(chunks: object[]) {
	return {
		[Symbol.asyncIterator]: async function* () {
			for (const chunk of chunks) {
				yield chunk
			}
		},
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ModelsLabHandler", () => {
	beforeEach(() => {
		jest.clearAllMocks()
	})

	// -------------------------------------------------------------------------
	// Constructor & getModel
	// -------------------------------------------------------------------------

	describe("getModel()", () => {
		it("returns the default model when no modelId is provided", () => {
			const handler = makeHandler()
			const { id, info } = handler.getModel()
			expect(id).toBe(modelsLabDefaultModelId)
			expect(info).toEqual(modelsLabModels[modelsLabDefaultModelId])
		})

		it("returns the specified model when a valid modelId is provided", () => {
			const handler = makeHandler("llama-3.1-70b-uncensored")
			const { id, info } = handler.getModel()
			expect(id).toBe("llama-3.1-70b-uncensored")
			expect(info).toEqual(modelsLabModels["llama-3.1-70b-uncensored"])
		})

		it("falls back to default model info for unknown model IDs", () => {
			const handler = makeHandler("unknown-model")
			const { id, info } = handler.getModel()
			expect(id).toBe("unknown-model")
			expect(info).toEqual(modelsLabModels[modelsLabDefaultModelId])
		})
	})

	// -------------------------------------------------------------------------
	// Client initialization
	// -------------------------------------------------------------------------

	describe("ensureClient()", () => {
		it("throws when API key is missing", async () => {
			const handler = new ModelsLabHandler({ modelsLabApiKey: undefined })
			const gen = handler.createMessage(MOCK_SYSTEM, MOCK_MESSAGES)
			await expect(gen.next()).rejects.toThrow(/ModelsLab API key is required/)
		})

		it("uses the ModelsLab base URL", async () => {
			const { createOpenAIClient } = require("@/shared/net")
			mockCreate.mockReturnValueOnce(makeAsyncStream([]))

			const handler = makeHandler()
			const gen = handler.createMessage(MOCK_SYSTEM, MOCK_MESSAGES)
			await gen.next()

			expect(createOpenAIClient).toHaveBeenCalledWith(
				expect.objectContaining({
					baseURL: "https://modelslab.com/api/uncensored-chat/v1",
					apiKey: MOCK_API_KEY,
				}),
			)
		})
	})

	// -------------------------------------------------------------------------
	// createMessage streaming
	// -------------------------------------------------------------------------

	describe("createMessage()", () => {
		it("yields text chunks from the stream", async () => {
			mockCreate.mockReturnValueOnce(
				makeAsyncStream([
					{ choices: [{ delta: { content: "Hello" } }] },
					{ choices: [{ delta: { content: " World" } }] },
				]),
			)

			const handler = makeHandler()
			const chunks: any[] = []
			for await (const chunk of handler.createMessage(MOCK_SYSTEM, MOCK_MESSAGES)) {
				chunks.push(chunk)
			}

			expect(chunks).toContainEqual({ type: "text", text: "Hello" })
			expect(chunks).toContainEqual({ type: "text", text: " World" })
		})

		it("yields usage chunk when usage data is present", async () => {
			mockCreate.mockReturnValueOnce(
				makeAsyncStream([
					{ choices: [{ delta: { content: "Hi" } }], usage: { prompt_tokens: 50, completion_tokens: 10 } },
				]),
			)

			const handler = makeHandler()
			const chunks: any[] = []
			for await (const chunk of handler.createMessage(MOCK_SYSTEM, MOCK_MESSAGES)) {
				chunks.push(chunk)
			}

			expect(chunks).toContainEqual({ type: "usage", inputTokens: 50, outputTokens: 10 })
		})

		it("calls create with the correct model and streaming params", async () => {
			mockCreate.mockReturnValueOnce(makeAsyncStream([]))

			const handler = makeHandler("llama-3.1-70b-uncensored")
			const gen = handler.createMessage(MOCK_SYSTEM, MOCK_MESSAGES)
			await gen.next()

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					model: "llama-3.1-70b-uncensored",
					stream: true,
					temperature: 0,
				}),
			)
		})

		it("includes system prompt as first message", async () => {
			mockCreate.mockReturnValueOnce(makeAsyncStream([]))

			const handler = makeHandler()
			const gen = handler.createMessage("System instructions.", MOCK_MESSAGES)
			await gen.next()

			const callArgs = mockCreate.mock.calls[0][0]
			expect(callArgs.messages[0]).toEqual({ role: "system", content: "System instructions." })
		})
	})

	// -------------------------------------------------------------------------
	// Model registry constants
	// -------------------------------------------------------------------------

	describe("modelsLabModels registry", () => {
		it("has the default model", () => {
			expect(modelsLabModels).toHaveProperty(modelsLabDefaultModelId)
		})

		it("includes both Llama 3.1 variants", () => {
			expect(modelsLabModels).toHaveProperty("llama-3.1-8b-uncensored")
			expect(modelsLabModels).toHaveProperty("llama-3.1-70b-uncensored")
		})

		it("each model has a 128K context window", () => {
			for (const [id, info] of Object.entries(modelsLabModels)) {
				expect(info.contextWindow).toBeGreaterThanOrEqual(128_000)
			}
		})
	})
})
