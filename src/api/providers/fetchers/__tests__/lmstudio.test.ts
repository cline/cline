import axios from "axios"
import { vi, describe, it, expect, beforeEach } from "vitest"
import { LMStudioClient, LLM, LLMInstanceInfo, LLMInfo } from "@lmstudio/sdk"
import { getLMStudioModels, parseLMStudioModel } from "../lmstudio"
import { ModelInfo, lMStudioDefaultModelInfo } from "@roo-code/types" // ModelInfo is a type

// Mock axios
vi.mock("axios")
const mockedAxios = axios as any

// Mock @lmstudio/sdk
const mockGetModelInfo = vi.fn()
const mockListLoaded = vi.fn()
const mockListDownloadedModels = vi.fn()
vi.mock("@lmstudio/sdk", () => {
	return {
		LMStudioClient: vi.fn().mockImplementation(() => ({
			llm: {
				listLoaded: mockListLoaded,
			},
			system: {
				listDownloadedModels: mockListDownloadedModels,
			},
		})),
	}
})
const MockedLMStudioClientConstructor = LMStudioClient as any

describe("LMStudio Fetcher", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		MockedLMStudioClientConstructor.mockClear()
		mockListLoaded.mockClear()
		mockGetModelInfo.mockClear()
		mockListDownloadedModels.mockClear()
	})

	describe("parseLMStudioModel", () => {
		it("should correctly parse raw LLMInfo to ModelInfo", () => {
			const rawModel: LLMInstanceInfo = {
				type: "llm",
				modelKey: "mistralai/devstral-small-2505",
				format: "safetensors",
				displayName: "Devstral Small 2505",
				path: "mistralai/devstral-small-2505",
				sizeBytes: 13277565112,
				architecture: "mistral",
				identifier: "mistralai/devstral-small-2505",
				instanceReference: "RAP5qbeHVjJgBiGFQ6STCuTJ",
				vision: false,
				trainedForToolUse: false,
				maxContextLength: 131072,
				contextLength: 7161,
			}

			const expectedModelInfo: ModelInfo = {
				...lMStudioDefaultModelInfo,
				description: `${rawModel.displayName} - ${rawModel.path}`,
				contextWindow: rawModel.contextLength,
				supportsPromptCache: true,
				supportsImages: rawModel.vision,
				supportsComputerUse: false,
				maxTokens: rawModel.contextLength,
				inputPrice: 0,
				outputPrice: 0,
				cacheWritesPrice: 0,
				cacheReadsPrice: 0,
			}

			const result = parseLMStudioModel(rawModel)
			expect(result).toEqual(expectedModelInfo)
		})
	})

	describe("getLMStudioModels", () => {
		const baseUrl = "http://localhost:1234"
		const lmsUrl = "ws://localhost:1234"

		const mockRawModel: LLMInstanceInfo = {
			architecture: "test-arch",
			identifier: "mistralai/devstral-small-2505",
			instanceReference: "RAP5qbeHVjJgBiGFQ6STCuTJ",
			modelKey: "test-model-key-1",
			path: "/path/to/test-model-1",
			type: "llm",
			displayName: "Test Model One",
			maxContextLength: 2048,
			contextLength: 7161,
			paramsString: "1B params, 2k context",
			vision: true,
			format: "gguf",
			sizeBytes: 1000000000,
			trainedForToolUse: false, // Added
		}

		it("should fetch downloaded models using system.listDownloadedModels", async () => {
			const mockLLMInfo: LLMInfo = {
				type: "llm" as const,
				modelKey: "mistralai/devstral-small-2505",
				format: "safetensors",
				displayName: "Devstral Small 2505",
				path: "mistralai/devstral-small-2505",
				sizeBytes: 13277565112,
				architecture: "mistral",
				vision: false,
				trainedForToolUse: false,
				maxContextLength: 131072,
			}

			mockedAxios.get.mockResolvedValueOnce({ data: { status: "ok" } })
			mockListDownloadedModels.mockResolvedValueOnce([mockLLMInfo])

			const result = await getLMStudioModels(baseUrl)

			expect(mockedAxios.get).toHaveBeenCalledTimes(1)
			expect(mockedAxios.get).toHaveBeenCalledWith(`${baseUrl}/v1/models`)
			expect(MockedLMStudioClientConstructor).toHaveBeenCalledTimes(1)
			expect(MockedLMStudioClientConstructor).toHaveBeenCalledWith({ baseUrl: lmsUrl })
			expect(mockListDownloadedModels).toHaveBeenCalledTimes(1)
			expect(mockListDownloadedModels).toHaveBeenCalledWith("llm")
			expect(mockListLoaded).not.toHaveBeenCalled()

			const expectedParsedModel = parseLMStudioModel(mockLLMInfo)
			expect(result).toEqual({ [mockLLMInfo.path]: expectedParsedModel })
		})

		it("should fall back to listLoaded when listDownloadedModels fails", async () => {
			mockedAxios.get.mockResolvedValueOnce({ data: { status: "ok" } })
			mockListDownloadedModels.mockRejectedValueOnce(new Error("Method not available"))
			mockListLoaded.mockResolvedValueOnce([{ getModelInfo: mockGetModelInfo }])
			mockGetModelInfo.mockResolvedValueOnce(mockRawModel)

			const result = await getLMStudioModels(baseUrl)

			expect(mockedAxios.get).toHaveBeenCalledTimes(1)
			expect(mockedAxios.get).toHaveBeenCalledWith(`${baseUrl}/v1/models`)
			expect(MockedLMStudioClientConstructor).toHaveBeenCalledTimes(1)
			expect(MockedLMStudioClientConstructor).toHaveBeenCalledWith({ baseUrl: lmsUrl })
			expect(mockListDownloadedModels).toHaveBeenCalledTimes(1)
			expect(mockListLoaded).toHaveBeenCalledTimes(1)

			const expectedParsedModel = parseLMStudioModel(mockRawModel)
			expect(result).toEqual({ [mockRawModel.modelKey]: expectedParsedModel })
		})

		it("should use default baseUrl if an empty string is provided", async () => {
			const defaultBaseUrl = "http://localhost:1234"
			const defaultLmsUrl = "ws://localhost:1234"
			mockedAxios.get.mockResolvedValueOnce({ data: {} })
			mockListLoaded.mockResolvedValueOnce([])

			await getLMStudioModels("")

			expect(mockedAxios.get).toHaveBeenCalledWith(`${defaultBaseUrl}/v1/models`)
			expect(MockedLMStudioClientConstructor).toHaveBeenCalledWith({ baseUrl: defaultLmsUrl })
		})

		it("should transform https baseUrl to wss for LMStudioClient", async () => {
			const httpsBaseUrl = "https://securehost:4321"
			const wssLmsUrl = "wss://securehost:4321"
			mockedAxios.get.mockResolvedValueOnce({ data: {} })
			mockListLoaded.mockResolvedValueOnce([])

			await getLMStudioModels(httpsBaseUrl)

			expect(mockedAxios.get).toHaveBeenCalledWith(`${httpsBaseUrl}/v1/models`)
			expect(MockedLMStudioClientConstructor).toHaveBeenCalledWith({ baseUrl: wssLmsUrl })
		})

		it("should return an empty object if lmsUrl is unparsable", async () => {
			const unparsableBaseUrl = "http://localhost:invalid:port" // Leads to ws://localhost:invalid:port

			const result = await getLMStudioModels(unparsableBaseUrl)

			expect(result).toEqual({})
			expect(mockedAxios.get).not.toHaveBeenCalled()
			expect(MockedLMStudioClientConstructor).not.toHaveBeenCalled()
		})

		it("should return an empty object and log error if axios.get fails with a generic error", async () => {
			const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
			const networkError = new Error("Network connection failed")
			mockedAxios.get.mockRejectedValueOnce(networkError)

			const result = await getLMStudioModels(baseUrl)

			expect(mockedAxios.get).toHaveBeenCalledTimes(1)
			expect(mockedAxios.get).toHaveBeenCalledWith(`${baseUrl}/v1/models`)
			expect(MockedLMStudioClientConstructor).not.toHaveBeenCalled()
			expect(mockListLoaded).not.toHaveBeenCalled()
			expect(consoleErrorSpy).toHaveBeenCalledWith(
				`Error fetching LMStudio models: ${JSON.stringify(networkError, Object.getOwnPropertyNames(networkError), 2)}`,
			)
			expect(result).toEqual({})
			consoleErrorSpy.mockRestore()
		})

		it("should return an empty object and log info if axios.get fails with ECONNREFUSED", async () => {
			const consoleInfoSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
			const econnrefusedError = new Error("Connection refused")
			;(econnrefusedError as any).code = "ECONNREFUSED"
			mockedAxios.get.mockRejectedValueOnce(econnrefusedError)

			const result = await getLMStudioModels(baseUrl)

			expect(mockedAxios.get).toHaveBeenCalledTimes(1)
			expect(mockedAxios.get).toHaveBeenCalledWith(`${baseUrl}/v1/models`)
			expect(MockedLMStudioClientConstructor).not.toHaveBeenCalled()
			expect(mockListLoaded).not.toHaveBeenCalled()
			expect(consoleInfoSpy).toHaveBeenCalledWith(`Error connecting to LMStudio at ${baseUrl}`)
			expect(result).toEqual({})
			consoleInfoSpy.mockRestore()
		})

		it("should return an empty object and log error if listDownloadedModels fails", async () => {
			const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
			const listError = new Error("LMStudio SDK internal error")

			mockedAxios.get.mockResolvedValueOnce({ data: {} })
			mockListLoaded.mockRejectedValueOnce(listError)

			const result = await getLMStudioModels(baseUrl)

			expect(mockedAxios.get).toHaveBeenCalledTimes(1)
			expect(MockedLMStudioClientConstructor).toHaveBeenCalledTimes(1)
			expect(MockedLMStudioClientConstructor).toHaveBeenCalledWith({ baseUrl: lmsUrl })
			expect(mockListLoaded).toHaveBeenCalledTimes(1)
			expect(consoleErrorSpy).toHaveBeenCalledWith(
				`Error fetching LMStudio models: ${JSON.stringify(listError, Object.getOwnPropertyNames(listError), 2)}`,
			)
			expect(result).toEqual({})
			consoleErrorSpy.mockRestore()
		})
	})
})
