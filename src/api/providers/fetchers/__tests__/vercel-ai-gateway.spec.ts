// npx vitest run src/api/providers/fetchers/__tests__/vercel-ai-gateway.spec.ts

import axios from "axios"
import { VERCEL_AI_GATEWAY_VISION_ONLY_MODELS, VERCEL_AI_GATEWAY_VISION_AND_TOOLS_MODELS } from "@roo-code/types"

import { getVercelAiGatewayModels, parseVercelAiGatewayModel } from "../vercel-ai-gateway"

vitest.mock("axios")
const mockedAxios = axios as any

describe("Vercel AI Gateway Fetchers", () => {
	beforeEach(() => {
		vitest.clearAllMocks()
	})

	describe("getVercelAiGatewayModels", () => {
		const mockResponse = {
			data: {
				object: "list",
				data: [
					{
						id: "anthropic/claude-sonnet-4",
						object: "model",
						created: 1640995200,
						owned_by: "anthropic",
						name: "Claude Sonnet 4",
						description:
							"Claude Sonnet 4 significantly improves on Sonnet 3.7's industry-leading capabilities",
						context_window: 200000,
						max_tokens: 64000,
						type: "language",
						pricing: {
							input: "3.00",
							output: "15.00",
							input_cache_write: "3.75",
							input_cache_read: "0.30",
						},
					},
					{
						id: "anthropic/claude-3.5-haiku",
						object: "model",
						created: 1640995200,
						owned_by: "anthropic",
						name: "Claude 3.5 Haiku",
						description: "Claude 3.5 Haiku is fast and lightweight",
						context_window: 200000,
						max_tokens: 32000,
						type: "language",
						pricing: {
							input: "1.00",
							output: "5.00",
							input_cache_write: "1.25",
							input_cache_read: "0.10",
						},
					},
					{
						id: "dall-e-3",
						object: "model",
						created: 1640995200,
						owned_by: "openai",
						name: "DALL-E 3",
						description: "DALL-E 3 image generation model",
						context_window: 4000,
						max_tokens: 1000,
						type: "image",
						pricing: {
							input: "40.00",
							output: "0.00",
						},
					},
				],
			},
		}

		it("fetches and parses models correctly", async () => {
			mockedAxios.get.mockResolvedValueOnce(mockResponse)

			const models = await getVercelAiGatewayModels()

			expect(mockedAxios.get).toHaveBeenCalledWith("https://ai-gateway.vercel.sh/v1/models")
			expect(Object.keys(models)).toHaveLength(2) // Only language models
			expect(models["anthropic/claude-sonnet-4"]).toBeDefined()
			expect(models["anthropic/claude-3.5-haiku"]).toBeDefined()
		})

		it("handles API errors gracefully", async () => {
			const consoleErrorSpy = vitest.spyOn(console, "error").mockImplementation(() => {})
			mockedAxios.get.mockRejectedValueOnce(new Error("Network error"))

			const models = await getVercelAiGatewayModels()

			expect(models).toEqual({})
			expect(consoleErrorSpy).toHaveBeenCalledWith(
				expect.stringContaining("Error fetching Vercel AI Gateway models"),
			)
			consoleErrorSpy.mockRestore()
		})

		it("handles invalid response schema gracefully", async () => {
			const consoleErrorSpy = vitest.spyOn(console, "error").mockImplementation(() => {})
			mockedAxios.get.mockResolvedValueOnce({
				data: {
					invalid: "response",
					data: "not an array",
				},
			})

			const models = await getVercelAiGatewayModels()

			expect(models).toEqual({})
			expect(consoleErrorSpy).toHaveBeenCalledWith(
				"Vercel AI Gateway models response is invalid",
				expect.any(Object),
			)
			consoleErrorSpy.mockRestore()
		})

		it("continues processing with partially valid schema", async () => {
			const consoleErrorSpy = vitest.spyOn(console, "error").mockImplementation(() => {})
			const invalidResponse = {
				data: {
					invalid_root: "response",
					data: [
						{
							id: "anthropic/claude-sonnet-4",
							object: "model",
							created: 1640995200,
							owned_by: "anthropic",
							name: "Claude Sonnet 4",
							description: "Claude Sonnet 4",
							context_window: 200000,
							max_tokens: 64000,
							type: "language",
							pricing: {
								input: "3.00",
								output: "15.00",
							},
						},
					],
				},
			}
			mockedAxios.get.mockResolvedValueOnce(invalidResponse)

			const models = await getVercelAiGatewayModels()

			expect(consoleErrorSpy).toHaveBeenCalled()
			expect(models["anthropic/claude-sonnet-4"]).toBeDefined()
			consoleErrorSpy.mockRestore()
		})
	})

	describe("parseVercelAiGatewayModel", () => {
		const baseModel = {
			id: "test/model",
			object: "model",
			created: 1640995200,
			owned_by: "test",
			name: "Test Model",
			description: "A test model",
			context_window: 100000,
			max_tokens: 8000,
			type: "language",
			pricing: {
				input: "2.50",
				output: "10.00",
			},
		}

		it("parses basic model info correctly", () => {
			const result = parseVercelAiGatewayModel({
				id: "test/model",
				model: baseModel,
			})

			expect(result).toEqual({
				maxTokens: 8000,
				contextWindow: 100000,
				supportsImages: false,
				supportsComputerUse: false,
				supportsPromptCache: false,
				inputPrice: 2500000,
				outputPrice: 10000000,
				cacheWritesPrice: undefined,
				cacheReadsPrice: undefined,
				description: "A test model",
			})
		})

		it("parses cache pricing when available", () => {
			const modelWithCache = {
				...baseModel,
				pricing: {
					input: "3.00",
					output: "15.00",
					input_cache_write: "3.75",
					input_cache_read: "0.30",
				},
			}

			const result = parseVercelAiGatewayModel({
				id: "anthropic/claude-sonnet-4",
				model: modelWithCache,
			})

			expect(result).toMatchObject({
				supportsPromptCache: true,
				cacheWritesPrice: 3750000,
				cacheReadsPrice: 300000,
			})
		})

		it("detects vision-only models", () => {
			// claude 3.5 haiku in VERCEL_AI_GATEWAY_VISION_ONLY_MODELS
			const visionModel = {
				...baseModel,
				id: "anthropic/claude-3.5-haiku",
			}

			const result = parseVercelAiGatewayModel({
				id: "anthropic/claude-3.5-haiku",
				model: visionModel,
			})

			expect(result.supportsImages).toBe(VERCEL_AI_GATEWAY_VISION_ONLY_MODELS.has("anthropic/claude-3.5-haiku"))
			expect(result.supportsComputerUse).toBe(false)
		})

		it("detects vision and tools models", () => {
			// 4 sonnet in VERCEL_AI_GATEWAY_VISION_AND_TOOLS_MODELS
			const visionToolsModel = {
				...baseModel,
				id: "anthropic/claude-sonnet-4",
			}

			const result = parseVercelAiGatewayModel({
				id: "anthropic/claude-sonnet-4",
				model: visionToolsModel,
			})

			expect(result.supportsImages).toBe(
				VERCEL_AI_GATEWAY_VISION_AND_TOOLS_MODELS.has("anthropic/claude-sonnet-4"),
			)
			expect(result.supportsComputerUse).toBe(
				VERCEL_AI_GATEWAY_VISION_AND_TOOLS_MODELS.has("anthropic/claude-sonnet-4"),
			)
		})

		it("handles missing cache pricing", () => {
			const modelNoCachePricing = {
				...baseModel,
				pricing: {
					input: "2.50",
					output: "10.00",
					// No cache pricing
				},
			}

			const result = parseVercelAiGatewayModel({
				id: "test/model",
				model: modelNoCachePricing,
			})

			expect(result.supportsPromptCache).toBe(false)
			expect(result.cacheWritesPrice).toBeUndefined()
			expect(result.cacheReadsPrice).toBeUndefined()
		})

		it("handles partial cache pricing", () => {
			const modelPartialCachePricing = {
				...baseModel,
				pricing: {
					input: "2.50",
					output: "10.00",
					input_cache_write: "3.00",
					// Missing input_cache_read
				},
			}

			const result = parseVercelAiGatewayModel({
				id: "test/model",
				model: modelPartialCachePricing,
			})

			expect(result.supportsPromptCache).toBe(false)
			expect(result.cacheWritesPrice).toBe(3000000)
			expect(result.cacheReadsPrice).toBeUndefined()
		})

		it("validates all vision model categories", () => {
			// Test a few models from each category
			const visionOnlyModels = ["anthropic/claude-3.5-haiku", "google/gemini-1.5-flash-8b"]
			const visionAndToolsModels = ["anthropic/claude-sonnet-4", "openai/gpt-4o"]

			visionOnlyModels.forEach((modelId) => {
				if (VERCEL_AI_GATEWAY_VISION_ONLY_MODELS.has(modelId)) {
					const result = parseVercelAiGatewayModel({
						id: modelId,
						model: { ...baseModel, id: modelId },
					})
					expect(result.supportsImages).toBe(true)
					expect(result.supportsComputerUse).toBe(false)
				}
			})

			visionAndToolsModels.forEach((modelId) => {
				if (VERCEL_AI_GATEWAY_VISION_AND_TOOLS_MODELS.has(modelId)) {
					const result = parseVercelAiGatewayModel({
						id: modelId,
						model: { ...baseModel, id: modelId },
					})
					expect(result.supportsImages).toBe(true)
					expect(result.supportsComputerUse).toBe(true)
				}
			})
		})
	})
})
