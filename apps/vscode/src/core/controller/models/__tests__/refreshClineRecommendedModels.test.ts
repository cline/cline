import { describe, expect, it, vi } from "vitest"
import { getModelProviderSettingsManager } from "@/sdk/model-provider-settings"
import { refreshClineRecommendedModels } from "../refreshClineRecommendedModels"

vi.mock("@/sdk/model-provider-settings", () => ({ getModelProviderSettingsManager: vi.fn() }))

describe("refreshClineRecommendedModels", () => {
	it("waits for the configured manager and delegates recommendations", async () => {
		const data = { recommended: [], free: [], clinePass: [] }
		const getRecommendedModels = vi.fn(async () => data)
		let release!: (manager: Awaited<ReturnType<typeof getModelProviderSettingsManager>>) => void
		vi.mocked(getModelProviderSettingsManager).mockReturnValue(
			new Promise((resolve) => {
				release = resolve
			}),
		)
		const request = refreshClineRecommendedModels()
		expect(getRecommendedModels).not.toHaveBeenCalled()
		release({ getRecommendedModels } as unknown as Awaited<ReturnType<typeof getModelProviderSettingsManager>>)
		expect(await request).toEqual(data)
		expect(getRecommendedModels).toHaveBeenCalledOnce()
	})
})
