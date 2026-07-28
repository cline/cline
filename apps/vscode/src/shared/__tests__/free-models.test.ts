import { expect } from "chai"
import type { ModelInfo } from "../api"
import {
	findPaidClineModelId,
	formatClineFreeModelName,
	getClineFreeModelSlug,
	isClineFreeModelId,
	resolveClineFreeModelInfo,
	zeroPricedModelInfo,
} from "../cline/free-models"

describe("Cline free models", () => {
	describe("isClineFreeModelId", () => {
		it("matches cline-free ids case-insensitively", () => {
			expect(isClineFreeModelId("cline-free/deepseek-v4-flash")).to.equal(true)
			expect(isClineFreeModelId("Cline-Free/GLM-5")).to.equal(true)
		})

		it("does not match paid or ClinePass ids", () => {
			expect(isClineFreeModelId("deepseek/deepseek-v4-flash")).to.equal(false)
			expect(isClineFreeModelId("cline-pass/glm-5.2")).to.equal(false)
			expect(isClineFreeModelId(undefined)).to.equal(false)
		})
	})

	describe("getClineFreeModelSlug", () => {
		it("returns the slug after the cline-free prefix", () => {
			expect(getClineFreeModelSlug("cline-free/deepseek-v4-flash")).to.equal("deepseek-v4-flash")
		})

		it("returns undefined for non-free ids and empty slugs", () => {
			expect(getClineFreeModelSlug("deepseek/deepseek-v4-flash")).to.equal(undefined)
			expect(getClineFreeModelSlug("cline-free/")).to.equal(undefined)
		})
	})

	describe("formatClineFreeModelName", () => {
		it("appends (free) to free model names", () => {
			expect(formatClineFreeModelName("cline-free/glm-5", "GLM 5")).to.equal("GLM 5 (free)")
		})

		it("falls back to the model id when no name is given", () => {
			expect(formatClineFreeModelName("cline-free/glm-5")).to.equal("cline-free/glm-5 (free)")
		})

		it("does not double up the (free) marker", () => {
			expect(formatClineFreeModelName("cline-free/glm-5", "GLM 5 (free)")).to.equal("GLM 5 (free)")
		})

		it("leaves paid model names untouched", () => {
			expect(formatClineFreeModelName("z-ai/glm-5", "GLM 5")).to.equal("GLM 5")
		})
	})

	describe("zeroPricedModelInfo", () => {
		it("zeroes every price while preserving capabilities", () => {
			const info: ModelInfo = {
				name: "GLM 5",
				maxTokens: 8_192,
				contextWindow: 128_000,
				supportsImages: true,
				supportsPromptCache: true,
				inputPrice: 1.5,
				outputPrice: 3,
				cacheReadsPrice: 0.5,
				cacheWritesPrice: 2,
			}

			expect(zeroPricedModelInfo(info)).to.deep.equal({
				...info,
				inputPrice: 0,
				outputPrice: 0,
				cacheReadsPrice: 0,
				cacheWritesPrice: 0,
			})
		})
	})

	describe("findPaidClineModelId", () => {
		const clineModelIds = [
			"cline-free/deepseek-v4-flash",
			"deepseek/deepseek-v4-flash",
			"z-ai/glm-5",
			"anthropic/claude-sonnet-5",
		]

		it("finds the paid counterpart by model slug", () => {
			expect(findPaidClineModelId("cline-free/deepseek-v4-flash", clineModelIds)).to.equal("deepseek/deepseek-v4-flash")
		})

		it("never returns another free model id", () => {
			expect(findPaidClineModelId("cline-free/deepseek-v4-flash", ["cline-free/deepseek-v4-flash"])).to.equal(undefined)
		})

		it("returns undefined for non-free ids or when no counterpart exists", () => {
			expect(findPaidClineModelId("deepseek/deepseek-v4-flash", clineModelIds)).to.equal(undefined)
			expect(findPaidClineModelId("cline-free/unknown-model", clineModelIds)).to.equal(undefined)
			expect(findPaidClineModelId(undefined, clineModelIds)).to.equal(undefined)
		})
	})

	describe("resolveClineFreeModelInfo", () => {
		// cline-free/ ids are never published in the models catalog, so capabilities
		// have to come from the paid twin sharing the slug.
		const clineModels: Record<string, ModelInfo> = {
			"deepseek/deepseek-v4-flash": {
				name: "DeepSeek V4 Flash",
				maxTokens: 393_216,
				contextWindow: 1_048_576,
				supportsImages: false,
				supportsPromptCache: true,
				inputPrice: 1,
				outputPrice: 2,
				cacheReadsPrice: 0.1,
				cacheWritesPrice: 0.2,
			},
		}

		it("borrows the paid twin's capabilities and zeroes the pricing", () => {
			const info = resolveClineFreeModelInfo("cline-free/deepseek-v4-flash", clineModels)

			expect(info?.contextWindow).to.equal(1_048_576)
			expect(info?.maxTokens).to.equal(393_216)
			expect(info?.supportsPromptCache).to.equal(true)
			expect(info?.inputPrice).to.equal(0)
			expect(info?.outputPrice).to.equal(0)
			expect(info?.cacheReadsPrice).to.equal(0)
			expect(info?.cacheWritesPrice).to.equal(0)
			expect(info?.name).to.equal("DeepSeek V4 Flash (free)")
		})

		it("returns undefined when there is no paid twin to borrow from", () => {
			expect(resolveClineFreeModelInfo("cline-free/unknown-model", clineModels)).to.equal(undefined)
			expect(resolveClineFreeModelInfo("cline-free/deepseek-v4-flash", {})).to.equal(undefined)
			expect(resolveClineFreeModelInfo("cline-free/deepseek-v4-flash", undefined)).to.equal(undefined)
		})

		it("ignores non-free ids", () => {
			expect(resolveClineFreeModelInfo("deepseek/deepseek-v4-flash", clineModels)).to.equal(undefined)
			expect(resolveClineFreeModelInfo(undefined, clineModels)).to.equal(undefined)
		})
	})
})
