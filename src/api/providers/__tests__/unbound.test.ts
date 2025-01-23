import { UnboundHandler } from "../unbound"
import { ApiHandlerOptions } from "../../../shared/api"
import fetchMock from "jest-fetch-mock"

fetchMock.enableMocks()

describe("UnboundHandler", () => {
	const mockOptions: ApiHandlerOptions = {
		unboundApiKey: "test-api-key",
		apiModelId: "test-model-id",
	}

	beforeEach(() => {
		fetchMock.resetMocks()
	})

	it("should initialize with options", () => {
		const handler = new UnboundHandler(mockOptions)
		expect(handler).toBeDefined()
	})

	it("should create a message successfully", async () => {
		const handler = new UnboundHandler(mockOptions)
		const mockResponse = {
			choices: [{ message: { content: "Hello, world!" } }],
			usage: { prompt_tokens: 5, completion_tokens: 7 },
		}

		fetchMock.mockResponseOnce(JSON.stringify(mockResponse))

		const generator = handler.createMessage("system prompt", [])
		const textResult = await generator.next()
		const usageResult = await generator.next()

		expect(textResult.value).toEqual({ type: "text", text: "Hello, world!" })
		expect(usageResult.value).toEqual({
			type: "usage",
			inputTokens: 5,
			outputTokens: 7,
		})
	})

	it("should handle API errors", async () => {
		const handler = new UnboundHandler(mockOptions)
		fetchMock.mockResponseOnce(JSON.stringify({ error: "API error" }), { status: 400 })

		const generator = handler.createMessage("system prompt", [])
		await expect(generator.next()).rejects.toThrow("Unbound Gateway completion error: API error")
	})

	it("should handle network errors", async () => {
		const handler = new UnboundHandler(mockOptions)
		fetchMock.mockRejectOnce(new Error("Network error"))

		const generator = handler.createMessage("system prompt", [])
		await expect(generator.next()).rejects.toThrow("Unbound Gateway completion error: Network error")
	})

	it("should return the correct model", () => {
		const handler = new UnboundHandler(mockOptions)
		const model = handler.getModel()
		expect(model.id).toBe("gpt-4o")
	})
})
