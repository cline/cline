import { expect } from "chai"
import { getProviderById, getProviderIds, isValidProviderId, PROVIDERS } from "../../../../src/core/auth/providers.js"

describe("Providers", () => {
	describe("PROVIDERS", () => {
		it("should have at least 5 providers defined", () => {
			expect(PROVIDERS.length).to.be.at.least(5)
		})

		it("should have anthropic as the first provider", () => {
			expect(PROVIDERS[0].id).to.equal("anthropic")
		})

		it("should have required fields for each provider", () => {
			for (const provider of PROVIDERS) {
				expect(provider.id).to.be.a("string").and.not.empty
				expect(provider.name).to.be.a("string").and.not.empty
				expect(provider.description).to.be.a("string").and.not.empty
				expect(provider.requiresApiKey).to.be.a("boolean")
			}
		})

		it("should have keyUrl for providers requiring API keys", () => {
			const providersRequiringKeys = PROVIDERS.filter((p) => p.requiresApiKey)
			for (const provider of providersRequiringKeys) {
				// Most should have keyUrl, but not all
				if (provider.keyUrl) {
					expect(provider.keyUrl).to.match(/^https?:\/\//)
				}
			}
		})
	})

	describe("getProviderById", () => {
		it("should return provider for valid id", () => {
			const provider = getProviderById("anthropic")
			expect(provider).to.exist
			expect(provider?.name).to.equal("Anthropic")
		})

		it("should return undefined for invalid id", () => {
			const provider = getProviderById("nonexistent")
			expect(provider).to.be.undefined
		})

		it("should return openrouter provider", () => {
			const provider = getProviderById("openrouter")
			expect(provider).to.exist
			expect(provider?.name).to.equal("OpenRouter")
		})
	})

	describe("getProviderIds", () => {
		it("should return array of provider ids", () => {
			const ids = getProviderIds()
			expect(ids).to.be.an("array")
			expect(ids).to.include("anthropic")
			expect(ids).to.include("openrouter")
			expect(ids).to.include("openai")
		})

		it("should have same length as PROVIDERS", () => {
			const ids = getProviderIds()
			expect(ids.length).to.equal(PROVIDERS.length)
		})
	})

	describe("isValidProviderId", () => {
		it("should return true for valid provider ids", () => {
			expect(isValidProviderId("anthropic")).to.be.true
			expect(isValidProviderId("openrouter")).to.be.true
			expect(isValidProviderId("openai")).to.be.true
			expect(isValidProviderId("ollama")).to.be.true
		})

		it("should return false for invalid provider ids", () => {
			expect(isValidProviderId("invalid")).to.be.false
			expect(isValidProviderId("")).to.be.false
			expect(isValidProviderId("ANTHROPIC")).to.be.false
		})
	})
})
