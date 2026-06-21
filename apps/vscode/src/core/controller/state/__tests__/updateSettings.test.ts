import { ModelsApiConfiguration } from "@shared/proto/cline/models"
import { UpdateSettingsRequest } from "@shared/proto/cline/state"
import { describe, expect, it, vi } from "vitest"
import type { ProviderConfigStore } from "@/sdk/model-catalog/contracts"
import { updateSettings } from "../updateSettings"

function makeStore(): ProviderConfigStore {
	return {
		read: vi.fn((providerId) => ({ providerId })),
		readSelection: vi.fn(() => undefined),
		subscribe: vi.fn(() => ({ dispose: vi.fn() })),
		write: vi.fn((providerId) => ({ providerId })),
		commitSelection: vi.fn(),
	}
}

describe("updateSettings", () => {
	it("honors SDK provider id string fields in full API configuration updates", async () => {
		const setApiConfiguration = vi.fn()
		const previousConfig = { actModeApiProvider: "anthropic" }
		const controller = {
			getProviderConfigStore: () => makeStore(),
			stateManager: {
				getApiConfiguration: vi.fn(() => previousConfig),
				getGlobalSettingsKey: vi.fn(() => "act"),
				setApiConfiguration,
			},
			handleApiConfigurationChanged: vi.fn(),
			postStateToWebview: vi.fn(async () => undefined),
		} as any

		await updateSettings(
			controller,
			UpdateSettingsRequest.create({
				apiConfiguration: ModelsApiConfiguration.create({
					actModeApiProviderId: "poolside",
				}),
			}),
		)

		expect(setApiConfiguration).toHaveBeenCalledWith(
			expect.objectContaining({
				actModeApiProvider: "poolside",
			}),
		)
		expect(controller.handleApiConfigurationChanged).toHaveBeenCalledWith(
			previousConfig,
			expect.objectContaining({
				actModeApiProvider: "poolside",
			}),
		)
	})
})
