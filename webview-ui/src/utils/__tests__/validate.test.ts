import { ProviderSettings, OrganizationAllowList } from "@roo-code/types"
import { RouterModels } from "@roo/api"

import { getModelValidationError, validateApiConfigurationExcludingModelErrors } from "../validate"

describe("Model Validation Functions", () => {
	const mockRouterModels: RouterModels = {
		openrouter: {
			"valid-model": {
				maxTokens: 8192,
				contextWindow: 200000,
				supportsImages: true,
				supportsPromptCache: false,
				inputPrice: 3.0,
				outputPrice: 15.0,
			},
			"another-valid-model": {
				maxTokens: 4096,
				contextWindow: 100000,
				supportsImages: false,
				supportsPromptCache: false,
				inputPrice: 1.0,
				outputPrice: 5.0,
			},
		},
		glama: {
			"valid-model": {
				maxTokens: 8192,
				contextWindow: 200000,
				supportsImages: true,
				supportsPromptCache: false,
				inputPrice: 3.0,
				outputPrice: 15.0,
			},
		},
		requesty: {},
		unbound: {},
		litellm: {},
		ollama: {},
		lmstudio: {},
	}

	const allowAllOrganization: OrganizationAllowList = {
		allowAll: true,
		providers: {},
	}

	const restrictiveOrganization: OrganizationAllowList = {
		allowAll: false,
		providers: {
			openrouter: {
				allowAll: false,
				models: ["valid-model"],
			},
		},
	}

	describe("getModelValidationError", () => {
		it("returns undefined for valid OpenRouter model", () => {
			const config: ProviderSettings = {
				apiProvider: "openrouter",
				openRouterModelId: "valid-model",
			}

			const result = getModelValidationError(config, mockRouterModels, allowAllOrganization)
			expect(result).toBeUndefined()
		})

		it("returns error for invalid OpenRouter model", () => {
			const config: ProviderSettings = {
				apiProvider: "openrouter",
				openRouterModelId: "invalid-model",
			}

			const result = getModelValidationError(config, mockRouterModels, allowAllOrganization)
			expect(result).toBe("validation.modelAvailability")
		})

		it("returns error for model not allowed by organization", () => {
			const config: ProviderSettings = {
				apiProvider: "openrouter",
				openRouterModelId: "another-valid-model",
			}

			const result = getModelValidationError(config, mockRouterModels, restrictiveOrganization)
			expect(result).toContain("model")
		})

		it("returns undefined for valid Glama model", () => {
			const config: ProviderSettings = {
				apiProvider: "glama",
				glamaModelId: "valid-model",
			}

			const result = getModelValidationError(config, mockRouterModels, allowAllOrganization)
			expect(result).toBeUndefined()
		})

		it("returns error for invalid Glama model", () => {
			const config: ProviderSettings = {
				apiProvider: "glama",
				glamaModelId: "invalid-model",
			}

			const result = getModelValidationError(config, mockRouterModels, allowAllOrganization)
			expect(result).toBeUndefined()
		})

		it("returns undefined for OpenAI models when no router models provided", () => {
			const config: ProviderSettings = {
				apiProvider: "openai",
				openAiModelId: "gpt-4",
			}

			const result = getModelValidationError(config, undefined, allowAllOrganization)
			expect(result).toBeUndefined()
		})

		it("handles empty model IDs gracefully", () => {
			const config: ProviderSettings = {
				apiProvider: "openrouter",
				openRouterModelId: "",
			}

			const result = getModelValidationError(config, mockRouterModels, allowAllOrganization)
			expect(result).toBe("validation.modelId")
		})

		it("handles undefined model IDs gracefully", () => {
			const config: ProviderSettings = {
				apiProvider: "openrouter",
				// openRouterModelId is undefined
			}

			const result = getModelValidationError(config, mockRouterModels, allowAllOrganization)
			expect(result).toBe("validation.modelId")
		})
	})

	describe("validateApiConfigurationExcludingModelErrors", () => {
		it("returns undefined when configuration is valid", () => {
			const config: ProviderSettings = {
				apiProvider: "openrouter",
				openRouterApiKey: "valid-key",
				openRouterModelId: "valid-model",
			}

			const result = validateApiConfigurationExcludingModelErrors(config, mockRouterModels, allowAllOrganization)
			expect(result).toBeUndefined()
		})

		it("returns error for missing API key", () => {
			const config: ProviderSettings = {
				apiProvider: "openrouter",
				openRouterModelId: "valid-model",
				// Missing openRouterApiKey
			}

			const result = validateApiConfigurationExcludingModelErrors(config, mockRouterModels, allowAllOrganization)
			expect(result).toBe("validation.apiKey")
		})

		it("excludes model-specific errors", () => {
			const config: ProviderSettings = {
				apiProvider: "openrouter",
				openRouterApiKey: "valid-key",
				openRouterModelId: "invalid-model", // This should be ignored
			}

			const result = validateApiConfigurationExcludingModelErrors(config, mockRouterModels, allowAllOrganization)
			expect(result).toBeUndefined() // Should not return model validation error
		})

		it("excludes model-specific organization errors", () => {
			const config: ProviderSettings = {
				apiProvider: "openrouter",
				openRouterApiKey: "valid-key",
				openRouterModelId: "another-valid-model", // Not allowed by restrictive org
			}

			const result = validateApiConfigurationExcludingModelErrors(
				config,
				mockRouterModels,
				restrictiveOrganization,
			)
			expect(result).toBeUndefined() // Should exclude model-specific org errors
		})
	})
})
