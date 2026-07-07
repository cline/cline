import { expect } from "chai"
import {
	buildModelInfoNameMap,
	clinePassModelInfoSaneDefaults,
	internationalZAiModels,
	mainlandZAiModels,
	type ModelInfo,
	resolveClinePassModelInfo,
} from "../api"

describe("ClinePass model info", () => {
	const createModelInfo = (name: string, contextWindow: number): ModelInfo => ({
		name,
		contextWindow,
		maxTokens: 8_192,
		supportsPromptCache: false,
		supportsReasoning: false,
		thinkingConfig: { maxBudget: 16_384 },
	})

	it("prefers dynamic model metadata for ClinePass GLM aliases", () => {
		const modelInfo = resolveClinePassModelInfo(
			"cline-pass/z-ai/glm-5.2",
			buildModelInfoNameMap({
				"z-ai/glm-5.2": createModelInfo("OpenRouter GLM 5.2", 1_000_000),
			}),
		)

		expect(modelInfo.name).to.equal("OpenRouter GLM 5.2")
		expect(modelInfo.contextWindow).to.equal(1_000_000)
		expect(modelInfo.thinkingConfig).to.deep.equal({ maxBudget: 16_384 })
	})

	it("falls back to static ClinePass metadata when dynamic metadata is unavailable", () => {
		const modelInfo = resolveClinePassModelInfo("cline-pass/glm-5.2")

		expect(modelInfo.contextWindow).to.equal(202_752)
		expect(modelInfo.supportsReasoning).to.equal(true)
		expect(modelInfo.thinkingConfig).to.equal(undefined)
	})

	it("preserves dynamic ClinePass model info when no static alias exists", () => {
		const modelInfo = resolveClinePassModelInfo(
			"cline-pass/new-model",
			buildModelInfoNameMap({
				"zai/new-model": createModelInfo("New model", 1_000_000),
			}),
		)

		expect(modelInfo.name).to.equal("New model")
		expect(modelInfo.supportsReasoning).to.equal(false)
		expect(modelInfo.thinkingConfig).to.deep.equal({ maxBudget: 16_384 })
	})

	it("returns stored info for a free (non cline-pass prefixed) model id", () => {
		const freeModelInfo = createModelInfo("Trinity Large Preview", 512_000)
		const modelInfo = resolveClinePassModelInfo(
			"arcee-ai/trinity-large-preview:free",
			buildModelInfoNameMap({ "arcee-ai/trinity-large-preview:free": freeModelInfo }),
		)

		expect(modelInfo).to.deep.equal(freeModelInfo)
	})

	it("falls back to sane defaults for a free model id without dynamic metadata", () => {
		const modelInfo = resolveClinePassModelInfo("kwaipilot/kat-coder-pro")

		expect(modelInfo).to.deep.equal(clinePassModelInfoSaneDefaults)
	})
})

describe("Z AI model info", () => {
	it("includes GLM 5.2 for both direct Z AI entrypoints", () => {
		for (const models of [internationalZAiModels, mainlandZAiModels]) {
			expect(models["glm-5.2"].contextWindow).to.equal(1_000_000)
			expect(models["glm-5.2"].maxTokens).to.equal(128_000)
			expect(models["glm-5.2"].inputPrice).to.equal(1.4)
			expect(models["glm-5.2"].outputPrice).to.equal(4.4)
			expect(models["glm-5.2"].cacheReadsPrice).to.equal(0.26)
		}
	})
})
