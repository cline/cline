// npx vitest run api/providers/__tests__/ollama-timeout.spec.ts

import { OllamaHandler } from "../ollama"
import { ApiHandlerOptions } from "../../../shared/api"

// Mock the timeout config utility
vitest.mock("../utils/timeout-config", () => ({
	getApiRequestTimeout: vitest.fn(),
}))

import { getApiRequestTimeout } from "../utils/timeout-config"

// Mock OpenAI
const mockOpenAIConstructor = vitest.fn()
vitest.mock("openai", () => {
	return {
		__esModule: true,
		default: vitest.fn().mockImplementation((config) => {
			mockOpenAIConstructor(config)
			return {
				chat: {
					completions: {
						create: vitest.fn(),
					},
				},
			}
		}),
	}
})

describe("OllamaHandler timeout configuration", () => {
	beforeEach(() => {
		vitest.clearAllMocks()
	})

	it("should use default timeout of 600 seconds when no configuration is set", () => {
		;(getApiRequestTimeout as any).mockReturnValue(600000)

		const options: ApiHandlerOptions = {
			apiModelId: "llama2",
			ollamaModelId: "llama2",
			ollamaBaseUrl: "http://localhost:11434",
		}

		new OllamaHandler(options)

		expect(getApiRequestTimeout).toHaveBeenCalled()
		expect(mockOpenAIConstructor).toHaveBeenCalledWith(
			expect.objectContaining({
				baseURL: "http://localhost:11434/v1",
				apiKey: "ollama",
				timeout: 600000, // 600 seconds in milliseconds
			}),
		)
	})

	it("should use custom timeout when configuration is set", () => {
		;(getApiRequestTimeout as any).mockReturnValue(3600000) // 1 hour

		const options: ApiHandlerOptions = {
			apiModelId: "llama2",
			ollamaModelId: "llama2",
		}

		new OllamaHandler(options)

		expect(mockOpenAIConstructor).toHaveBeenCalledWith(
			expect.objectContaining({
				timeout: 3600000, // 3600 seconds in milliseconds
			}),
		)
	})

	it("should handle zero timeout (no timeout)", () => {
		;(getApiRequestTimeout as any).mockReturnValue(0)

		const options: ApiHandlerOptions = {
			apiModelId: "llama2",
			ollamaModelId: "llama2",
			ollamaBaseUrl: "http://localhost:11434",
		}

		new OllamaHandler(options)

		expect(mockOpenAIConstructor).toHaveBeenCalledWith(
			expect.objectContaining({
				timeout: 0, // No timeout
			}),
		)
	})

	it("should use default base URL when not provided", () => {
		;(getApiRequestTimeout as any).mockReturnValue(600000)

		const options: ApiHandlerOptions = {
			apiModelId: "llama2",
			ollamaModelId: "llama2",
		}

		new OllamaHandler(options)

		expect(mockOpenAIConstructor).toHaveBeenCalledWith(
			expect.objectContaining({
				baseURL: "http://localhost:11434/v1",
			}),
		)
	})
})
