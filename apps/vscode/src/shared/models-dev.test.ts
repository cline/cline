import { expect } from "chai"
import { afterEach, describe, it } from "mocha"
import { anthropicModels, type ModelInfo } from "./api"
import {
	applyModelsDevProviderModels,
	type ModelsDevPayload,
	mergeModelsDevModels,
	normalizeModelsDevProviderModels,
} from "./models-dev"

describe("models.dev static provider augmentation", () => {
	const augmentedAnthropicModelId = "claude-test-model-from-models-dev"

	afterEach(() => {
		delete (anthropicModels as Record<string, ModelInfo>)[augmentedAnthropicModelId]
	})

	it("normalizes supported models.dev models and filters unsupported entries", () => {
		const payload: ModelsDevPayload = {
			anthropic: {
				models: {
					[augmentedAnthropicModelId]: {
						name: "Claude Test",
						tool_call: true,
						reasoning: true,
						reasoning_options: [{ type: "effort", values: ["low", "medium", "high"] }],
						release_date: "2026-01-01",
						limit: {
							context: 200_000,
							output: 64_000,
						},
						cost: {
							input: 3,
							output: 15,
							cache_read: 0.3,
							cache_write: 3.75,
						},
						modalities: {
							input: ["text", "image"],
						},
					},
					"claude-deprecated": {
						tool_call: true,
						status: "deprecated",
					},
					"claude-no-tools": {
						tool_call: false,
					},
				},
			},
		}

		const providerModels = normalizeModelsDevProviderModels(payload)
		const model = providerModels.anthropic?.[augmentedAnthropicModelId]

		expect(model).to.not.equal(undefined)
		expect(model?.name).to.equal("Claude Test")
		expect(model?.contextWindow).to.equal(200_000)
		expect(model?.maxTokens).to.equal(64_000)
		expect(model?.supportsImages).to.equal(true)
		expect(model?.supportsPromptCache).to.equal(true)
		expect(model?.supportsReasoning).to.equal(true)
		expect(model?.supportsReasoningEffort).to.equal(true)
		expect(model?.inputPrice).to.equal(3)
		expect(providerModels.anthropic?.["claude-deprecated"]).to.equal(undefined)
		expect(providerModels.anthropic?.["claude-no-tools"]).to.equal(undefined)
	})

	it("keeps hardcoded model info while appending missing models.dev ids", () => {
		const staticModels: Record<string, ModelInfo> = {
			existing: {
				maxTokens: 1,
				contextWindow: 1,
				supportsPromptCache: false,
				inputPrice: 1,
				outputPrice: 1,
			},
		}
		const modelsDevModels: Record<string, ModelInfo> = {
			existing: {
				maxTokens: 2,
				contextWindow: 2,
				supportsPromptCache: true,
				inputPrice: 2,
				outputPrice: 2,
			},
			added: {
				maxTokens: 3,
				contextWindow: 3,
				supportsPromptCache: false,
				inputPrice: 3,
				outputPrice: 3,
			},
		}

		const merged = mergeModelsDevModels(staticModels, modelsDevModels)

		expect(merged.existing.maxTokens).to.equal(1)
		expect(merged.added.maxTokens).to.equal(3)
		expect(Object.keys(merged)).to.deep.equal(["existing", "added"])
	})

	it("applies missing models.dev ids to existing static provider maps", () => {
		const modelInfo: ModelInfo = {
			maxTokens: 64_000,
			contextWindow: 200_000,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
			inputPrice: 3,
			outputPrice: 15,
			cacheReadsPrice: 0.3,
			cacheWritesPrice: 3.75,
		}

		applyModelsDevProviderModels({
			anthropic: {
				[augmentedAnthropicModelId]: modelInfo,
			},
		})

		expect((anthropicModels as Record<string, ModelInfo>)[augmentedAnthropicModelId]).to.deep.equal(modelInfo)
	})
})
