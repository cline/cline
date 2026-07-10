import type { ApiConfiguration, ModelInfo } from "@shared/api"
import { clinePassDefaultModelId, clinePassModels } from "@shared/api"
import { describe, expect, it } from "vitest"
import { normalizeApiConfiguration, syncModeConfigurations } from "../providerUtils"

describe("providerUtils", () => {
	const freeModelInfo: ModelInfo = {
		maxTokens: 32_768,
		contextWindow: 256_000,
		supportsImages: false,
		supportsPromptCache: false,
		supportsReasoning: true,
		inputPrice: 0,
		outputPrice: 0,
		cacheReadsPrice: 0,
		cacheWritesPrice: 0,
		description: "A free model",
	}

	describe("normalizeApiConfiguration cline-pass", () => {
		it("passes a free (non cline-pass prefixed) model id through with its stored info", () => {
			const apiConfiguration: ApiConfiguration = {
				actModeApiProvider: "cline-pass",
				actModeClinePassModelId: "kwaipilot/kat-coder-pro",
				actModeClinePassModelInfo: freeModelInfo,
			}

			const normalized = normalizeApiConfiguration(apiConfiguration, "act", { isClinePassEnabled: true })
			expect(normalized.selectedProvider).toBe("cline-pass")
			expect(normalized.selectedModelId).toBe("kwaipilot/kat-coder-pro")
			expect(normalized.selectedModelInfo).toEqual(freeModelInfo)
		})

		it("passes a :free suffixed model id through with its stored info", () => {
			const apiConfiguration: ApiConfiguration = {
				actModeApiProvider: "cline-pass",
				actModeClinePassModelId: "arcee-ai/trinity-large-preview:free",
				actModeClinePassModelInfo: freeModelInfo,
			}

			const normalized = normalizeApiConfiguration(apiConfiguration, "act", { isClinePassEnabled: true })
			expect(normalized.selectedModelId).toBe("arcee-ai/trinity-large-preview:free")
			expect(normalized.selectedModelInfo).toEqual(freeModelInfo)
		})

		it("keeps cline-pass prefixed ids resolved against the static model table", () => {
			const apiConfiguration: ApiConfiguration = {
				actModeApiProvider: "cline-pass",
				actModeClinePassModelId: "cline-pass/glm-5.2",
			}

			const normalized = normalizeApiConfiguration(apiConfiguration, "act", { isClinePassEnabled: true })
			expect(normalized.selectedModelId).toBe("cline-pass/glm-5.2")
			expect(normalized.selectedModelInfo).toEqual(clinePassModels["cline-pass/glm-5.2"])
		})

		it("falls back to the default pass model when no model id is configured", () => {
			const apiConfiguration: ApiConfiguration = {
				actModeApiProvider: "cline-pass",
			}

			const normalized = normalizeApiConfiguration(apiConfiguration, "act", { isClinePassEnabled: true })
			expect(normalized.selectedModelId).toBe(clinePassDefaultModelId)
			expect(normalized.selectedModelInfo).toEqual(clinePassModels[clinePassDefaultModelId])
		})
	})

	describe("syncModeConfigurations cline-pass", () => {
		it("copies a free model id and info across plan and act modes", async () => {
			const apiConfiguration: ApiConfiguration = {
				planModeApiProvider: "cline-pass",
				actModeApiProvider: "cline-pass",
				actModeClinePassModelId: "kwaipilot/kat-coder-pro",
				actModeClinePassModelInfo: freeModelInfo,
			}

			let updates: Partial<ApiConfiguration> | undefined
			await syncModeConfigurations(apiConfiguration, "act", async (fields) => {
				updates = fields
			})

			expect(updates?.planModeClinePassModelId).toBe("kwaipilot/kat-coder-pro")
			expect(updates?.planModeClinePassModelInfo).toEqual(freeModelInfo)
			expect(updates?.actModeClinePassModelId).toBe("kwaipilot/kat-coder-pro")
		})
	})
})
