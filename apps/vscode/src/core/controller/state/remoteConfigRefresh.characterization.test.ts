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

describe("SDK session setting handlers", () => {
	it.each([
		{ storedValue: undefined, requestedValue: false, expectedPrevious: true },
		{ storedValue: false, requestedValue: true, expectedPrevious: false },
	])("rebuilds the active session when checkpoints change from $expectedPrevious to $requestedValue", async ({
		storedValue,
		requestedValue,
		expectedPrevious,
	}) => {
		const handleCheckpointsSettingChanged = vi.fn()
		const controller = {
			handleCheckpointsSettingChanged,
			stateManager: {
				getGlobalSettingsKey: vi.fn((key: string) => (key === "enableCheckpointsSetting" ? storedValue : undefined)),
				setGlobalState: vi.fn(),
			},
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
		}

		await updateSettings(controller as never, UpdateSettingsRequest.create({ enableCheckpointsSetting: requestedValue }))

		expect(controller.stateManager.setGlobalState).toHaveBeenCalledWith("enableCheckpointsSetting", requestedValue)
		expect(handleCheckpointsSettingChanged).toHaveBeenCalledWith(expectedPrevious, requestedValue)
	})

	it("does not rebuild when the effective checkpoint setting is unchanged", async () => {
		const handleCheckpointsSettingChanged = vi.fn()
		const controller = {
			handleCheckpointsSettingChanged,
			stateManager: {
				getGlobalSettingsKey: vi.fn((key: string) => (key === "enableCheckpointsSetting" ? true : undefined)),
				setGlobalState: vi.fn(),
			},
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
		}

		await updateSettings(controller as never, UpdateSettingsRequest.create({ enableCheckpointsSetting: true }))

		expect(handleCheckpointsSettingChanged).not.toHaveBeenCalled()
	})
})
