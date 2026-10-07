/**
 * Regression test for ENG-2397: the VS Code bundle runs two telemetry pipelines
 * (the classic host TelemetryService providers and the SDK handle), which used
 * to apply their settings checks and transport config independently.
 *
 * The invariant under test: for EVERY destination (shared OTel client) and
 * EVERY policy state (host setting x host level x user setting), the classic
 * pipeline and the SDK pipeline agree on whether an event or metric exports.
 * Configuration must affect all telemetry in the process uniformly — never one
 * pipeline.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { Setting } from "@/shared/proto/index.host"

const telemetryState = vi.hoisted(() => ({
	clineTelemetrySetting: "unset" as string | undefined,
	hostSetting: 1,
	errorLevel: "all" as string,
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
			getTelemetrySettings: vi.fn(async () => ({
				isEnabled: telemetryState.hostSetting,
				errorLevel: telemetryState.errorLevel,
			})),
			getHostVersion: vi.fn(async () => ({
				platform: "VS Code",
				version: "1.103.0",
				clineType: "VSCode Extension",
			})),
			subscribeToTelemetrySettings: vi.fn(() => () => {}),
		},
	},
}))

const otelClientMocks = vi.hoisted(() => ({
	clients: [] as unknown[],
}))

vi.mock("@/services/telemetry/otel-clients", () => ({
	getSharedOtelClients: () => otelClientMocks.clients,
	flushSharedOtelClients: vi.fn(async () => {}),
}))

import { createVscodeSdkTelemetryHandle } from "@/sdk/sdk-telemetry"
import { OpenTelemetryTelemetryProvider } from "../providers/opentelemetry/OpenTelemetryTelemetryProvider"
import { RUNTIME_ENV_OTEL_BYPASSES_USER_OPT_OUT, resetTelemetryPolicyForTests } from "../telemetry-policy"

interface EmittedRecord {
	body: string
	attributes: Record<string, unknown>
}

interface FakeDestination {
	id: string
	bypassUserSettings: boolean
	emitted: EmittedRecord[]
	counters: Array<{ name: string; value: number }>
	shared: {
		id: string
		client: {
			meterProvider: { getMeter(name: string): unknown }
			loggerProvider: { getLogger(name: string): { emit(record: EmittedRecord): void } }
		}
		config: Record<string, unknown>
		bypassUserSettings: boolean
	}
}

function createDestination(id: string, bypassUserSettings: boolean): FakeDestination {
	const emitted: EmittedRecord[] = []
	const counters: Array<{ name: string; value: number }> = []
	return {
		id,
		bypassUserSettings,
		emitted,
		counters,
		shared: {
			id,
			client: {
				meterProvider: {
					getMeter: () => ({
						createCounter: (name: string) => ({
							add: (value: number) => {
								counters.push({ name, value })
							},
						}),
					}),
				},
				loggerProvider: {
					getLogger: () => ({
						emit: (record: EmittedRecord) => {
							emitted.push(record)
						},
					}),
				},
			},
			config: { enabled: true, logsExporter: "otlp", otlpEndpoint: "https://collector.example" },
			bypassUserSettings,
		},
	}
}

function countEvents(destination: FakeDestination, event: string): number {
	return destination.emitted.filter((record) => record.body === event).length
}

function countMetric(destination: FakeDestination, name: string): number {
	return destination.counters.filter((entry) => entry.name === name).length
}

async function settlePromises(): Promise<void> {
	for (let i = 0; i < 6; i++) {
		await Promise.resolve()
	}
}

// The same two destinations the production factory builds: the build-time
// (prod) collector and a runtime CLINE_OTEL_* collector.
function createDestinations(): FakeDestination[] {
	const destinations = [
		createDestination("build-time", false),
		createDestination("runtime-env", RUNTIME_ENV_OTEL_BYPASSES_USER_OPT_OUT),
	]
	otelClientMocks.clients = destinations.map((destination) => destination.shared)
	return destinations
}

// Classic pipeline: one provider per shared client, exactly as
// TelemetryProviderFactory.createProvider wires them.
async function createClassicProviders(destinations: FakeDestination[]): Promise<OpenTelemetryTelemetryProvider[]> {
	return Promise.all(
		destinations.map((destination) =>
			new OpenTelemetryTelemetryProvider(
				destination.shared.client.meterProvider as never,
				destination.shared.client.loggerProvider as never,
				{
					name: `classic-${destination.id}`,
					bypassUserSettings: destination.bypassUserSettings,
				},
			).initialize(),
		),
	)
}

describe("telemetry pipeline parity (ENG-2397 double-export regression)", () => {
	beforeEach(() => {
		resetTelemetryPolicyForTests()
		telemetryState.clineTelemetrySetting = "unset"
		telemetryState.hostSetting = Setting.ENABLED
		telemetryState.errorLevel = "all"
		otelClientMocks.clients = []
	})

	const policyStates = [
		{ name: "host enabled, user opted in", host: Setting.ENABLED, user: "unset" },
		{ name: "host enabled, user opted out", host: Setting.ENABLED, user: "disabled" },
		{ name: "host disabled, user opted in", host: Setting.DISABLED, user: "unset" },
		{ name: "host disabled, user opted out", host: Setting.DISABLED, user: "disabled" },
	] as const

	for (const policy of policyStates) {
		it(`exports ordinary events and metrics to the same destinations from both pipelines (${policy.name})`, async () => {
			telemetryState.hostSetting = policy.host
			telemetryState.clineTelemetrySetting = policy.user
			const destinations = createDestinations()
			const classicProviders = await createClassicProviders(destinations)

			// SDK pipeline: the handle binds one adapter per shared client.
			const sdkHandle = createVscodeSdkTelemetryHandle()
			await settlePromises()

			for (const provider of classicProviders) {
				provider.log("classic.event", { source: "classic" })
				provider.recordCounter("classic.metric", 1)
			}
			sdkHandle.telemetry.capture({ event: "sdk.event", properties: { source: "sdk" } })
			sdkHandle.telemetry.recordCounter("sdk.metric", 1)

			// The bypass destination is the only one allowed to export when the
			// policy denies ordinary telemetry — and then it must receive BOTH
			// pipelines' telemetry (the pre-unification bug exported only classic).
			const ordinaryAllowed = policy.host === Setting.ENABLED && policy.user !== "disabled"
			for (const destination of destinations) {
				const expected = ordinaryAllowed || destination.bypassUserSettings ? 1 : 0
				expect(
					{
						destination: destination.id,
						classicEvent: countEvents(destination, "classic.event"),
						sdkEvent: countEvents(destination, "sdk.event"),
						classicMetric: countMetric(destination, "classic.metric"),
						sdkMetric: countMetric(destination, "sdk.metric"),
					},
					`pipelines must agree on destination "${destination.id}" under "${policy.name}"`,
				).toEqual({
					destination: destination.id,
					classicEvent: expected,
					sdkEvent: expected,
					classicMetric: expected,
					sdkMetric: expected,
				})
			}
		})
	}

	for (const level of ["error", "crash"] as const) {
		it(`applies the host telemetry level "${level}" identically in both pipelines`, async () => {
			telemetryState.errorLevel = level
			const destinations = createDestinations()
			const classicProviders = await createClassicProviders(destinations)
			const sdkHandle = createVscodeSdkTelemetryHandle()
			await settlePromises()

			for (const provider of classicProviders) {
				provider.log("classic.usage")
				provider.log("classic.provider_api_error")
				provider.recordCounter("classic.metric", 1)
			}
			sdkHandle.telemetry.capture({ event: "sdk.usage" })
			sdkHandle.telemetry.capture({ event: "sdk.provider_api_error" })
			sdkHandle.telemetry.recordCounter("sdk.metric", 1)

			for (const destination of destinations) {
				// Error-only reporting keeps usage events from the production
				// collector; a bypass destination ignores the level. Error events and
				// metrics are unaffected either way.
				const usageExpected = destination.bypassUserSettings ? 1 : 0
				expect(
					{
						destination: destination.id,
						classicUsage: countEvents(destination, "classic.usage"),
						sdkUsage: countEvents(destination, "sdk.usage"),
						classicError: countEvents(destination, "classic.provider_api_error"),
						sdkError: countEvents(destination, "sdk.provider_api_error"),
						classicMetric: countMetric(destination, "classic.metric"),
						sdkMetric: countMetric(destination, "sdk.metric"),
					},
					`pipelines must agree on destination "${destination.id}" at level "${level}"`,
				).toEqual({
					destination: destination.id,
					classicUsage: usageExpected,
					sdkUsage: usageExpected,
					classicError: 1,
					sdkError: 1,
					classicMetric: 1,
					sdkMetric: 1,
				})
			}
		})
	}

	it("required events reach every destination from both pipelines while host telemetry is enabled", async () => {
		telemetryState.clineTelemetrySetting = "disabled"
		const destinations = createDestinations()
		const classicProviders = await createClassicProviders(destinations)
		const sdkHandle = createVscodeSdkTelemetryHandle()
		await settlePromises()

		for (const provider of classicProviders) {
			provider.logRequired("classic.required")
		}
		sdkHandle.telemetry.captureRequired("sdk.required")

		for (const destination of destinations) {
			expect(countEvents(destination, "classic.required")).toBe(1)
			expect(countEvents(destination, "sdk.required")).toBe(1)
		}
	})
})
