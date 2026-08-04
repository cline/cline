import type { ConfiguredTelemetryHandle, ITelemetryService } from "@cline/core"
import type { Mock } from "vitest"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { resetTelemetryPolicyForTests } from "@/services/telemetry/telemetry-policy"
import { Setting } from "@/shared/proto/index.host"

const otelClientMocks = vi.hoisted(() => ({
	clients: [] as unknown[],
	flush: vi.fn(async () => {}),
}))

vi.mock("@/services/telemetry/otel-clients", () => ({
	getSharedOtelClients: () => otelClientMocks.clients,
	flushSharedOtelClients: otelClientMocks.flush,
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
	hostVersionGate: undefined as Promise<void> | undefined,
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
				if (telemetryState.hostVersionGate) {
					await telemetryState.hostVersionGate
				}
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

interface EmittedRecord {
	body: string
	attributes: Record<string, unknown>
}

function createFakeSharedClient(overrides: { id?: string; bypassUserSettings?: boolean } = {}) {
	const emitted: EmittedRecord[] = []
	const client = {
		meterProvider: null,
		loggerProvider: {
			getLogger: () => ({
				emit: (record: EmittedRecord) => {
					emitted.push(record)
				},
			}),
			forceFlush: vi.fn(async () => {}),
			shutdown: vi.fn(async () => {}),
		},
	}
	return {
		emitted,
		shared: {
			id: overrides.id ?? "build-time",
			client,
			config: { enabled: true, logsExporter: "otlp", otlpProtocol: "http/json", otlpEndpoint: "https://collector.example" },
			bypassUserSettings: overrides.bypassUserSettings ?? false,
		},
	}
}

describe("createVscodeSdkTelemetryHandle (shared-stack construction)", () => {
	beforeEach(() => {
		resetTelemetryPolicyForTests()
		telemetryState.clineTelemetrySetting = "unset"
		telemetryState.hostSetting = Setting.ENABLED
		telemetryState.hostVersion = {
			platform: "VS Code",
			version: "1.103.0",
			clineType: "VSCode Extension",
		}
		telemetryState.hostVersionError = undefined
		telemetryState.hostVersionGate = undefined
		telemetryState.subscribeCallback = undefined
		telemetryState.unsubscribe.mockReset()
		otelClientMocks.clients = []
		otelClientMocks.flush.mockClear()
		vi.stubEnv("CLINE_ROLLOUT_VARIANT", "")
	})

	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it("exports events through the shared clients with resolved host identity metadata", async () => {
		const { emitted, shared } = createFakeSharedClient()
		otelClientMocks.clients = [shared]

		const handle = createVscodeSdkTelemetryHandle()
		await settlePromises()

		handle.telemetry.capture({ event: "session.started", properties: { sessionId: "s1" } })

		const event = emitted.find((record) => record.body === "session.started")
		expect(event).toBeDefined()
		expect(event?.attributes).toMatchObject({
			sessionId: "s1",
			cline_type: "VSCode Extension",
			platform: "VS Code",
			platform_version: "1.103.0",
		})
	})

	it("keeps the unknown host identity fallbacks when the host version lookup fails", async () => {
		// "unknown" must survive a failed lookup instead of a VSCode mislabel.
		telemetryState.hostVersionError = new Error("host bridge unavailable")
		const { emitted, shared } = createFakeSharedClient()
		otelClientMocks.clients = [shared]

		const handle = createVscodeSdkTelemetryHandle()
		await settlePromises()

		handle.telemetry.capture({ event: "session.started" })

		const event = emitted.find((record) => record.body === "session.started")
		expect(event?.attributes).toMatchObject({
			cline_type: "unknown",
			platform: "unknown",
			platform_version: "unknown",
		})
	})

	it("emits provider_created once, after the host identity metadata is applied", async () => {
		const { emitted, shared } = createFakeSharedClient()
		otelClientMocks.clients = [shared]

		createVscodeSdkTelemetryHandle()
		await settlePromises()

		const providerCreated = emitted.filter((record) => record.body === "telemetry.provider_created")
		expect(providerCreated).toHaveLength(1)
		expect(providerCreated[0].attributes).toMatchObject({
			provider: "opentelemetry",
			enabled: true,
			cline_type: "VSCode Extension",
			_required: true,
		})
	})

	it("omits provider_created when no shared clients are configured", async () => {
		otelClientMocks.clients = []

		const handle = createVscodeSdkTelemetryHandle()
		await settlePromises()

		// Zero destinations: the handle reports disabled and nothing throws.
		expect(handle.telemetry.isEnabled()).toBe(false)
	})

	it("adds rollout metadata as SDK common properties", async () => {
		vi.stubEnv("CLINE_ROLLOUT_VARIANT", "next")
		const { emitted, shared } = createFakeSharedClient()
		otelClientMocks.clients = [shared]

		const handle = createVscodeSdkTelemetryHandle()
		await settlePromises()
		handle.telemetry.capture({ event: "session.started" })

		const event = emitted.find((record) => record.body === "session.started")
		expect(event?.attributes).toMatchObject({ extension_variant: "next" })
	})

	it("gates each destination by its own bypass flag when the user opts out", async () => {
		telemetryState.clineTelemetrySetting = "disabled"
		const prod = createFakeSharedClient({ id: "build-time", bypassUserSettings: false })
		const runtime = createFakeSharedClient({ id: "runtime-env", bypassUserSettings: true })
		otelClientMocks.clients = [prod.shared, runtime.shared]

		const handle = createVscodeSdkTelemetryHandle()
		await settlePromises()

		handle.telemetry.capture({ event: "task.created" })

		expect(prod.emitted.filter((record) => record.body === "task.created")).toHaveLength(0)
		expect(runtime.emitted.filter((record) => record.body === "task.created")).toHaveLength(1)
	})

	it("flushes the shared clients instead of shutting them down on dispose", async () => {
		const { shared } = createFakeSharedClient()
		otelClientMocks.clients = [shared]

		const handle = createVscodeSdkTelemetryHandle()
		await settlePromises()
		await handle.dispose()

		expect(otelClientMocks.flush).toHaveBeenCalled()
		expect(shared.client.loggerProvider.shutdown).not.toHaveBeenCalled()
	})
})

describe("VscodeTelemetryPolicyService", () => {
	beforeEach(() => {
		resetTelemetryPolicyForTests()
		telemetryState.clineTelemetrySetting = "unset"
		telemetryState.hostSetting = Setting.ENABLED
		telemetryState.hostVersion = {
			platform: "VS Code",
			version: "1.103.0",
			clineType: "VSCode Extension",
		}
		telemetryState.hostVersionError = undefined
		telemetryState.hostVersionGate = undefined
		telemetryState.subscribeCallback = undefined
		telemetryState.unsubscribe.mockReset()
		otelClientMocks.clients = []
		otelClientMocks.flush.mockClear()
		vi.stubEnv("CLINE_ROLLOUT_VARIANT", "")
	})

	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it("drops every event until the host identity metadata resolves", () => {
		const handle = createHandle()
		const service = new VscodeTelemetryPolicyService(handle)

		service.capture({ event: "session.started" })
		service.captureRequired("user.opt_out")
		service.recordCounter("cline.turns.total", 1)

		expect(handle.telemetry.capture).not.toHaveBeenCalled()
		expect(handle.telemetry.captureRequired).not.toHaveBeenCalled()
		expect(handle.telemetry.recordCounter).not.toHaveBeenCalled()
	})

	it("forwards ordinary events once metadata is ready; destinations gate on the shared policy", async () => {
		// Even with the user opted out, ordinary events reach the handle so a
		// bypass-enabled destination (runtime env collector) can still export
		// them — exactly like the classic pipeline's providers.
		telemetryState.clineTelemetrySetting = "disabled"
		const handle = createHandle()
		const service = new VscodeTelemetryPolicyService(handle)
		await settlePromises()

		service.capture({ event: "session.started", properties: { sessionId: "s1" } })

		expect(handle.telemetry.capture).toHaveBeenCalledWith({ event: "session.started", properties: { sessionId: "s1" } })
	})

	it("reports isEnabled false when the user opted out even though events are forwarded", async () => {
		telemetryState.clineTelemetrySetting = "disabled"
		const handle = createHandle()
		const service = new VscodeTelemetryPolicyService(handle)
		await settlePromises()

		expect(service.isEnabled()).toBe(false)
	})

	it("allows required events while host telemetry is enabled and the user opted out", async () => {
		telemetryState.clineTelemetrySetting = "disabled"
		const handle = createHandle()
		const service = new VscodeTelemetryPolicyService(handle)
		await settlePromises()

		service.captureRequired("user.opt_out", { explicit: true })

		expect(handle.telemetry.captureRequired).toHaveBeenCalledWith("user.opt_out", { explicit: true })
	})

	it("drops required events when host telemetry is disabled", async () => {
		telemetryState.hostSetting = Setting.DISABLED
		const handle = createHandle()
		const service = new VscodeTelemetryPolicyService(handle)
		await settlePromises()

		service.captureRequired("user.opt_out")

		expect(handle.telemetry.captureRequired).not.toHaveBeenCalled()
	})

	it("uses host telemetry subscription updates for later required events", async () => {
		telemetryState.hostSetting = Setting.DISABLED
		const handle = createHandle()
		const service = new VscodeTelemetryPolicyService(handle)
		await settlePromises()

		service.captureRequired("user.opt_out")
		telemetryState.subscribeCallback?.({ isEnabled: Setting.ENABLED })
		await settlePromises()
		service.captureRequired("user.opt_out")

		expect(handle.telemetry.captureRequired).toHaveBeenCalledTimes(1)
	})

	it("gates metrics with the required policy and forwards ordinary metrics once ready", async () => {
		telemetryState.hostSetting = Setting.DISABLED
		const handle = createHandle()
		const service = new VscodeTelemetryPolicyService(handle)
		await settlePromises()

		// Ordinary metrics are forwarded (destination adapters gate them);
		// required metrics still need the host setting.
		service.recordCounter("ordinary", 1)
		service.recordCounter("required", 1, undefined, undefined, true)

		expect(handle.telemetry.recordCounter).toHaveBeenCalledTimes(1)
		expect(handle.telemetry.recordCounter).toHaveBeenCalledWith("ordinary", 1, undefined, undefined, false)
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
		const providerCreatedOrder = handle.emitProviderCreated.mock.invocationCallOrder[0]
		const captureOrder = handle.telemetry.capture.mock.invocationCallOrder[0]
		expect(updateOrder).toBeLessThan(providerCreatedOrder)
		expect(providerCreatedOrder).toBeLessThan(captureOrder)
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

	it("still enables telemetry and emits provider_created when the host version lookup fails", async () => {
		telemetryState.hostVersionError = new Error("host bridge unavailable")
		const handle = createHandle()
		const service = new VscodeTelemetryPolicyService(handle)
		await settlePromises()

		service.capture({ event: "task.created" })

		expect(handle.telemetry.updateMetadata).not.toHaveBeenCalled()
		expect(handle.emitProviderCreated).toHaveBeenCalledTimes(1)
		expect(handle.telemetry.capture).toHaveBeenCalledWith({ event: "task.created" })
	})

	it("holds events until the host identity is applied even when the host setting is already enabled", async () => {
		let releaseHostVersion!: () => void
		telemetryState.hostVersionGate = new Promise((resolve) => {
			releaseHostVersion = resolve
		})
		const handle = createHandle()
		const service = new VscodeTelemetryPolicyService(handle)
		await settlePromises()

		service.capture({ event: "task.created" })
		expect(handle.telemetry.capture).not.toHaveBeenCalled()
		expect(handle.emitProviderCreated).not.toHaveBeenCalled()

		releaseHostVersion()
		await settlePromises()
		service.capture({ event: "task.created" })
		expect(handle.telemetry.updateMetadata).toHaveBeenCalledTimes(1)
		expect(handle.emitProviderCreated).toHaveBeenCalledTimes(1)
		expect(handle.telemetry.capture).toHaveBeenCalledTimes(1)
	})

	it("emits provider_created on dispose when the host version lookup is still pending", async () => {
		let releaseHostVersion!: () => void
		telemetryState.hostVersionGate = new Promise((resolve) => {
			releaseHostVersion = resolve
		})
		const handle = createHandle()
		const service = new VscodeTelemetryPolicyService(handle)
		await settlePromises()

		await service.dispose()
		expect(handle.emitProviderCreated).toHaveBeenCalledTimes(1)
		const providerCreatedOrder = handle.emitProviderCreated.mock.invocationCallOrder[0]
		const disposeOrder = handle.dispose.mock.invocationCallOrder[0]
		expect(providerCreatedOrder).toBeLessThan(disposeOrder)

		// The late continuation must not emit a second event.
		releaseHostVersion()
		await settlePromises()
		expect(handle.emitProviderCreated).toHaveBeenCalledTimes(1)
	})

	it("always forwards metadata mutators and disposes the handle", async () => {
		const handle = createHandle()
		const service = new VscodeTelemetryPolicyService(handle)

		service.updateCommonProperties({ member_id: "member-1" })
		await service.dispose()

		expect(handle.telemetry.updateCommonProperties).toHaveBeenCalledWith({ member_id: "member-1" })
		expect(handle.dispose).toHaveBeenCalled()
	})
})

function createHandle(): ConfiguredTelemetryHandle & {
	telemetry: MockTelemetry
	emitProviderCreated: Mock<() => void>
	dispose: Mock<() => Promise<void>>
} {
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
		emitProviderCreated: vi.fn<() => void>(),
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
