import type { ModelInfo, OrganizationAllowList } from "@roo-code/types"

import { filterProviders, filterModels } from "../organizationFilters"

describe("organizationFilters", () => {
	const mockProviders = [
		{ value: "anthropic", label: "Anthropic" },
		{ value: "openai", label: "OpenAI" },
		{ value: "gemini", label: "Gemini" },
	]

	const mockModels: Record<string, ModelInfo> = {
		model1: { maxTokens: 8000 } as ModelInfo,
		model2: { maxTokens: 16000 } as ModelInfo,
		model3: { maxTokens: 32000 } as ModelInfo,
	}

	describe("filterProviders", () => {
		it("returns all providers when no organization settings are provided", () => {
			const result = filterProviders(mockProviders, undefined)
			expect(result).toEqual(mockProviders)
		})

		it("returns all providers when allowAll is true", () => {
			const allowList: OrganizationAllowList = {
				allowAll: true,
				providers: {},
			}
			const result = filterProviders(mockProviders, allowList)
			expect(result).toEqual(mockProviders)
		})

		it("filters providers based on allowlist", () => {
			const allowList: OrganizationAllowList = {
				allowAll: false,
				providers: {
					anthropic: { allowAll: true },
					gemini: { allowAll: true },
				},
			}
			const result = filterProviders(mockProviders, allowList)
			expect(result).toHaveLength(2)
			expect(result).toContainEqual({ value: "anthropic", label: "Anthropic" })
			expect(result).toContainEqual({ value: "gemini", label: "Gemini" })
		})
	})

	describe("filterModels", () => {
		it("returns all models when no organization settings are provided", () => {
			const result = filterModels(mockModels, "anthropic", undefined)
			expect(result).toEqual(mockModels)
		})

		it("returns all models when allowAll is true", () => {
			const allowList: OrganizationAllowList = {
				allowAll: true,
				providers: {},
			}
			const result = filterModels(mockModels, "anthropic", allowList)
			expect(result).toEqual(mockModels)
		})

		it("returns empty object when provider is not in allowlist", () => {
			const allowList: OrganizationAllowList = {
				allowAll: false,
				providers: {
					vertex: {
						allowAll: true,
					},
				},
			}
			const result = filterModels(mockModels, "anthropic", allowList)
			expect(result).toEqual({})
		})

		it("returns all models when provider allowAll is true", () => {
			const allowList: OrganizationAllowList = {
				allowAll: false,
				providers: {
					anthropic: {
						allowAll: true,
					},
				},
			}
			const result = filterModels(mockModels, "anthropic", allowList)
			expect(result).toEqual(mockModels)
		})

		it("filters models based on allowed list", () => {
			const allowList: OrganizationAllowList = {
				allowAll: false,
				providers: {
					anthropic: {
						allowAll: false,
						models: ["model1", "model2"],
					},
				},
			}
			const result = filterModels(mockModels, "anthropic", allowList)
			expect(Object.keys(result!)).toHaveLength(2)
			expect(result!["model1"]).toBeDefined()
			expect(result!["model2"]).toBeDefined()
			expect(result!["model3"]).toBeUndefined()
		})

		it("handles case when allowed models don't exist in the models object", () => {
			const allowList: OrganizationAllowList = {
				allowAll: false,
				providers: {
					anthropic: {
						allowAll: false,
						models: ["model1", "nonexistent-model"],
					},
				},
			}
			const result = filterModels(mockModels, "anthropic", allowList)
			expect(Object.keys(result!)).toHaveLength(1)
			expect(result!["model1"]).toBeDefined()
		})
	})
})
