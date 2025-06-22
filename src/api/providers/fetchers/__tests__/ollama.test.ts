import axios from "axios"
import path from "path"
import { vi, describe, it, expect, beforeEach } from "vitest"
import { getOllamaModels, parseOllamaModel } from "../ollama"
import ollamaModelsData from "./fixtures/ollama-model-details.json"

// Mock axios
vi.mock("axios")
const mockedAxios = axios as any

describe("Ollama Fetcher", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("parseOllamaModel", () => {
		it("should correctly parse Ollama model info", () => {
			const modelData = ollamaModelsData["qwen3-2to16:latest"]
			const parsedModel = parseOllamaModel(modelData)

			expect(parsedModel).toEqual({
				maxTokens: 40960,
				contextWindow: 40960,
				supportsImages: false,
				supportsComputerUse: false,
				supportsPromptCache: true,
				inputPrice: 0,
				outputPrice: 0,
				cacheWritesPrice: 0,
				cacheReadsPrice: 0,
				description: "Family: qwen3, Context: 40960, Size: 32.8B",
			})
		})

		it("should handle models with null families field", () => {
			const modelDataWithNullFamilies = {
				...ollamaModelsData["qwen3-2to16:latest"],
				details: {
					...ollamaModelsData["qwen3-2to16:latest"].details,
					families: null,
				},
			}

			const parsedModel = parseOllamaModel(modelDataWithNullFamilies as any)

			expect(parsedModel).toEqual({
				maxTokens: 40960,
				contextWindow: 40960,
				supportsImages: false,
				supportsComputerUse: false,
				supportsPromptCache: true,
				inputPrice: 0,
				outputPrice: 0,
				cacheWritesPrice: 0,
				cacheReadsPrice: 0,
				description: "Family: qwen3, Context: 40960, Size: 32.8B",
			})
		})
	})

	describe("getOllamaModels", () => {
		it("should fetch model list from /api/tags and details for each model from /api/show", async () => {
			const baseUrl = "http://localhost:11434"
			const modelName = "devstral2to16:latest"

			const mockApiTagsResponse = {
				models: [
					{
						name: modelName,
						model: modelName,
						modified_at: "2025-06-03T09:23:22.610222878-04:00",
						size: 14333928010,
						digest: "6a5f0c01d2c96c687d79e32fdd25b87087feb376bf9838f854d10be8cf3c10a5",
						details: {
							family: "llama",
							families: ["llama"],
							format: "gguf",
							parameter_size: "23.6B",
							parent_model: "",
							quantization_level: "Q4_K_M",
						},
					},
				],
			}
			const mockApiShowResponse = {
				license: "Mock License",
				modelfile: "FROM /path/to/blob\nTEMPLATE {{ .Prompt }}",
				parameters: "num_ctx 4096\nstop_token <eos>",
				template: "{{ .System }}USER: {{ .Prompt }}ASSISTANT:",
				modified_at: "2025-06-03T09:23:22.610222878-04:00",
				details: {
					parent_model: "",
					format: "gguf",
					family: "llama",
					families: ["llama"],
					parameter_size: "23.6B",
					quantization_level: "Q4_K_M",
				},
				model_info: {
					"ollama.context_length": 4096,
					"some.other.info": "value",
				},
				capabilities: ["completion"],
			}

			mockedAxios.get.mockResolvedValueOnce({ data: mockApiTagsResponse })
			mockedAxios.post.mockResolvedValueOnce({ data: mockApiShowResponse })

			const result = await getOllamaModels(baseUrl)

			expect(mockedAxios.get).toHaveBeenCalledTimes(1)
			expect(mockedAxios.get).toHaveBeenCalledWith(`${baseUrl}/api/tags`)

			expect(mockedAxios.post).toHaveBeenCalledTimes(1)
			expect(mockedAxios.post).toHaveBeenCalledWith(`${baseUrl}/api/show`, { model: modelName })

			expect(typeof result).toBe("object")
			expect(result).not.toBeInstanceOf(Array)
			expect(Object.keys(result).length).toBe(1)
			expect(result[modelName]).toBeDefined()

			const expectedParsedDetails = parseOllamaModel(mockApiShowResponse as any)
			expect(result[modelName]).toEqual(expectedParsedDetails)
		})

		it("should return an empty list if the initial /api/tags call fails", async () => {
			const baseUrl = "http://localhost:11434"
			mockedAxios.get.mockRejectedValueOnce(new Error("Network error"))
			const consoleInfoSpy = vi.spyOn(console, "error").mockImplementation(() => {}) // Spy and suppress output

			const result = await getOllamaModels(baseUrl)

			expect(mockedAxios.get).toHaveBeenCalledTimes(1)
			expect(mockedAxios.get).toHaveBeenCalledWith(`${baseUrl}/api/tags`)
			expect(mockedAxios.post).not.toHaveBeenCalled()
			expect(result).toEqual({})
		})

		it("should log an info message and return an empty object on ECONNREFUSED", async () => {
			const baseUrl = "http://localhost:11434"
			const consoleInfoSpy = vi.spyOn(console, "warn").mockImplementation(() => {}) // Spy and suppress output

			const econnrefusedError = new Error("Connection refused") as any
			econnrefusedError.code = "ECONNREFUSED"
			mockedAxios.get.mockRejectedValueOnce(econnrefusedError)

			const result = await getOllamaModels(baseUrl)

			expect(mockedAxios.get).toHaveBeenCalledTimes(1)
			expect(mockedAxios.get).toHaveBeenCalledWith(`${baseUrl}/api/tags`)
			expect(mockedAxios.post).not.toHaveBeenCalled()
			expect(consoleInfoSpy).toHaveBeenCalledWith(`Failed connecting to Ollama at ${baseUrl}`)
			expect(result).toEqual({})

			consoleInfoSpy.mockRestore() // Restore original console.info
		})

		it("should handle models with null families field in API response", async () => {
			const baseUrl = "http://localhost:11434"
			const modelName = "test-model:latest"

			const mockApiTagsResponse = {
				models: [
					{
						name: modelName,
						model: modelName,
						modified_at: "2025-06-03T09:23:22.610222878-04:00",
						size: 14333928010,
						digest: "6a5f0c01d2c96c687d79e32fdd25b87087feb376bf9838f854d10be8cf3c10a5",
						details: {
							family: "llama",
							families: null, // This is the case we're testing
							format: "gguf",
							parameter_size: "23.6B",
							parent_model: "",
							quantization_level: "Q4_K_M",
						},
					},
				],
			}
			const mockApiShowResponse = {
				license: "Mock License",
				modelfile: "FROM /path/to/blob\nTEMPLATE {{ .Prompt }}",
				parameters: "num_ctx 4096\nstop_token <eos>",
				template: "{{ .System }}USER: {{ .Prompt }}ASSISTANT:",
				modified_at: "2025-06-03T09:23:22.610222878-04:00",
				details: {
					parent_model: "",
					format: "gguf",
					family: "llama",
					families: null, // This is the case we're testing
					parameter_size: "23.6B",
					quantization_level: "Q4_K_M",
				},
				model_info: {
					"ollama.context_length": 4096,
					"some.other.info": "value",
				},
				capabilities: ["completion"],
			}

			mockedAxios.get.mockResolvedValueOnce({ data: mockApiTagsResponse })
			mockedAxios.post.mockResolvedValueOnce({ data: mockApiShowResponse })

			const result = await getOllamaModels(baseUrl)

			expect(mockedAxios.get).toHaveBeenCalledTimes(1)
			expect(mockedAxios.get).toHaveBeenCalledWith(`${baseUrl}/api/tags`)

			expect(mockedAxios.post).toHaveBeenCalledTimes(1)
			expect(mockedAxios.post).toHaveBeenCalledWith(`${baseUrl}/api/show`, { model: modelName })

			expect(typeof result).toBe("object")
			expect(result).not.toBeInstanceOf(Array)
			expect(Object.keys(result).length).toBe(1)
			expect(result[modelName]).toBeDefined()

			// Verify the model was parsed correctly despite null families
			expect(result[modelName].description).toBe("Family: llama, Context: 4096, Size: 23.6B")
		})
	})
})
