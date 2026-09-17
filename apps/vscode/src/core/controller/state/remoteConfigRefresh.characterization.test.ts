import { Empty } from "@shared/proto/cline/common"
import { UpdateSettingsRequest } from "@shared/proto/cline/state"
import { describe, expect, it, vi } from "vitest"
import { refreshRemoteConfig } from "./refreshRemoteConfig"
import { updateSettings } from "./updateSettings"

describe("SDK remote-config refresh handlers", () => {
	it("uses the authoritative SDK path for manual refresh", async () => {
		const sdkRefresh = vi.fn().mockResolvedValue(undefined)
		const controller = { refreshRemoteConfig: sdkRefresh }

		await refreshRemoteConfig(controller as never, Empty.create())

		expect(sdkRefresh).toHaveBeenCalledOnce()
	})

	it.each([
		{ previousValue: true, requestedValue: false, description: "re-enabling" },
		{ previousValue: false, requestedValue: true, description: "opting out" },
	])("awaits the authoritative SDK path when $description remote config", async ({ previousValue, requestedValue }) => {
		const sdkRefresh = vi.fn().mockResolvedValue(undefined)
		const controller = {
			refreshRemoteConfig: sdkRefresh,
			stateManager: {
				getGlobalSettingsKey: vi.fn((key: string) => (key === "optOutOfRemoteConfig" ? previousValue : undefined)),
				setGlobalState: vi.fn(),
			},
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
		}

		await updateSettings(
			controller as never,
			UpdateSettingsRequest.create({
				optOutOfRemoteConfig: requestedValue,
			}),
		)

		expect(controller.stateManager.setGlobalState).toHaveBeenCalledWith("optOutOfRemoteConfig", requestedValue)
		expect(sdkRefresh).toHaveBeenCalledOnce()
	})
})
