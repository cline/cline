// npx vitest run api/transform/__tests__/model-params.spec.ts

import { type ModelInfo, ANTHROPIC_DEFAULT_MAX_TOKENS } from "@roo-code/types"

import { getModelParams } from "../model-params"
import {
	DEFAULT_HYBRID_REASONING_MODEL_MAX_TOKENS,
	DEFAULT_HYBRID_REASONING_MODEL_THINKING_TOKENS,
} from "../../../shared/api"

describe("getModelParams", () => {
	const baseModel: ModelInfo = {
		contextWindow: 16000,
		supportsPromptCache: true,
	}

	const anthropicParams = {
		modelId: "test",
		format: "anthropic" as const,
	}

	const openaiParams = {
		modelId: "test",
		format: "openai" as const,
	}

	const openrouterParams = {
		modelId: "test",
		format: "openrouter" as const,
	}

	describe("Basic functionality", () => {
		it("should return default values when no custom values are provided", () => {
			const result = getModelParams({
				...anthropicParams,
				settings: {},
				model: baseModel,
				defaultTemperature: 0.5,
			})

			expect(result).toEqual({
				format: anthropicParams.format,
				maxTokens: ANTHROPIC_DEFAULT_MAX_TOKENS,
				temperature: 0.5,
				reasoningEffort: undefined,
				reasoningBudget: undefined,
				reasoning: undefined,
			})
		})

		it("should use default temperature of 0 when no defaultTemperature is provided", () => {
			const result = getModelParams({
				...anthropicParams,
				settings: {},
				model: baseModel,
			})

			expect(result.temperature).toBe(0)
		})

		it("should use custom temperature from settings when provided", () => {
			const result = getModelParams({
				...anthropicParams,
				settings: { modelTemperature: 0.7 },
				model: baseModel,
				defaultTemperature: 0.5,
			})

			expect(result).toEqual({
				format: anthropicParams.format,
				maxTokens: ANTHROPIC_DEFAULT_MAX_TOKENS,
				temperature: 0.7,
				reasoningEffort: undefined,
				reasoningBudget: undefined,
				reasoning: undefined,
			})
		})

		it("should handle null temperature in settings", () => {
			const result = getModelParams({
				...anthropicParams,
				settings: { modelTemperature: null },
				model: baseModel,
				defaultTemperature: 0.5,
			})

			expect(result.temperature).toBe(0.5)
		})

		it("should use model maxTokens when available", () => {
			const model: ModelInfo = {
				...baseModel,
				maxTokens: 2000,
			}

			expect(getModelParams({ ...anthropicParams, settings: {}, model })).toEqual({
				format: anthropicParams.format,
				maxTokens: 2000,
				temperature: 0,
				reasoningEffort: undefined,
				reasoningBudget: undefined,
				reasoning: undefined,
			})
		})

		it("should handle null maxTokens in model", () => {
			const model: ModelInfo = {
				...baseModel,
				maxTokens: null,
			}

			const result = getModelParams({ ...anthropicParams, settings: {}, model })
			expect(result.maxTokens).toBe(ANTHROPIC_DEFAULT_MAX_TOKENS)
		})
	})

	describe("Format-specific behavior", () => {
		it("should return correct format for anthropic", () => {
			const result = getModelParams({
				...anthropicParams,
				settings: {},
				model: baseModel,
			})

			expect(result.format).toBe("anthropic")
		})

		it("should return correct format for openai", () => {
			const result = getModelParams({
				...openaiParams,
				settings: {},
				model: baseModel,
			})

			expect(result.format).toBe("openai")
		})

		it("should return correct format for openrouter", () => {
			const result = getModelParams({
				...openrouterParams,
				settings: {},
				model: baseModel,
			})

			expect(result.format).toBe("openrouter")
		})

		it("should use ANTHROPIC_DEFAULT_MAX_TOKENS for anthropic format when no maxTokens", () => {
			const result = getModelParams({
				...anthropicParams,
				settings: {},
				model: baseModel,
			})

			expect(result.maxTokens).toBe(ANTHROPIC_DEFAULT_MAX_TOKENS)
		})

		it("should use ANTHROPIC_DEFAULT_MAX_TOKENS for openrouter with anthropic model", () => {
			const result = getModelParams({
				modelId: "anthropic/claude-3-sonnet",
				format: "openrouter" as const,
				settings: {},
				model: baseModel,
			})

			expect(result.maxTokens).toBe(ANTHROPIC_DEFAULT_MAX_TOKENS)
		})

		it("should not force maxTokens for openai format", () => {
			const result = getModelParams({
				...openaiParams,
				settings: {},
				model: baseModel,
			})

			expect(result.maxTokens).toBeUndefined()
		})

		it("should not force maxTokens for openrouter with non-anthropic model", () => {
			const result = getModelParams({
				modelId: "openai/gpt-4",
				format: "openrouter" as const,
				settings: {},
				model: baseModel,
			})

			expect(result.maxTokens).toBeUndefined()
		})
	})

	describe("Reasoning Budget (Hybrid reasoning models)", () => {
		it("should handle requiredReasoningBudget models correctly", () => {
			const model: ModelInfo = {
				...baseModel,
				requiredReasoningBudget: true,
			}

			expect(getModelParams({ ...anthropicParams, settings: { modelMaxTokens: 2000 }, model })).toEqual({
				format: anthropicParams.format,
				maxTokens: 2000,
				temperature: 1.0, // Thinking models require temperature 1.0.
				reasoningEffort: undefined,
				reasoningBudget: 0.8 * 2000,
				reasoning: {
					type: "enabled",
					budget_tokens: 1600,
				},
			})
		})

		it("should handle supportsReasoningBudget with enableReasoningEffort setting", () => {
			const model: ModelInfo = {
				...baseModel,
				supportsReasoningBudget: true,
			}

			const result = getModelParams({
				...anthropicParams,
				settings: { enableReasoningEffort: true, modelMaxTokens: 2000 },
				model,
			})

			expect(result.reasoningBudget).toBe(1600) // 80% of 2000
			expect(result.temperature).toBe(1.0)
			expect(result.reasoning).toEqual({
				type: "enabled",
				budget_tokens: 1600,
			})
		})

		it("should not use reasoning budget when supportsReasoningBudget is true but enableReasoningEffort is false", () => {
			const model: ModelInfo = {
				...baseModel,
				maxTokens: 2000,
				supportsReasoningBudget: true,
			}

			const result = getModelParams({
				...anthropicParams,
				settings: { enableReasoningEffort: false },
				model,
			})

			expect(result.reasoningBudget).toBeUndefined()
			expect(result.temperature).toBe(0)
			expect(result.reasoning).toBeUndefined()
		})

		it("should honor customMaxTokens for reasoning budget models", () => {
			const model: ModelInfo = {
				...baseModel,
				requiredReasoningBudget: true,
			}

			expect(getModelParams({ ...anthropicParams, settings: { modelMaxTokens: 3000 }, model })).toEqual({
				format: anthropicParams.format,
				maxTokens: 3000,
				temperature: 1.0,
				reasoningEffort: undefined,
				reasoningBudget: 2400, // 80% of 3000,
				reasoning: {
					type: "enabled",
					budget_tokens: 2400,
				},
			})
		})

		it("should honor customMaxThinkingTokens for reasoning budget models", () => {
			const model: ModelInfo = {
				...baseModel,
				requiredReasoningBudget: true,
			}

			expect(
				getModelParams({
					...anthropicParams,
					settings: { modelMaxTokens: 4000, modelMaxThinkingTokens: 1500 },
					model,
				}),
			).toEqual({
				format: anthropicParams.format,
				maxTokens: 4000,
				temperature: 1.0,
				reasoningEffort: undefined,
				reasoningBudget: 1500, // Using the custom value.
				reasoning: {
					type: "enabled",
					budget_tokens: 1500,
				},
			})
		})

		it("should not honor customMaxThinkingTokens for non-reasoning budget models", () => {
			const model: ModelInfo = {
				...baseModel,
				maxTokens: 4000,
			}

			expect(getModelParams({ ...anthropicParams, settings: { modelMaxThinkingTokens: 1500 }, model })).toEqual({
				format: anthropicParams.format,
				maxTokens: 4000,
				temperature: 0, // Using default temperature.
				reasoningEffort: undefined,
				reasoningBudget: undefined, // Should remain undefined despite customMaxThinkingTokens being set.
				reasoning: undefined,
			})
		})

		it("should clamp thinking budget to at least 1024 tokens", () => {
			const model: ModelInfo = {
				...baseModel,
				requiredReasoningBudget: true,
			}

			expect(
				getModelParams({
					...anthropicParams,
					settings: { modelMaxTokens: 2000, modelMaxThinkingTokens: 500 },
					model,
				}),
			).toEqual({
				format: anthropicParams.format,
				maxTokens: 2000,
				temperature: 1.0,
				reasoningEffort: undefined,
				reasoningBudget: 1024, // Minimum is 1024
				reasoning: {
					type: "enabled",
					budget_tokens: 1024,
				},
			})
		})

		it("should clamp thinking budget to at most 80% of max tokens", () => {
			const model: ModelInfo = {
				...baseModel,
				requiredReasoningBudget: true,
			}

			expect(
				getModelParams({
					...anthropicParams,
					settings: { modelMaxTokens: 4000, modelMaxThinkingTokens: 5000 },
					model,
				}),
			).toEqual({
				format: anthropicParams.format,
				maxTokens: 4000,
				temperature: 1.0,
				reasoningEffort: undefined,
				reasoningBudget: 0.8 * 4000,
				reasoning: {
					type: "enabled",
					budget_tokens: 3200,
				},
			})
		})

		it("should use DEFAULT_HYBRID_REASONING_MODEL_MAX_TOKENS when no maxTokens is provided for reasoning budget models", () => {
			const model: ModelInfo = {
				...baseModel,
				requiredReasoningBudget: true,
			}

			expect(getModelParams({ ...anthropicParams, settings: {}, model })).toEqual({
				format: anthropicParams.format,
				maxTokens: DEFAULT_HYBRID_REASONING_MODEL_MAX_TOKENS,
				temperature: 1.0,
				reasoningEffort: undefined,
				reasoningBudget: DEFAULT_HYBRID_REASONING_MODEL_THINKING_TOKENS,
				reasoning: {
					type: "enabled",
					budget_tokens: DEFAULT_HYBRID_REASONING_MODEL_THINKING_TOKENS,
				},
			})
		})

		it("should handle both customMaxTokens and customMaxThinkingTokens for reasoning budget models", () => {
			const model: ModelInfo = {
				...baseModel,
				requiredReasoningBudget: true,
			}

			const result = getModelParams({
				...anthropicParams,
				settings: { modelMaxTokens: 5000, modelMaxThinkingTokens: 2000 },
				model,
			})

			expect(result.maxTokens).toBe(5000)
			expect(result.reasoningBudget).toBe(2000) // Custom thinking tokens takes precedence
		})

		it("should clamp custom thinking tokens even when custom max tokens is provided", () => {
			const model: ModelInfo = {
				...baseModel,
				requiredReasoningBudget: true,
			}

			const result = getModelParams({
				...anthropicParams,
				settings: { modelMaxTokens: 2000, modelMaxThinkingTokens: 5000 },
				model,
			})

			expect(result.maxTokens).toBe(2000)
			expect(result.reasoningBudget).toBe(1600) // 80% of 2000, not 5000
		})
	})

	describe("Reasoning Effort (Traditional reasoning models)", () => {
		it("should handle supportsReasoningEffort with model reasoningEffort", () => {
			const model: ModelInfo = {
				...baseModel,
				supportsReasoningEffort: true,
				reasoningEffort: "medium",
			}

			const result = getModelParams({
				...openaiParams,
				settings: {},
				model,
			})

			expect(result.reasoningEffort).toBe("medium")
			expect(result.reasoningBudget).toBeUndefined()
			expect(result.temperature).toBe(0) // Not forced to 1.0 for reasoning effort models
			expect(result.reasoning).toEqual({ reasoning_effort: "medium" })
		})

		it("should handle supportsReasoningEffort with settings reasoningEffort", () => {
			const model: ModelInfo = {
				...baseModel,
				supportsReasoningEffort: true,
			}

			const result = getModelParams({
				...openaiParams,
				settings: { reasoningEffort: "high" },
				model,
			})

			expect(result.reasoningEffort).toBe("high")
			expect(result.reasoning).toEqual({ reasoning_effort: "high" })
		})

		it("should prefer settings reasoningEffort over model reasoningEffort", () => {
			const model: ModelInfo = {
				...baseModel,
				supportsReasoningEffort: true,
				reasoningEffort: "low",
			}

			const result = getModelParams({
				...openaiParams,
				settings: { reasoningEffort: "high" },
				model,
			})

			expect(result.reasoningEffort).toBe("high")
			expect(result.reasoning).toEqual({ reasoning_effort: "high" })
		})

		it("should not use reasoning effort when supportsReasoningEffort is true but no effort is specified", () => {
			const model: ModelInfo = {
				...baseModel,
				supportsReasoningEffort: true,
			}

			const result = getModelParams({
				...openaiParams,
				settings: {},
				model,
			})

			expect(result.reasoningEffort).toBeUndefined()
			expect(result.reasoning).toBeUndefined()
		})

		it("should handle reasoning effort for openrouter format", () => {
			const model: ModelInfo = {
				...baseModel,
				supportsReasoningEffort: true,
				reasoningEffort: "medium",
			}

			const result = getModelParams({
				...openrouterParams,
				settings: {},
				model,
			})

			expect(result.reasoningEffort).toBe("medium")
			expect(result.reasoning).toEqual({ effort: "medium" })
		})

		it("should not use reasoning effort for anthropic format", () => {
			const model: ModelInfo = {
				...baseModel,
				supportsReasoningEffort: true,
				reasoningEffort: "medium",
			}

			const result = getModelParams({
				...anthropicParams,
				settings: {},
				model,
			})

			expect(result.reasoningEffort).toBe("medium")
			expect(result.reasoning).toBeUndefined() // Anthropic doesn't support reasoning effort
		})

		it("should use reasoningEffort if supportsReasoningEffort is false but reasoningEffort is set", () => {
			const model: ModelInfo = {
				...baseModel,
				maxTokens: 8000,
				supportsReasoningEffort: false,
				reasoningEffort: "medium",
			}

			const result = getModelParams({
				...openaiParams,
				settings: {},
				model,
			})

			expect(result.maxTokens).toBe(8000)
			expect(result.reasoningEffort).toBe("medium")
		})
	})

	describe("Hybrid reasoning models (supportsReasoningEffort)", () => {
		const model: ModelInfo = {
			...baseModel,
			maxTokens: 8000,
			supportsReasoningBudget: true,
		}

		it("should use ANTHROPIC_DEFAULT_MAX_TOKENS for hybrid models when not using reasoning", () => {
			const result = getModelParams({
				...anthropicParams,
				settings: {},
				model,
			})

			// Should discard model's maxTokens and use default
			expect(result.maxTokens).toBe(ANTHROPIC_DEFAULT_MAX_TOKENS)
			expect(result.reasoningBudget).toBeUndefined()
		})

		it("should keep model maxTokens for hybrid models when using reasoning budget", () => {
			const result = getModelParams({
				...anthropicParams,
				settings: { enableReasoningEffort: true },
				model,
			})

			expect(result.maxTokens).toBe(16384) // Default value.
			expect(result.reasoningBudget).toBe(8192) // Default value.
		})
	})

	describe("Edge cases and combinations", () => {
		it("should handle model with both reasoning capabilities but only one enabled", () => {
			const model: ModelInfo = {
				...baseModel,
				supportsReasoningBudget: true,
				supportsReasoningEffort: true,
				reasoningEffort: "medium",
			}

			// Only reasoning budget should be used (takes precedence)
			const result = getModelParams({
				...anthropicParams,
				settings: { enableReasoningEffort: true, modelMaxTokens: 4000 },
				model,
			})

			expect(result.reasoningBudget).toBe(3200) // 80% of 4000
			expect(result.reasoningEffort).toBeUndefined()
			expect(result.temperature).toBe(1.0)
		})

		it("should handle zero maxTokens", () => {
			const model: ModelInfo = {
				...baseModel,
				maxTokens: 0,
			}

			const result = getModelParams({
				...anthropicParams,
				settings: {},
				model,
			})

			expect(result.maxTokens).toBe(ANTHROPIC_DEFAULT_MAX_TOKENS) // Should fallback for anthropic
		})

		it("should handle very small maxTokens for reasoning budget models", () => {
			const model: ModelInfo = {
				...baseModel,
				requiredReasoningBudget: true,
			}

			const result = getModelParams({
				...anthropicParams,
				settings: { modelMaxTokens: 1000 }, // Less than minimum reasoning budget.
				model,
			})

			expect(result.maxTokens).toBe(1000)
			expect(result.reasoningBudget).toBe(1024) // Clamped to minimum.
		})

		it("should handle undefined settings", () => {
			const result = getModelParams({
				...anthropicParams,
				settings: {},
				model: baseModel,
			})

			expect(result.temperature).toBe(0)
			expect(result.maxTokens).toBe(ANTHROPIC_DEFAULT_MAX_TOKENS)
		})

		it("should handle all reasoning effort values", () => {
			const model: ModelInfo = {
				...baseModel,
				supportsReasoningEffort: true,
			}

			const efforts: Array<"low" | "medium" | "high"> = ["low", "medium", "high"]

			efforts.forEach((effort) => {
				const result = getModelParams({
					...openaiParams,
					settings: { reasoningEffort: effort },
					model,
				})

				expect(result.reasoningEffort).toBe(effort)
				expect(result.reasoning).toEqual({ reasoning_effort: effort })
			})
		})

		it("should handle complex model configuration", () => {
			const model: ModelInfo = {
				...baseModel,
				maxTokens: 16000,
				maxThinkingTokens: 8000,
				supportsReasoningBudget: true,
				supportsReasoningEffort: true,
				reasoningEffort: "low",
			}

			const result = getModelParams({
				...anthropicParams,
				settings: {
					enableReasoningEffort: true,
					modelMaxTokens: 20000,
					modelMaxThinkingTokens: 10000,
					modelTemperature: 0.8,
				},
				model,
			})

			expect(result.maxTokens).toBe(20000)
			expect(result.reasoningBudget).toBe(10000)
			expect(result.temperature).toBe(1.0) // Overridden for reasoning budget models
			expect(result.reasoningEffort).toBeUndefined() // Budget takes precedence
		})
	})

	describe("Provider-specific reasoning behavior", () => {
		it("should return correct reasoning format for openai with reasoning effort", () => {
			const model: ModelInfo = {
				...baseModel,
				supportsReasoningEffort: true,
				reasoningEffort: "medium",
			}

			const result = getModelParams({
				...openaiParams,
				settings: {},
				model,
			})

			expect(result.reasoning).toEqual({ reasoning_effort: "medium" })
		})

		it("should return correct reasoning format for openrouter with reasoning effort", () => {
			const model: ModelInfo = {
				...baseModel,
				supportsReasoningEffort: true,
				reasoningEffort: "high",
			}

			const result = getModelParams({
				...openrouterParams,
				settings: {},
				model,
			})

			expect(result.reasoning).toEqual({ effort: "high" })
		})

		it("should return correct reasoning format for openrouter with reasoning budget", () => {
			const model: ModelInfo = {
				...baseModel,
				requiredReasoningBudget: true,
			}

			const result = getModelParams({
				...openrouterParams,
				settings: { modelMaxTokens: 4000 },
				model,
			})

			expect(result.reasoning).toEqual({ max_tokens: 3200 })
		})

		it("should return undefined reasoning for anthropic with reasoning effort", () => {
			const model: ModelInfo = {
				...baseModel,
				supportsReasoningEffort: true,
				reasoningEffort: "medium",
			}

			const result = getModelParams({
				...anthropicParams,
				settings: {},
				model,
			})

			expect(result.reasoning).toBeUndefined()
		})
	})
})
