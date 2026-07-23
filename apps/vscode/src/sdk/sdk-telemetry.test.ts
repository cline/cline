import type { ConfiguredTelemetryHandle, ITelemetryService } from "@cline/core"
import type { Mock } from "vitest"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Setting } from "@/shared/proto/index.host"

const coreTelemetryMocks = vi.hoisted(() => ({
	createConfig: vi.fn((config: Record<string, unknown>) => config),
	createHandle: vi.fn(),
}))

vi.mock("@cline/core", () => ({
	createClineTelemetryServiceConfig: coreTelemetryMocks.createConfig,
	createConfiguredTelemetryHandle: coreTelemetryMocks.createHandle,
}))

const telemetryState = vi.hoisted(() => ({
	clineTelemetrySetting: "unset" as string | undefined,
	hostSetting: 1,
	hostVersion: {
		platform: "VS Code",
		version: "1.103.0",
		clineType: "VSCode Extension",
	} as { platform?: string; version?: string; clineType?: string; clineVersion?: string },
	hostVersionError: undefined as Error | undefined,
	subscribeCallback: undefined as ((event: { isEnabled: number }) => void) | undefined,
	unsubscribe: vi.fn(),
}))

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: () => ({
			getGlobalSettingsKey: (key: string) =>
				key === "telemetrySetting" ? telemetryState.clineTelemetrySetting : undefined,
		}),
	},
}))

vi.mock("@/hosts/host-provider", () => ({
	HostProvider: {
		env: {
			getTelemetrySettings: vi.fn(async () => ({ isEnabled: telemetryState.hostSetting })),
			getHostVersion: vi.fn(async () => {
				if (telemetryState.hostVersionError) {
					throw telemetryState.hostVersionError
				}
				return telemetryState.hostVersion
			}),
			subscribeToTelemetrySettings: vi.fn((_request, callbacks: { onResponse: (event: { isEnabled: number }) => void }) => {
				telemetryState.subscribeCallback = callbacks.onResponse
				return telemetryState.unsubscribe
			}),
		},
	},
}))

import { createVscodeSdkTelemetryHandle, VscodeTelemetryPolicyService } from "./sdk-telemetry"

