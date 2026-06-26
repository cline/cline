import { openAiModelInfoSafeDefaults } from "@shared/api"
import { describe, expect, it } from "vitest"
import { adaptSdkModelInfo, CatalogShapeError } from "./shape-adapter"

describe("adaptSdkModelInfo", () => {
	describe("validation", () => {
		it("throws CatalogShapeError when input is not an object", () => {
			expect(() => adaptSdkModelInfo(null)).toThrow(CatalogShapeError)
			expect(() => adaptSdkModelInfo(undefined)).toThrow(CatalogShapeError)
			expect(() => adaptSdkModelInfo("oops")).toThrow(CatalogShapeError)
			expect(() => adaptSdkModelInfo(42)).toThrow(CatalogShapeError)
			expect(() => adaptSdkModelInfo([])).toThrow(CatalogShapeError)
		})

		it("throws CatalogShapeError when id is missing, non-string, or empty", () => {
			expect(() => adaptSdkModelInfo({})).toThrow(CatalogShapeError)
			expect(() => adaptSdkModelInfo({ id: 123 })).toThrow(CatalogShapeError)
			expect(() => adaptSdkModelInfo({ id: "" })).toThrow(CatalogShapeError)
		})

		it("throws CatalogShapeError when optional scalar fields are malformed", () => {
			expect(() => adaptSdkModelInfo({ id: "m", contextWindow: "big" })).toThrow(CatalogShapeError)
			expect(() => adaptSdkModelInfo({ id: "m", maxTokens: "huge" })).toThrow(CatalogShapeError)
			expect(() => adaptSdkModelInfo({ id: "m", name: 1 })).toThrow(CatalogShapeError)
			expect(() => adaptSdkModelInfo({ id: "m", description: 1 })).toThrow(CatalogShapeError)
		})

		it("throws CatalogShapeError when capabilities is malformed", () => {
			expect(() => adaptSdkModelInfo({ id: "m", capabilities: "tools" })).toThrow(CatalogShapeError)
			expect(() => adaptSdkModelInfo({ id: "m", capabilities: ["tools", 42] })).toThrow(CatalogShapeError)
		})

		it("throws CatalogShapeError when pricing is malformed", () => {
			expect(() => adaptSdkModelInfo({ id: "m", pricing: "cheap" })).toThrow(CatalogShapeError)
			expect(() => adaptSdkModelInfo({ id: "m", pricing: { input: "free" } })).toThrow(CatalogShapeError)
			expect(() => adaptSdkModelInfo({ id: "m", pricing: { input: Number.NaN } })).toThrow(CatalogShapeError)
			expect(() => adaptSdkModelInfo({ id: "m", pricing: { input: Number.POSITIVE_INFINITY } })).toThrow(CatalogShapeError)
		})

		it("CatalogShapeError exposes useful message and details", () => {
			try {
				adaptSdkModelInfo({ id: 5 })
				expect.fail("should have thrown")
			} catch (error) {
				expect(error).toBeInstanceOf(CatalogShapeError)
				const shapeError = error as CatalogShapeError
				expect(shapeError.name).toBe("CatalogShapeError")
				expect(shapeError.message).toMatch(/id/i)
				expect(shapeError.details?.idType).toBe("number")
			}
		})
	})

	describe("capability flags", () => {
		it("derives supportsImages from images or vision capability", () => {
			expect(adaptSdkModelInfo({ id: "images", capabilities: ["images"] }).supportsImages).toBe(true)
			expect(adaptSdkModelInfo({ id: "vision", capabilities: ["vision"] }).supportsImages).toBe(true)
		})

		it("sets image/cache flags false when capabilities are present but absent", () => {
			const model = adaptSdkModelInfo({ id: "m", capabilities: ["tools"] })
			expect(model.supportsImages).toBe(false)
			expect(model.supportsPromptCache).toBe(false)
			expect(model.supportsReasoning).toBeUndefined()
		})

		it("derives supportsPromptCache and supportsReasoning from capabilities", () => {
			const model = adaptSdkModelInfo({ id: "m", capabilities: ["prompt-cache", "reasoning"] })
			expect(model.supportsPromptCache).toBe(true)
			expect(model.supportsReasoning).toBe(true)
		})

		it("ignores unrelated capabilities", () => {
			const model = adaptSdkModelInfo({
				id: "m",
				capabilities: ["tools", "streaming", "structured_output", "temperature"],
			})
			expect(model.supportsImages).toBe(false)
			expect(model.supportsPromptCache).toBe(false)
			expect(model.supportsReasoning).toBeUndefined()
		})

		it("uses safe defaults for image/cache capabilities when capabilities are absent", () => {
			const model = adaptSdkModelInfo({ id: "m" })
			expect(model.supportsImages).toBe(openAiModelInfoSafeDefaults.supportsImages)
			expect(model.supportsPromptCache).toBe(openAiModelInfoSafeDefaults.supportsPromptCache)
			expect(model.supportsReasoning).toBeUndefined()
		})
	})

	describe("pricing", () => {
		it("maps pricing fields correctly", () => {
			const model = adaptSdkModelInfo({
				id: "m",
				pricing: { input: 1.5, output: 7.25, cacheRead: 0.1, cacheWrite: 0.3 },
			})
			expect(model.inputPrice).toBe(1.5)
			expect(model.outputPrice).toBe(7.25)
			expect(model.cacheReadsPrice).toBe(0.1)
			expect(model.cacheWritesPrice).toBe(0.3)
		})

		it("preserves zero prices distinctly from missing cache fields", () => {
			const model = adaptSdkModelInfo({ id: "m", pricing: { input: 0, output: 0 } })
			expect(model.inputPrice).toBe(0)
			expect(model.outputPrice).toBe(0)
			expect(model.cacheReadsPrice).toBeUndefined()
			expect(model.cacheWritesPrice).toBeUndefined()
		})
	})

	describe("safe defaults for sparse input", () => {
		it("fills documented safe defaults for LiteLLM-like sparse input", () => {
			const model = adaptSdkModelInfo({ id: "gpt-5.4", name: "GPT-5.4" })
			expect(model.name).toBe("GPT-5.4")
			expect(model.contextWindow).toBe(openAiModelInfoSafeDefaults.contextWindow)
			expect(model.maxTokens).toBe(openAiModelInfoSafeDefaults.maxTokens)
			expect(model.supportsImages).toBe(openAiModelInfoSafeDefaults.supportsImages)
			expect(model.supportsPromptCache).toBe(openAiModelInfoSafeDefaults.supportsPromptCache)
			expect(model.supportsReasoning).toBeUndefined()
			expect(model.inputPrice).toBe(openAiModelInfoSafeDefaults.inputPrice)
			expect(model.outputPrice).toBe(openAiModelInfoSafeDefaults.outputPrice)
			expect(model.cacheReadsPrice).toBeUndefined()
			expect(model.cacheWritesPrice).toBeUndefined()
			expect(model.description).toBeUndefined()
		})

		it("falls back to id when name is omitted and passes through description", () => {
			const model = adaptSdkModelInfo({ id: "phi4-mini:latest", description: "local model" })
			expect(model.name).toBe("phi4-mini:latest")
			expect(model.description).toBe("local model")
		})

		it("does not invent extension-only metadata", () => {
			const model = adaptSdkModelInfo({ id: "m", capabilities: ["reasoning"], pricing: { input: 1, output: 2 } })
			expect(model.thinkingConfig).toBeUndefined()
			expect(model.apiFormat).toBeUndefined()
			expect(model.tiers).toBeUndefined()
			expect(model.temperature).toBeUndefined()
			expect(model.supportsGlobalEndpoint).toBeUndefined()
		})
	})

	it("maps rich SDK input end-to-end and drops unmapped SDK fields", () => {
		const model = adaptSdkModelInfo({
			id: "deepseek-v4-flash",
			name: "DeepSeek V4 Flash",
			contextWindow: 200_000,
			maxTokens: 8192,
			capabilities: ["tools", "reasoning", "structured_output", "temperature", "prompt-cache", "images"],
			pricing: { input: 0.5, output: 1.5, cacheRead: 0.05, cacheWrite: 0.1 },
			releaseDate: "2026-04-01",
			family: "deepseek",
			status: "ga",
		})

		expect(model).toMatchObject({
			name: "DeepSeek V4 Flash",
			contextWindow: 200_000,
			maxTokens: 8192,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
			inputPrice: 0.5,
			outputPrice: 1.5,
			cacheReadsPrice: 0.05,
			cacheWritesPrice: 0.1,
		})
		expect(Object.hasOwn(model, "releaseDate")).toBe(false)
		expect(Object.hasOwn(model, "family")).toBe(false)
		expect(Object.hasOwn(model, "status")).toBe(false)
	})

	it("does not mutate input", () => {
		const input = {
			id: "m",
			name: "M",
			contextWindow: 32_000,
			maxTokens: 4096,
			capabilities: ["tools", "reasoning"],
			pricing: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.2 },
			description: "desc",
		}
		const snapshot = structuredClone(input)
		adaptSdkModelInfo(input)
		expect(input).toEqual(snapshot)
	})
})
