import type { ModelInfo } from "@shared/api"
import { describe, expect, it } from "vitest"
import {
	CLINE_AUTO_MODEL_ID,
	CLINE_PASS_AUTO_MODEL_ID,
	shouldNormalizeClineAutoModel,
	withClineAutoModels,
} from "./clineAutoModels"

const catalog: Record<string, ModelInfo> = {
	"anthropic/claude-sonnet": {
		name: "Claude Sonnet",
		supportsPromptCache: true,
	},
}

describe("withClineAutoModels", () => {
	it("does not expose either virtual model while the picker flag is disabled", () => {
		const models = withClineAutoModels(
			{
				...catalog,
				[CLINE_AUTO_MODEL_ID]: { name: "Endpoint Auto", supportsPromptCache: true },
				[CLINE_PASS_AUTO_MODEL_ID]: { name: "Endpoint Pass Auto", supportsPromptCache: true },
			},
			{ enabled: false, isClinePassAutoModelEnabled: true },
		)

		expect(models).toEqual(catalog)
	})

	it("exposes only cline/auto when Cline Pass is not enabled", () => {
		const models = withClineAutoModels(catalog, { enabled: true, isClinePassAutoModelEnabled: false })

		expect(models[CLINE_AUTO_MODEL_ID]).toMatchObject({
			name: "Cline Auto",
			supportsImages: false,
			supportsPromptCache: true,
		})
		expect(models[CLINE_PASS_AUTO_MODEL_ID]).toBeUndefined()
	})

	it("exposes both cache-aware virtual models when both rollout gates are enabled", () => {
		const models = withClineAutoModels(catalog, { enabled: true, isClinePassAutoModelEnabled: true })

		expect(models[CLINE_AUTO_MODEL_ID]?.supportsPromptCache).toBe(true)
		expect(models[CLINE_PASS_AUTO_MODEL_ID]?.supportsPromptCache).toBe(true)
		expect(models[CLINE_PASS_AUTO_MODEL_ID]?.supportsImages).toBe(false)
	})

	it("preserves live endpoint metadata when a gated virtual model is present", () => {
		const models = withClineAutoModels(
			{
				...catalog,
				[CLINE_AUTO_MODEL_ID]: {
					name: "Endpoint Auto",
					supportsPromptCache: true,
					contextWindow: 200_000,
				},
			},
			{ enabled: true, isClinePassAutoModelEnabled: false },
		)

		expect(models[CLINE_AUTO_MODEL_ID]).toEqual({
			name: "Endpoint Auto",
			supportsPromptCache: true,
			contextWindow: 200_000,
		})
	})
})

describe("shouldNormalizeClineAutoModel", () => {
	it("normalizes both virtual IDs when the master picker flag is disabled", () => {
		const options = { enabled: false, isClinePassAutoModelEnabled: true }

		expect(shouldNormalizeClineAutoModel(CLINE_AUTO_MODEL_ID, options)).toBe(true)
		expect(shouldNormalizeClineAutoModel(CLINE_PASS_AUTO_MODEL_ID, options)).toBe(true)
	})

	it("normalizes only the Pass virtual ID when its entitlement flag is disabled", () => {
		const options = { enabled: true, isClinePassAutoModelEnabled: false }

		expect(shouldNormalizeClineAutoModel(CLINE_AUTO_MODEL_ID, options)).toBe(false)
		expect(shouldNormalizeClineAutoModel(CLINE_PASS_AUTO_MODEL_ID, options)).toBe(true)
	})

	it("leaves concrete model IDs unchanged", () => {
		expect(
			shouldNormalizeClineAutoModel("anthropic/claude-sonnet", {
				enabled: false,
				isClinePassAutoModelEnabled: false,
			}),
		).toBe(false)
	})
})
