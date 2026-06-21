import { ApiConfiguration, ModelsApiOptions, UpdateApiConfigurationRequestNew } from "@shared/proto/cline/models"
import { describe, expect, it, vi } from "vitest"
import type { ProviderConfigStore } from "@/sdk/model-catalog/contracts"
import { updateApiConfiguration } from "../updateApiConfiguration"

function makeStore(): ProviderConfigStore {
	return {
		read: vi.fn((providerId) => ({ providerId })),
		readSelection: vi.fn(() => undefined),
		subscribe: vi.fn(() => ({ dispose: vi.fn() })),
		write: vi.fn((providerId) => ({ providerId })),
		commitSelection: vi.fn(),
	}
}

describe("updateApiConfiguration", () => {
	it("stores masked SDK provider id fields under legacy provider keys", async () => {
		const setGlobalStateBatch = vi.fn()
		const controller = {
			getProviderConfigStore: () => makeStore(),
			stateManager: {
				getApiConfiguration: vi.fn(() => ({ actModeApiProvider: "anthropic", planModeApiProvider: "anthropic" })),
				getGlobalSettingsKey: vi.fn((key: string) => (key === "planActSeparateModelsSetting" ? false : "act")),
				setGlobalStateBatch,
			},
			postStateToWebview: vi.fn(async () => undefined),
		} as any

		await updateApiConfiguration(
			controller,
			UpdateApiConfigurationRequestNew.create({
				updates: ApiConfiguration.create({
					options: ModelsApiOptions.create({
						actModeApiProviderId: "poolside",
					}),
				}),
				updateMask: ["options.actModeApiProviderId"],
			}),
		)

		expect(setGlobalStateBatch).toHaveBeenCalledWith(
			expect.objectContaining({
				actModeApiProvider: "poolside",
				planModeApiProvider: "poolside",
			}),
		)
	})
})
