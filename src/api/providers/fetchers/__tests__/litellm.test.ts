import axios from "axios"
import { getLiteLLMModels } from "../litellm"
import { OPEN_ROUTER_COMPUTER_USE_MODELS } from "../../../../shared/api"

// Mock axios
jest.mock("axios")
const mockedAxios = axios as jest.Mocked<typeof axios>

const DUMMY_INVALID_KEY = "invalid-key-for-testing"

describe("getLiteLLMModels", () => {
	beforeEach(() => {
		jest.clearAllMocks()
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
		const computerUseModel = Array.from(OPEN_ROUTER_COMPUTER_USE_MODELS)[0]
		const mockResponse = {
			data: {
				data: [
					{
						model_name: "test-computer-model",
						model_info: {
							max_tokens: 4096,
							max_input_tokens: 200000,
							supports_vision: true,
						},
						litellm_params: {
							model: `anthropic/${computerUseModel}`,
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
})
