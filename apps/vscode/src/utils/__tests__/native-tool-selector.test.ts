import type { ApiHandlerModel, ApiProviderInfo } from "@core/api"
import { expect } from "chai"
import { describe, it } from "mocha"
import "should"
import { PromptRegistry } from "@/core/prompts/system-prompt/registry/PromptRegistry"
import type { SystemPromptContext } from "@/core/prompts/system-prompt/types"
import { ModelFamily } from "@/shared/prompts"
import { FeatureFlag, FeatureFlagDefaultValue } from "@/shared/services/feature-flags/feature-flags"
import {
	isClineProvider,
	isNativeToolCallingConfig,
	isParallelToolCallingEnabled,
} from "../model-utils"

const providerInfo = (providerId: string, modelId: string): ApiProviderInfo => ({
	providerId,
	model: { id: modelId, info: { supportsPromptCache: false } } as ApiHandlerModel,
	mode: "act",
})

const reportModels = [
	"deepseek/deepseek-v4-pro",
	"deepseek/deepseek-v4-flash",
	"zai/glm-5.2",
	"stepfun/step-3.7-flash-20260528",
	"stepfun/step-3.5-flash",
	"xiaomi/mimo-v2.5-20260422",
	"google/gemma-4-31b-it",
	"alibaba/qwen3.6-plus",
	"alibaba/qwen3.7-max",
	"alibaba/qwen3.7-plus",
	"minimax/minimax-m3",
	"minimax/minimax-m2.5-20260211",
	"moonshotai/kimi-k2.7-code",
	"google/gemini-3.1-flash-lite",
	"poolside/laguna-m.1",
]

describe("native tool selector", () => {
	it("should default the Cline Provider rollout to disabled", () => {
		expect(FeatureFlagDefaultValue[FeatureFlag.CLINE_PROVIDER_NATIVE_TOOLS]).to.equal(false)
	})

	it("should make the rollout flag additive for Cline Provider", () => {
		const provider = providerInfo("cline", "any-model")
		isNativeToolCallingConfig(provider, false, true).should.equal(true)
	})

	it("should preserve original Cline behavior when the rollout flag is disabled", () => {
		isNativeToolCallingConfig(providerInfo("cline", "minimax-m3"), true, false).should.equal(true)
		isNativeToolCallingConfig(providerInfo("cline", "zai/glm-5.2"), true, false).should.equal(false)
		isNativeToolCallingConfig(providerInfo("cline", "zai/glm-5.2"), false, false).should.equal(false)

		const registry = PromptRegistry.getInstance()
		const glmFamily = registry.getModelFamily({
			providerInfo: providerInfo("cline", "zai/glm-5.2"),
			enableNativeToolCalls: true,
			enableAllClineProviderNativeTools: false,
		} as SystemPromptContext)
		const minimaxFamily = registry.getModelFamily({
			providerInfo: providerInfo("cline", "minimax-m3"),
			enableNativeToolCalls: true,
			enableAllClineProviderNativeTools: false,
		} as SystemPromptContext)
		expect(glmFamily).to.equal(ModelFamily.GLM)
		expect(minimaxFamily).to.equal(ModelFamily.NATIVE_NEXT_GEN)
	})

	it("should ignore the rollout flag for other providers", () => {
		isNativeToolCallingConfig(providerInfo("openrouter", "unrecognized-model"), false, true).should.equal(false)
	})

	it("should enable native tools for every model on Cline Provider", () => {
		const registry = PromptRegistry.getInstance()

		for (const modelId of reportModels) {
			const provider = providerInfo("cline", modelId)
			isNativeToolCallingConfig(provider, true, true).should.equal(true)
			const family = registry.getModelFamily({
				providerInfo: provider,
				enableNativeToolCalls: true,
				enableAllClineProviderNativeTools: true,
			} as SystemPromptContext)
			expect([ModelFamily.NATIVE_NEXT_GEN, ModelFamily.GEMINI_3]).to.include(family)
		}
	})

	it("should limit the model-family bypass to Cline Provider", () => {
		isClineProvider(providerInfo("CLINE", "any-model")).should.equal(true)
		isNativeToolCallingConfig(providerInfo("cline-pass", "unrecognized-future-model"), true).should.equal(false)
		isNativeToolCallingConfig(providerInfo("deepseek", "deepseek-v4-pro"), true).should.equal(false)
		isNativeToolCallingConfig(providerInfo("openrouter", "zai/glm-5.2"), true).should.equal(false)
	})

	it("should retain legacy native selection for other providers", () => {
		isNativeToolCallingConfig(providerInfo("minimax", "minimax-m3"), true).should.equal(true)
		isNativeToolCallingConfig(providerInfo("openrouter", "moonshotai/kimi-k2.7-code"), true).should.equal(true)
	})

	it("should retain the setting guard", () => {
		isNativeToolCallingConfig(providerInfo("cline", "any-model"), false).should.equal(false)
	})

	it("should not infer parallel tool support for an unrecognized model", () => {
		const provider = providerInfo("cline", "unrecognized-future-model")
		isParallelToolCallingEnabled(false, provider).should.equal(false)
		isParallelToolCallingEnabled(true, provider).should.equal(true)
	})
})
