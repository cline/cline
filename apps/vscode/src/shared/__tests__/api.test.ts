import { expect } from "chai"
import { buildModelInfoNameMap, type ModelInfo, resolveClinePassModelInfo } from "../api"

describe("ClinePass model info", () => {
	const createModelInfo = (name: string, contextWindow: number): ModelInfo => ({
		name,
		contextWindow,
		maxTokens: 8_192,
		supportsPromptCache: false,
		supportsReasoning: false,
		thinkingConfig: { maxBudget: 16_384 },
	})

	it("normalizes ClinePass GLM aliases to ClinePass reasoning-effort metadata", () => {
		const modelInfo = resolveClinePassModelInfo(
			"cline-pass/z-ai/glm-5.2",
			buildModelInfoNameMap({
				"z-ai/glm-5.2": createModelInfo("OpenRouter GLM 5.2", 128_000),
			}),
		)

		expect(modelInfo.contextWindow).to.equal(202_752)
		expect(modelInfo.supportsReasoning).to.equal(true)
		expect(modelInfo.thinkingConfig).to.equal(undefined)
	})

	it("normalizes dynamic ClinePass model info to reasoning effort instead of thinking budgets", () => {
		const modelInfo = resolveClinePassModelInfo(
			"cline-pass/new-model",
			buildModelInfoNameMap({
				"zai/new-model": createModelInfo("New model", 1_000_000),
			}),
		)

		expect(modelInfo.name).to.equal("New model")
		expect(modelInfo.supportsReasoning).to.equal(true)
		expect(modelInfo.thinkingConfig).to.equal(undefined)
	})
})
