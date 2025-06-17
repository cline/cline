// npx vitest run api/providers/fetchers/__tests__/openrouter.spec.ts

import * as path from "path"

import { back as nockBack } from "nock"

import {
	OPEN_ROUTER_PROMPT_CACHING_MODELS,
	OPEN_ROUTER_COMPUTER_USE_MODELS,
	OPEN_ROUTER_REASONING_BUDGET_MODELS,
	OPEN_ROUTER_REQUIRED_REASONING_BUDGET_MODELS,
} from "@roo-code/types"

import { getOpenRouterModelEndpoints, getOpenRouterModels } from "../openrouter"

nockBack.fixtures = path.join(__dirname, "fixtures")
nockBack.setMode("lockdown")

describe("OpenRouter API", () => {
	describe("getOpenRouterModels", () => {
		it("fetches models and validates schema", async () => {
			const { nockDone } = await nockBack("openrouter-models.json")

			const models = await getOpenRouterModels()

			const openRouterSupportedCaching = Object.entries(models)
				.filter(([_, model]) => model.supportsPromptCache)
				.map(([id, _]) => id)

			// Define models that are intentionally excluded
			const excludedModels = new Set([
				"google/gemini-2.5-pro-preview", // Excluded due to lag issue (#4487)
				"google/gemini-2.5-flash", // OpenRouter doesn't report this as supporting prompt caching
				"google/gemini-2.5-flash-lite-preview-06-17", // OpenRouter doesn't report this as supporting prompt caching
			])

			const ourCachingModels = Array.from(OPEN_ROUTER_PROMPT_CACHING_MODELS).filter(
				(id) => !excludedModels.has(id),
			)

			// Verify all our caching models are actually supported by OpenRouter
			for (const modelId of ourCachingModels) {
				expect(openRouterSupportedCaching).toContain(modelId)
			}

			// Verify we have all supported models except intentionally excluded ones
			const expectedCachingModels = openRouterSupportedCaching.filter((id) => !excludedModels.has(id)).sort()

			expect(ourCachingModels.sort()).toEqual(expectedCachingModels)

			expect(
				Object.entries(models)
					.filter(([_, model]) => model.supportsComputerUse)
					.map(([id, _]) => id)
					.sort(),
			).toEqual(Array.from(OPEN_ROUTER_COMPUTER_USE_MODELS).sort())

			expect(
				Object.entries(models)
					.filter(([_, model]) => model.supportsReasoningEffort)
					.map(([id, _]) => id)
					.sort(),
			).toEqual([
				"agentica-org/deepcoder-14b-preview:free",
				"aion-labs/aion-1.0",
				"aion-labs/aion-1.0-mini",
				"anthropic/claude-3.7-sonnet:beta",
				"anthropic/claude-3.7-sonnet:thinking",
				"anthropic/claude-opus-4",
				"anthropic/claude-sonnet-4",
				"arliai/qwq-32b-arliai-rpr-v1:free",
				"cognitivecomputations/dolphin3.0-r1-mistral-24b:free",
				"deepseek/deepseek-r1",
				"deepseek/deepseek-r1-distill-llama-70b",
				"deepseek/deepseek-r1-distill-llama-70b:free",
				"deepseek/deepseek-r1-distill-llama-8b",
				"deepseek/deepseek-r1-distill-qwen-1.5b",
				"deepseek/deepseek-r1-distill-qwen-14b",
				"deepseek/deepseek-r1-distill-qwen-14b:free",
				"deepseek/deepseek-r1-distill-qwen-32b",
				"deepseek/deepseek-r1-distill-qwen-32b:free",
				"deepseek/deepseek-r1-zero:free",
				"deepseek/deepseek-r1:free",
				"google/gemini-2.5-flash-preview-05-20",
				"google/gemini-2.5-flash-preview-05-20:thinking",
				"microsoft/mai-ds-r1:free",
				"microsoft/phi-4-reasoning-plus",
				"microsoft/phi-4-reasoning-plus:free",
				"microsoft/phi-4-reasoning:free",
				"moonshotai/kimi-vl-a3b-thinking:free",
				"nousresearch/deephermes-3-mistral-24b-preview:free",
				"open-r1/olympiccoder-32b:free",
				"openai/codex-mini",
				"openai/o1-pro",
				"perplexity/r1-1776",
				"perplexity/sonar-deep-research",
				"perplexity/sonar-reasoning",
				"perplexity/sonar-reasoning-pro",
				"qwen/qwen3-14b",
				"qwen/qwen3-14b:free",
				"qwen/qwen3-235b-a22b",
				"qwen/qwen3-235b-a22b:free",
				"qwen/qwen3-30b-a3b",
				"qwen/qwen3-30b-a3b:free",
				"qwen/qwen3-32b",
				"qwen/qwen3-32b:free",
				"qwen/qwen3-4b:free",
				"qwen/qwen3-8b",
				"qwen/qwen3-8b:free",
				"qwen/qwq-32b",
				"qwen/qwq-32b:free",
				"rekaai/reka-flash-3:free",
				"thudm/glm-z1-32b",
				"thudm/glm-z1-32b:free",
				"thudm/glm-z1-9b:free",
				"thudm/glm-z1-rumination-32b",
				"tngtech/deepseek-r1t-chimera:free",
				"x-ai/grok-3-mini-beta",
			])
			// OpenRouter is taking a while to update their models, so we exclude some known models
			const excludedReasoningBudgetModels = new Set([
				"google/gemini-2.5-flash",
				"google/gemini-2.5-flash-lite-preview-06-17",
				"google/gemini-2.5-pro",
			])

			const expectedReasoningBudgetModels = Array.from(OPEN_ROUTER_REASONING_BUDGET_MODELS)
				.filter((id) => !excludedReasoningBudgetModels.has(id))
				.sort()

			expect(
				Object.entries(models)
					.filter(([_, model]) => model.supportsReasoningBudget)
					.map(([id, _]) => id)
					.sort(),
			).toEqual(expectedReasoningBudgetModels)

			const excludedRequiredReasoningBudgetModels = new Set(["google/gemini-2.5-pro"])

			const expectedRequiredReasoningBudgetModels = Array.from(OPEN_ROUTER_REQUIRED_REASONING_BUDGET_MODELS)
				.filter((id) => !excludedRequiredReasoningBudgetModels.has(id))
				.sort()

			expect(
				Object.entries(models)
					.filter(([_, model]) => model.requiredReasoningBudget)
					.map(([id, _]) => id)
					.sort(),
			).toEqual(expectedRequiredReasoningBudgetModels)

			expect(models["anthropic/claude-3.7-sonnet"]).toEqual({
				maxTokens: 8192,
				contextWindow: 200000,
				supportsImages: true,
				supportsPromptCache: true,
				inputPrice: 3,
				outputPrice: 15,
				cacheWritesPrice: 3.75,
				cacheReadsPrice: 0.3,
				description: expect.any(String),
				supportsComputerUse: true,
				supportsReasoningBudget: false,
				supportsReasoningEffort: false,
				supportedParameters: ["max_tokens", "temperature", "reasoning", "include_reasoning"],
			})

			expect(models["anthropic/claude-3.7-sonnet:thinking"]).toEqual({
				maxTokens: 128000,
				contextWindow: 200000,
				supportsImages: true,
				supportsPromptCache: true,
				inputPrice: 3,
				outputPrice: 15,
				cacheWritesPrice: 3.75,
				cacheReadsPrice: 0.3,
				description: expect.any(String),
				supportsComputerUse: true,
				supportsReasoningBudget: true,
				requiredReasoningBudget: true,
				supportsReasoningEffort: true,
				supportedParameters: ["max_tokens", "temperature", "reasoning", "include_reasoning"],
			})

			expect(models["google/gemini-2.5-flash-preview-05-20"].maxTokens).toEqual(65535)

			const anthropicModels = Object.entries(models)
				.filter(([id, _]) => id.startsWith("anthropic/claude-3"))
				.map(([id, model]) => ({ id, maxTokens: model.maxTokens }))
				.sort(({ id: a }, { id: b }) => a.localeCompare(b))

			expect(anthropicModels).toEqual([
				{ id: "anthropic/claude-3-haiku", maxTokens: 4096 },
				{ id: "anthropic/claude-3-haiku:beta", maxTokens: 4096 },
				{ id: "anthropic/claude-3-opus", maxTokens: 4096 },
				{ id: "anthropic/claude-3-opus:beta", maxTokens: 4096 },
				{ id: "anthropic/claude-3-sonnet", maxTokens: 4096 },
				{ id: "anthropic/claude-3-sonnet:beta", maxTokens: 4096 },
				{ id: "anthropic/claude-3.5-haiku", maxTokens: 8192 },
				{ id: "anthropic/claude-3.5-haiku-20241022", maxTokens: 8192 },
				{ id: "anthropic/claude-3.5-haiku-20241022:beta", maxTokens: 8192 },
				{ id: "anthropic/claude-3.5-haiku:beta", maxTokens: 8192 },
				{ id: "anthropic/claude-3.5-sonnet", maxTokens: 8192 },
				{ id: "anthropic/claude-3.5-sonnet-20240620", maxTokens: 8192 },
				{ id: "anthropic/claude-3.5-sonnet-20240620:beta", maxTokens: 8192 },
				{ id: "anthropic/claude-3.5-sonnet:beta", maxTokens: 8192 },
				{ id: "anthropic/claude-3.7-sonnet", maxTokens: 8192 },
				{ id: "anthropic/claude-3.7-sonnet:beta", maxTokens: 128000 },
				{ id: "anthropic/claude-3.7-sonnet:thinking", maxTokens: 128000 },
			])

			nockDone()
		})
	})

	describe("getOpenRouterModelEndpoints", () => {
		it("fetches model endpoints and validates schema", async () => {
			const { nockDone } = await nockBack("openrouter-model-endpoints.json")
			const endpoints = await getOpenRouterModelEndpoints("google/gemini-2.5-pro-preview")

			expect(endpoints).toEqual({
				Google: {
					maxTokens: 65535,
					contextWindow: 1048576,
					supportsImages: true,
					supportsPromptCache: true,
					supportsReasoningBudget: true,
					inputPrice: 1.25,
					outputPrice: 10,
					cacheWritesPrice: 1.625,
					cacheReadsPrice: 0.31,
					description: undefined,
					supportsReasoningEffort: undefined,
					supportedParameters: undefined,
				},
				"Google AI Studio": {
					maxTokens: 65536,
					contextWindow: 1048576,
					supportsImages: true,
					supportsPromptCache: true,
					supportsReasoningBudget: true,
					inputPrice: 1.25,
					outputPrice: 10,
					cacheWritesPrice: 1.625,
					cacheReadsPrice: 0.31,
					description: undefined,
					supportsReasoningEffort: undefined,
					supportedParameters: undefined,
				},
			})

			nockDone()
		})
	})
})