describe("VscodeTelemetryPolicyService", () => {
	beforeEach(() => {
		telemetryState.clineTelemetrySetting = "unset"
		telemetryState.hostSetting = Setting.ENABLED
		telemetryState.hostVersion = {
			platform: "VS Code",
			version: "1.103.0",
			clineType: "VSCode Extension",
		}
		telemetryState.hostVersionError = undefined
		telemetryState.subscribeCallback = undefined
		telemetryState.unsubscribe.mockReset()
		coreTelemetryMocks.createConfig.mockClear()
		coreTelemetryMocks.createHandle.mockReset()
		vi.stubEnv("CLINE_ROLLOUT_VARIANT", "")
	})

	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it("adds rollout metadata as SDK common properties", () => {
		vi.stubEnv("CLINE_ROLLOUT_VARIANT", "next")
		coreTelemetryMocks.createHandle.mockReturnValue(createHandle())

		createVscodeSdkTelemetryHandle()

		expect(coreTelemetryMocks.createHandle).toHaveBeenCalledWith(
			expect.objectContaining({
				commonProperties: {
					extension_variant: "next",
				},
			}),
		)
	})

	it("omits SDK rollout common properties from ordinary builds", () => {
		coreTelemetryMocks.createHandle.mockReturnValue(createHandle())

		createVscodeSdkTelemetryHandle()

		expect(coreTelemetryMocks.createHandle).toHaveBeenCalledWith(
			expect.objectContaining({
				commonProperties: {},
			}),
		)
	})

	it("drops ordinary events until the async host telemetry setting resolves", () => {
		const handle = createHandle()
		const service = new VscodeTelemetryPolicyService(handle)

		service.capture({ event: "session.started" })

		expect(handle.telemetry.capture).not.toHaveBeenCalled()
	})

	it("allows ordinary events when host telemetry is enabled and Cline telemetry is not disabled", async () => {
		const handle = createHandle()
		const service = new VscodeTelemetryPolicyService(handle)
		await settlePromises()

		service.capture({ event: "session.started", properties: { sessionId: "s1" } })

		expect(handle.telemetry.capture).toHaveBeenCalledWith({ event: "session.started", properties: { sessionId: "s1" } })
	})

	it("drops ordinary events when Cline telemetry is disabled but allows required events while host telemetry is enabled", async () => {
		telemetryState.clineTelemetrySetting = "disabled"
		const handle = createHandle()
		const service = new VscodeTelemetryPolicyService(handle)
		await settlePromises()

		service.capture({ event: "task.created" })
		service.captureRequired("user.opt_out", { explicit: true })

		expect(handle.telemetry.capture).not.toHaveBeenCalled()
		expect(handle.telemetry.captureRequired).toHaveBeenCalledWith("user.opt_out", { explicit: true })
	})

	it("drops ordinary and required events when host telemetry is disabled", async () => {
		telemetryState.hostSetting = Setting.DISABLED
		const handle = createHandle()
		const service = new VscodeTelemetryPolicyService(handle)
		await settlePromises()

		service.capture({ event: "task.created" })
		service.captureRequired("user.opt_out")

		expect(handle.telemetry.capture).not.toHaveBeenCalled()
		expect(handle.telemetry.captureRequired).not.toHaveBeenCalled()
	})

	it("uses host telemetry subscription updates for later events", async () => {
		telemetryState.hostSetting = Setting.DISABLED
		const handle = createHandle()
		const service = new VscodeTelemetryPolicyService(handle)
		await settlePromises()

		service.capture({ event: "task.created" })
		telemetryState.subscribeCallback?.({ isEnabled: Setting.ENABLED })
		service.capture({ event: "task.created" })

		expect(handle.telemetry.capture).toHaveBeenCalledTimes(1)
	})

	it("gates metrics with the same ordinary/required policy", async () => {
		telemetryState.clineTelemetrySetting = "disabled"
		const handle = createHandle()
		const service = new VscodeTelemetryPolicyService(handle)
		await settlePromises()

		service.recordCounter("ordinary", 1)
		service.recordCounter("required", 1, undefined, undefined, true)

		expect(handle.telemetry.recordCounter).toHaveBeenCalledTimes(1)
		expect(handle.telemetry.recordCounter).toHaveBeenCalledWith("required", 1, undefined, undefined, true)
	})

	it("applies the full host identity metadata before enabling events", async () => {
		telemetryState.hostVersion = {
			platform: "IntelliJ IDEA Ultimate",
			version: "2026.1.1",
			clineType: "Cline for JetBrains",
			clineVersion: "1.1.61",
		}
		const handle = createHandle()
		const service = new VscodeTelemetryPolicyService(handle)
		await settlePromises()

		service.capture({ event: "task.created" })

		expect(handle.telemetry.updateMetadata).toHaveBeenCalledWith({
			host_plugin_version: "1.1.61",
			cline_type: "Cline for JetBrains",
			platform: "IntelliJ IDEA Ultimate",
			platform_version: "2026.1.1",
		})
		expect(handle.telemetry.capture).toHaveBeenCalledWith({ event: "task.created" })
		const updateOrder = handle.telemetry.updateMetadata.mock.invocationCallOrder[0]
		const captureOrder = handle.telemetry.capture.mock.invocationCallOrder[0]
		expect(updateOrder).toBeLessThan(captureOrder)
	})

	it("omits the metadata fields the host does not report", async () => {
		// The default host version has no clineVersion, so host_plugin_version must be absent.
		const handle = createHandle()
		const service = new VscodeTelemetryPolicyService(handle)
		await settlePromises()

		service.capture({ event: "task.created" })

		expect(handle.telemetry.updateMetadata).toHaveBeenCalledWith({
			cline_type: "VSCode Extension",
			platform: "VS Code",
			platform_version: "1.103.0",
		})
		expect(handle.telemetry.capture).toHaveBeenCalledWith({ event: "task.created" })
	})

	it("skips the metadata update entirely when the host reports no identity fields", async () => {
		telemetryState.hostVersion = {}
		const handle = createHandle()
		const service = new VscodeTelemetryPolicyService(handle)
		await settlePromises()

		service.capture({ event: "task.created" })

		expect(handle.telemetry.updateMetadata).not.toHaveBeenCalled()
		expect(handle.telemetry.capture).toHaveBeenCalledWith({ event: "task.created" })
	})

	it("still enables telemetry when the host version lookup fails", async () => {
		telemetryState.hostVersionError = new Error("host bridge unavailable")
		const handle = createHandle()
		const service = new VscodeTelemetryPolicyService(handle)
		await settlePromises()

		service.capture({ event: "task.created" })

		expect(handle.telemetry.updateMetadata).not.toHaveBeenCalled()
		expect(handle.telemetry.capture).toHaveBeenCalledWith({ event: "task.created" })
	})

	it("always forwards metadata mutators and cleans up on dispose", async () => {
		const handle = createHandle()
		const service = new VscodeTelemetryPolicyService(handle)

		service.updateCommonProperties({ member_id: "member-1" })
		await service.dispose()

		expect(handle.telemetry.updateCommonProperties).toHaveBeenCalledWith({ member_id: "member-1" })
		expect(telemetryState.unsubscribe).toHaveBeenCalled()
		expect(handle.dispose).toHaveBeenCalled()
	})
})

function createHandle(): ConfiguredTelemetryHandle & { telemetry: MockTelemetry } {
	const telemetry: MockTelemetry = {
		setDistinctId: vi.fn<(distinctId?: string) => void>(),
		setMetadata: vi.fn<ITelemetryService["setMetadata"]>(),
		updateMetadata: vi.fn<ITelemetryService["updateMetadata"]>(),
		setCommonProperties: vi.fn<ITelemetryService["setCommonProperties"]>(),
		updateCommonProperties: vi.fn<ITelemetryService["updateCommonProperties"]>(),
		isEnabled: vi.fn(() => true),
		capture: vi.fn<ITelemetryService["capture"]>(),
		captureRequired: vi.fn<ITelemetryService["captureRequired"]>(),
		recordCounter: vi.fn<ITelemetryService["recordCounter"]>(),
		recordHistogram: vi.fn<ITelemetryService["recordHistogram"]>(),
		recordGauge: vi.fn<ITelemetryService["recordGauge"]>(),
		flush: vi.fn(async () => {}),
		dispose: vi.fn(async () => {}),
	}
	return {
		telemetry,
		flush: vi.fn(async () => {}),
		dispose: vi.fn(async () => {}),
	}
}

type MockTelemetry = ITelemetryService & {
	capture: ITelemetryService["capture"] & Mock<ITelemetryService["capture"]>
	captureRequired: ITelemetryService["captureRequired"] & Mock<ITelemetryService["captureRequired"]>
	recordCounter: ITelemetryService["recordCounter"] & Mock<ITelemetryService["recordCounter"]>
	updateMetadata: ITelemetryService["updateMetadata"] & Mock<ITelemetryService["updateMetadata"]>
	updateCommonProperties: ITelemetryService["updateCommonProperties"] & Mock<ITelemetryService["updateCommonProperties"]>
}

async function settlePromises(): Promise<void> {
	for (let i = 0; i < 6; i++) {
		await Promise.resolve()
	}
}
