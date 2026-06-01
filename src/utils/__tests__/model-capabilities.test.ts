import { describe, it } from "mocha"
import "should"
import { getModelCapabilityTier, recommendedMaxMistakes, supportsAutoCondense } from "../model-capabilities"

const info = (id: string) => ({ model: { id } }) as any

describe("model-capabilities — getModelCapabilityTier", () => {
	it("classifies Claude-4 as frontier", () => {
		getModelCapabilityTier(info("claude-sonnet-4-5")).should.equal("frontier")
	})

	it("classifies GPT-5 / Gemini-2.5 / Grok-4 as frontier", () => {
		getModelCapabilityTier(info("gpt-5")).should.equal("frontier")
		getModelCapabilityTier(info("gemini-2.5-pro")).should.equal("frontier")
		getModelCapabilityTier(info("grok-4")).should.equal("frontier")
	})

	it("classifies DeepSeek-v4 (pro + flash) as capable-open", () => {
		getModelCapabilityTier(info("deepseek-v4-pro")).should.equal("capable-open")
		getModelCapabilityTier(info("deepseek-v4-flash")).should.equal("capable-open")
	})

	it("classifies deprecated deepseek aliases as capable-open", () => {
		getModelCapabilityTier(info("deepseek-chat")).should.equal("capable-open")
		getModelCapabilityTier(info("deepseek-reasoner")).should.equal("capable-open")
	})

	it("classifies unknown / weak models as basic", () => {
		getModelCapabilityTier(info("some-random-7b")).should.equal("basic")
		getModelCapabilityTier(info("llama-3-8b")).should.equal("basic")
	})
})

describe("model-capabilities — derived policy", () => {
	it("enables auto-condense for frontier and capable-open, not basic", () => {
		supportsAutoCondense("frontier").should.be.true()
		supportsAutoCondense("capable-open").should.be.true()
		supportsAutoCondense("basic").should.be.false()
	})

	it("gives weaker tiers a higher mistake budget", () => {
		recommendedMaxMistakes("frontier").should.equal(3)
		recommendedMaxMistakes("capable-open").should.equal(5)
		recommendedMaxMistakes("basic").should.equal(5)
	})
})
