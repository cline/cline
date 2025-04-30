// npx jest src/api/providers/fetchers/__tests__/openrouter.test.ts

import path from "path"

import { back as nockBack } from "nock"

import { PROMPT_CACHING_MODELS } from "../../../../shared/api"

import { getOpenRouterModels } from "../openrouter"

nockBack.fixtures = path.join(__dirname, "fixtures")
nockBack.setMode("lockdown")

describe("OpenRouter API", () => {
	describe("getOpenRouterModels", () => {
		it.skip("fetches models and validates schema", async () => {
			const { nockDone } = await nockBack("openrouter-models.json")

			const models = await getOpenRouterModels()

			expect(
				Object.entries(models)
					.filter(([_, model]) => model.supportsPromptCache)
					.map(([id, _]) => id)
					.sort(),
			).toEqual(Array.from(PROMPT_CACHING_MODELS).sort())

			expect(
				Object.entries(models)
					.filter(([_, model]) => model.supportsComputerUse)
					.map(([id, _]) => id)
					.sort(),
			).toEqual([
				"anthropic/claude-3.5-sonnet",
				"anthropic/claude-3.5-sonnet:beta",
				"anthropic/claude-3.7-sonnet",
				"anthropic/claude-3.7-sonnet:beta",
				"anthropic/claude-3.7-sonnet:thinking",
			])

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
				thinking: false,
				supportsComputerUse: true,
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
				thinking: true,
				supportsComputerUse: true,
			})

			expect(
				Object.entries(models)
					.filter(([id, _]) => id.startsWith("anthropic/claude-3"))
					.map(([id, model]) => ({ id, maxTokens: model.maxTokens }))
					.sort(({ id: a }, { id: b }) => a.localeCompare(b)),
			).toEqual([
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
				{ id: "anthropic/claude-3.7-sonnet:beta", maxTokens: 8192 },
				{ id: "anthropic/claude-3.7-sonnet:thinking", maxTokens: 128000 },
			])

			nockDone()
		})
	})
})
