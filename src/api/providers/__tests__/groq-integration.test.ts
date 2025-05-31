import { describe, it, before } from "mocha"
import { expect } from "chai"
import axios from "axios"
import { GroqHandler } from "../groq"
import { groqDefaultModelId, groqModels } from "../../../shared/api"
import { refreshGroqModels } from "../../../core/controller/models/refreshGroqModels"
import { Controller } from "../../../core/controller"
import * as vscode from "vscode"

describe("GroqHandler Integration Tests", () => {
	let groqApiAvailable = false
	let apiKey: string | undefined

	// Check if Groq API is available before running tests
	before(async function () {
		this.timeout(10000)
		apiKey = process.env.GROQ_API_KEY

		if (apiKey) {
			try {
				// Test API connectivity with a simple models request
				const response = await axios.get("https://api.groq.com/openai/v1/models", {
					headers: {
						Authorization: `Bearer ${apiKey}`,
						"Content-Type": "application/json",
						"User-Agent": "Cline-VSCode-Extension-Test",
					},
					timeout: 5000,
				})

				if (response.data?.data && Array.isArray(response.data.data)) {
					groqApiAvailable = true
					console.log(`Groq API available with ${response.data.data.length} models`)
				}
			} catch (error) {
				console.log("Groq API not available or invalid key, skipping integration tests")
				console.log("Set GROQ_API_KEY environment variable to run these tests")
				groqApiAvailable = false
			}
		} else {
			console.log("GROQ_API_KEY environment variable not set, skipping integration tests")
		}
	})

	it("should fetch models from Groq API", async function () {
		if (!groqApiAvailable || !apiKey) {
			this.skip()
		}
		this.timeout(10000)

		const response = await axios.get("https://api.groq.com/openai/v1/models", {
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
				"User-Agent": "Cline-VSCode-Extension-Test",
			},
			timeout: 5000,
		})

		expect(response.status).to.equal(200)
		expect(response.data).to.have.property("data")
		expect(response.data.data).to.be.an("array")
		expect(response.data.data.length).to.be.greaterThan(0)

		// Check that we have the expected models
		const modelIds = response.data.data.map((model: any) => model.id)

		// Verify Llama 4 models have proper prefixes
		expect(modelIds).to.include("meta-llama/llama-4-scout-17b-16e-instruct")
		expect(modelIds).to.include("meta-llama/llama-4-maverick-17b-128e-instruct")
		expect(modelIds).to.include("meta-llama/llama-guard-4-12b")

		// Verify other expected models
		expect(modelIds).to.include("llama-3.1-8b-instant")
		expect(modelIds).to.include("llama-3.3-70b-versatile")
		expect(modelIds).to.include("deepseek-r1-distill-llama-70b")
	})

	it("should validate model specifications match API response", async function () {
		if (!groqApiAvailable || !apiKey) {
			this.skip()
		}
		this.timeout(10000)

		const response = await axios.get("https://api.groq.com/openai/v1/models", {
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
				"User-Agent": "Cline-VSCode-Extension-Test",
			},
			timeout: 5000,
		})

		const apiModels = response.data.data

		// Test specific models that we fixed
		const testCases = [
			{
				modelId: "meta-llama/llama-4-scout-17b-16e-instruct",
				expectedContextWindow: 131072,
				expectedMaxTokens: 8192,
			},
			{
				modelId: "meta-llama/llama-4-maverick-17b-128e-instruct",
				expectedContextWindow: 131072,
				expectedMaxTokens: 8192,
			},
			{
				modelId: "meta-llama/llama-guard-4-12b",
				expectedContextWindow: 131072,
				expectedMaxTokens: 1024,
			},
			{
				modelId: "llama-3.1-8b-instant",
				expectedContextWindow: 131072,
				expectedMaxTokens: 131072,
			},
		]

		for (const testCase of testCases) {
			const apiModel = apiModels.find((model: any) => model.id === testCase.modelId)
			expect(apiModel, `Model ${testCase.modelId} should exist in API response`).to.exist

			expect(apiModel.context_window).to.equal(testCase.expectedContextWindow, `Context window for ${testCase.modelId}`)
			expect(apiModel.max_completion_tokens).to.equal(testCase.expectedMaxTokens, `Max tokens for ${testCase.modelId}`)

			// Verify our static model info matches
			const staticModel = groqModels[testCase.modelId as keyof typeof groqModels]
			if (staticModel) {
				expect(staticModel.contextWindow).to.equal(
					testCase.expectedContextWindow,
					`Static context window for ${testCase.modelId}`,
				)
				expect(staticModel.maxTokens).to.equal(testCase.expectedMaxTokens, `Static max tokens for ${testCase.modelId}`)
			}
		}
	})

	it("should validate GroqHandler works with real API models", async function () {
		if (!groqApiAvailable || !apiKey) {
			this.skip()
		}
		this.timeout(5000)

		// Test with Llama 4 Scout model that we fixed
		const handler = new GroqHandler({
			groqApiKey: apiKey,
			apiModelId: "meta-llama/llama-4-scout-17b-16e-instruct",
		})

		const model = handler.getModel()
		expect(model.id).to.equal("meta-llama/llama-4-scout-17b-16e-instruct")
		expect(model.info.contextWindow).to.equal(131072)
		expect(model.info.maxTokens).to.equal(8192)
		expect(model.info.inputPrice).to.equal(0.31)
		expect(model.info.outputPrice).to.equal(0.36)
	})

	it("should handle API errors gracefully", async function () {
		if (!groqApiAvailable) {
			this.skip()
		}
		this.timeout(10000)

		// Test with invalid API key
		try {
			await axios.get("https://api.groq.com/openai/v1/models", {
				headers: {
					Authorization: "Bearer invalid-key",
					"Content-Type": "application/json",
					"User-Agent": "Cline-VSCode-Extension-Test",
				},
				timeout: 5000,
			})
			// Should not reach here
			expect.fail("Expected API call to fail with invalid key")
		} catch (error) {
			if (axios.isAxiosError(error)) {
				expect(error.response?.status).to.equal(401)
			} else {
				throw error
			}
		}
	})

	it("should validate all static models exist in API", async function () {
		if (!groqApiAvailable || !apiKey) {
			this.skip()
		}
		this.timeout(10000)

		const response = await axios.get("https://api.groq.com/openai/v1/models", {
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
				"User-Agent": "Cline-VSCode-Extension-Test",
			},
			timeout: 5000,
		})

		const apiModelIds = response.data.data.map((model: any) => model.id)
		const staticModelIds = Object.keys(groqModels)

		// Check that all our static models exist in the API
		// (Note: API might have more models than our static list)
		for (const staticModelId of staticModelIds) {
			// Skip deprecated models that might not be in API anymore
			if (staticModelId.includes("llama3-") && staticModelId.includes("-8192")) {
				continue // These are legacy model IDs
			}

			expect(apiModelIds).to.include(staticModelId, `Static model ${staticModelId} should exist in API response`)
		}
	})

	it("should validate vision model capabilities", async function () {
		if (!groqApiAvailable || !apiKey) {
			this.skip()
		}
		this.timeout(5000)

		// Test Llama 4 Maverick which should support vision
		const handler = new GroqHandler({
			groqApiKey: apiKey,
			apiModelId: "meta-llama/llama-4-maverick-17b-128e-instruct",
		})

		const model = handler.getModel()
		expect(model.id).to.equal("meta-llama/llama-4-maverick-17b-128e-instruct")
		expect(model.info.supportsImages).to.equal(true, "Llama 4 Maverick should support images")
		expect(model.info.contextWindow).to.equal(131072)
		expect(model.info.inputPrice).to.equal(0.2)
		expect(model.info.outputPrice).to.equal(0.6)
	})
})
