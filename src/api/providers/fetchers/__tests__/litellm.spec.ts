// Mocks must come first, before imports
vi.mock("axios")

import type { Mock } from "vitest"
import axios from "axios"
import { getLiteLLMModels } from "../litellm"

const mockedAxios = axios as typeof axios & {
	get: Mock
	isAxiosError: Mock
}

const DUMMY_INVALID_KEY = "invalid-key-for-testing"

describe("getLiteLLMModels", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("handles base URLs with trailing slashes correctly", async () => {
		const mockResponse = {
			data: {
				data: [],
			},
		}

		mockedAxios.get.mockResolvedValue(mockResponse)

		await getLiteLLMModels("test-api-key", "http://localhost:4000/")

		expect(mockedAxios.get).toHaveBeenCalledWith("http://localhost:4000/v1/model/info", {
			headers: {
				Authorization: "Bearer test-api-key",
				"Content-Type": "application/json",
			},
			timeout: 5000,
		})
	})

	it("successfully fetches and formats LiteLLM models", async () => {
		const mockResponse = {
			data: {
				data: [
					{
						model_name: "claude-3-5-sonnet",
						model_info: {
							max_tokens: 4096,
							max_input_tokens: 200000,
							supports_vision: true,
							supports_prompt_caching: false,
							input_cost_per_token: 0.000003,
							output_cost_per_token: 0.000015,
							supports_computer_use: true,
						},
						litellm_params: {
							model: "anthropic/claude-3.5-sonnet",
						},
					},
					{
						model_name: "gpt-4-turbo",
						model_info: {
							max_tokens: 8192,
							max_input_tokens: 128000,
							supports_vision: false,
							supports_prompt_caching: false,
							input_cost_per_token: 0.00001,
							output_cost_per_token: 0.00003,
							supports_computer_use: false,
						},
						litellm_params: {
							model: "openai/gpt-4-turbo",
						},
					},
				],
			},
		}

		mockedAxios.get.mockResolvedValue(mockResponse)

		const result = await getLiteLLMModels("test-api-key", "http://localhost:4000")

		expect(mockedAxios.get).toHaveBeenCalledWith("http://localhost:4000/v1/model/info", {
			headers: {
				Authorization: "Bearer test-api-key",
				"Content-Type": "application/json",
			},
			timeout: 5000,
		})

		expect(result).toEqual({
			"claude-3-5-sonnet": {
				maxTokens: 4096,
				contextWindow: 200000,
				supportsImages: true,
				supportsComputerUse: true,
				supportsPromptCache: false,
				inputPrice: 3,
				outputPrice: 15,
				description: "claude-3-5-sonnet via LiteLLM proxy",
			},
			"gpt-4-turbo": {
				maxTokens: 8192,
				contextWindow: 128000,
				supportsImages: false,
				supportsComputerUse: false,
				supportsPromptCache: false,
				inputPrice: 10,
				outputPrice: 30,
				description: "gpt-4-turbo via LiteLLM proxy",
			},
		})
	})

	it("makes request without authorization header when no API key provided", async () => {
		const mockResponse = {
			data: {
				data: [],
			},
		}

		mockedAxios.get.mockResolvedValue(mockResponse)

		await getLiteLLMModels("", "http://localhost:4000")

		expect(mockedAxios.get).toHaveBeenCalledWith("http://localhost:4000/v1/model/info", {
			headers: {
				"Content-Type": "application/json",
			},
			timeout: 5000,
		})
	})

	it("handles computer use models correctly", async () => {
		const mockResponse = {
			data: {
				data: [
					{
						model_name: "test-computer-model",
						model_info: {
							max_tokens: 4096,
							max_input_tokens: 200000,
							supports_vision: true,
							supports_computer_use: true,
						},
						litellm_params: {
							model: `anthropic/test-computer-model`,
						},
					},
					{
						model_name: "test-non-computer-model",
						model_info: {
							max_tokens: 4096,
							max_input_tokens: 200000,
							supports_vision: false,
							supports_computer_use: false,
						},
						litellm_params: {
							model: `anthropic/test-non-computer-model`,
						},
					},
				],
			},
		}

		mockedAxios.get.mockResolvedValue(mockResponse)

		const result = await getLiteLLMModels("test-api-key", "http://localhost:4000")

		expect(result["test-computer-model"]).toEqual({
			maxTokens: 4096,
			contextWindow: 200000,
			supportsImages: true,
			supportsComputerUse: true,
			supportsPromptCache: false,
			inputPrice: undefined,
			outputPrice: undefined,
			description: "test-computer-model via LiteLLM proxy",
		})

		expect(result["test-non-computer-model"]).toEqual({
			maxTokens: 4096,
			contextWindow: 200000,
			supportsImages: false,
			supportsComputerUse: false,
			supportsPromptCache: false,
			inputPrice: undefined,
			outputPrice: undefined,
			description: "test-non-computer-model via LiteLLM proxy",
		})
	})

	it("throws error for unexpected response format", async () => {
		const mockResponse = {
			data: {
				// Missing 'data' field
				models: [],
			},
		}

		mockedAxios.get.mockResolvedValue(mockResponse)

		await expect(getLiteLLMModels("test-api-key", "http://localhost:4000")).rejects.toThrow(
			"Failed to fetch LiteLLM models: Unexpected response format.",
		)
	})

	it("throws detailed error for HTTP error responses", async () => {
		const axiosError = {
			response: {
				status: 401,
				statusText: "Unauthorized",
			},
			isAxiosError: true,
		}

		mockedAxios.isAxiosError.mockReturnValue(true)
		mockedAxios.get.mockRejectedValue(axiosError)

		await expect(getLiteLLMModels(DUMMY_INVALID_KEY, "http://localhost:4000")).rejects.toThrow(
			"Failed to fetch LiteLLM models: 401 Unauthorized. Check base URL and API key.",
		)
	})

	it("throws network error for request failures", async () => {
		const axiosError = {
			request: {},
			isAxiosError: true,
		}

		mockedAxios.isAxiosError.mockReturnValue(true)
		mockedAxios.get.mockRejectedValue(axiosError)

		await expect(getLiteLLMModels("test-api-key", "http://invalid-url")).rejects.toThrow(
			"Failed to fetch LiteLLM models: No response from server. Check LiteLLM server status and base URL.",
		)
	})

	it("throws generic error for other failures", async () => {
		const genericError = new Error("Network timeout")

		mockedAxios.isAxiosError.mockReturnValue(false)
		mockedAxios.get.mockRejectedValue(genericError)

		await expect(getLiteLLMModels("test-api-key", "http://localhost:4000")).rejects.toThrow(
			"Failed to fetch LiteLLM models: Network timeout",
		)
	})

	it("handles timeout parameter correctly", async () => {
		const mockResponse = { data: { data: [] } }
		mockedAxios.get.mockResolvedValue(mockResponse)

		await getLiteLLMModels("test-api-key", "http://localhost:4000")

		expect(mockedAxios.get).toHaveBeenCalledWith(
			"http://localhost:4000/v1/model/info",
			expect.objectContaining({
				timeout: 5000,
			}),
		)
	})

	it("returns empty object when data array is empty", async () => {
		const mockResponse = {
			data: {
				data: [],
			},
		}

		mockedAxios.get.mockResolvedValue(mockResponse)

		const result = await getLiteLLMModels("test-api-key", "http://localhost:4000")

		expect(result).toEqual({})
	})

	it("uses fallback computer use detection when supports_computer_use is not available", async () => {
		const mockResponse = {
			data: {
				data: [
					{
						model_name: "claude-3-5-sonnet-latest",
						model_info: {
							max_tokens: 4096,
							max_input_tokens: 200000,
							supports_vision: true,
							supports_prompt_caching: false,
							// Note: no supports_computer_use field
						},
						litellm_params: {
							model: "anthropic/claude-3-5-sonnet-latest", // This should match the fallback list
						},
					},
					{
						model_name: "gpt-4-turbo",
						model_info: {
							max_tokens: 8192,
							max_input_tokens: 128000,
							supports_vision: false,
							supports_prompt_caching: false,
							// Note: no supports_computer_use field
						},
						litellm_params: {
							model: "openai/gpt-4-turbo", // This should NOT match the fallback list
						},
					},
				],
			},
		}

		mockedAxios.get.mockResolvedValue(mockResponse)

		const result = await getLiteLLMModels("test-api-key", "http://localhost:4000")

		expect(result["claude-3-5-sonnet-latest"]).toEqual({
			maxTokens: 4096,
			contextWindow: 200000,
			supportsImages: true,
			supportsComputerUse: true, // Should be true due to fallback
			supportsPromptCache: false,
			inputPrice: undefined,
			outputPrice: undefined,
			description: "claude-3-5-sonnet-latest via LiteLLM proxy",
		})

		expect(result["gpt-4-turbo"]).toEqual({
			maxTokens: 8192,
			contextWindow: 128000,
			supportsImages: false,
			supportsComputerUse: false, // Should be false as it's not in fallback list
			supportsPromptCache: false,
			inputPrice: undefined,
			outputPrice: undefined,
			description: "gpt-4-turbo via LiteLLM proxy",
		})
	})

	it("prioritizes explicit supports_computer_use over fallback detection", async () => {
		const mockResponse = {
			data: {
				data: [
					{
						model_name: "claude-3-5-sonnet-latest",
						model_info: {
							max_tokens: 4096,
							max_input_tokens: 200000,
							supports_vision: true,
							supports_prompt_caching: false,
							supports_computer_use: false, // Explicitly set to false
						},
						litellm_params: {
							model: "anthropic/claude-3-5-sonnet-latest", // This matches fallback list but should be ignored
						},
					},
					{
						model_name: "custom-model",
						model_info: {
							max_tokens: 8192,
							max_input_tokens: 128000,
							supports_vision: false,
							supports_prompt_caching: false,
							supports_computer_use: true, // Explicitly set to true
						},
						litellm_params: {
							model: "custom/custom-model", // This would NOT match fallback list
						},
					},
					{
						model_name: "another-custom-model",
						model_info: {
							max_tokens: 8192,
							max_input_tokens: 128000,
							supports_vision: false,
							supports_prompt_caching: false,
							supports_computer_use: false, // Explicitly set to false
						},
						litellm_params: {
							model: "custom/another-custom-model", // This would NOT match fallback list
						},
					},
				],
			},
		}

		mockedAxios.get.mockResolvedValue(mockResponse)

		const result = await getLiteLLMModels("test-api-key", "http://localhost:4000")

		expect(result["claude-3-5-sonnet-latest"]).toEqual({
			maxTokens: 4096,
			contextWindow: 200000,
			supportsImages: true,
			supportsComputerUse: false, // False because explicitly set to false (fallback ignored)
			supportsPromptCache: false,
			inputPrice: undefined,
			outputPrice: undefined,
			description: "claude-3-5-sonnet-latest via LiteLLM proxy",
		})

		expect(result["custom-model"]).toEqual({
			maxTokens: 8192,
			contextWindow: 128000,
			supportsImages: false,
			supportsComputerUse: true, // True because explicitly set to true
			supportsPromptCache: false,
			inputPrice: undefined,
			outputPrice: undefined,
			description: "custom-model via LiteLLM proxy",
		})

		expect(result["another-custom-model"]).toEqual({
			maxTokens: 8192,
			contextWindow: 128000,
			supportsImages: false,
			supportsComputerUse: false, // False because explicitly set to false
			supportsPromptCache: false,
			inputPrice: undefined,
			outputPrice: undefined,
			description: "another-custom-model via LiteLLM proxy",
		})
	})

	it("handles fallback detection with various model name formats", async () => {
		const mockResponse = {
			data: {
				data: [
					{
						model_name: "vertex-claude",
						model_info: {
							max_tokens: 4096,
							max_input_tokens: 200000,
							supports_vision: true,
							supports_prompt_caching: false,
						},
						litellm_params: {
							model: "vertex_ai/claude-3-5-sonnet", // Should match fallback list
						},
					},
					{
						model_name: "openrouter-claude",
						model_info: {
							max_tokens: 4096,
							max_input_tokens: 200000,
							supports_vision: true,
							supports_prompt_caching: false,
						},
						litellm_params: {
							model: "openrouter/anthropic/claude-3.5-sonnet", // Should match fallback list
						},
					},
					{
						model_name: "bedrock-claude",
						model_info: {
							max_tokens: 4096,
							max_input_tokens: 200000,
							supports_vision: true,
							supports_prompt_caching: false,
						},
						litellm_params: {
							model: "anthropic.claude-3-5-sonnet-20241022-v2:0", // Should match fallback list
						},
					},
				],
			},
		}

		mockedAxios.get.mockResolvedValue(mockResponse)

		const result = await getLiteLLMModels("test-api-key", "http://localhost:4000")

		expect(result["vertex-claude"].supportsComputerUse).toBe(true)
		expect(result["openrouter-claude"].supportsComputerUse).toBe(true)
		expect(result["bedrock-claude"].supportsComputerUse).toBe(true)
	})
})
