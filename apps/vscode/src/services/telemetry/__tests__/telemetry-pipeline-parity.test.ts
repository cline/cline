/**
 * Regression test for ENG-2397: the VS Code bundle runs two telemetry pipelines
 * (the classic host TelemetryService providers and the SDK handle), which used
 * to apply their settings checks and transport config independently.
 *
 * The invariant under test: for EVERY destination (shared OTel client) and
 * EVERY policy state (host setting x user setting), the classic pipeline and
 * the SDK pipeline agree on whether an ordinary event exports. Configuration
 * must affect all telemetry in the process uniformly — never one pipeline.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { Setting } from "@/shared/proto/index.host"

const telemetryState = vi.hoisted(() => ({
	clineTelemetrySetting: "unset" as string | undefined,
	hostSetting: 1,
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
	shared: {
		id: string
		client: { meterProvider: null; loggerProvider: { getLogger(name: string): { emit(record: EmittedRecord): void } } }
		config: Record<string, unknown>
		bypassUserSettings: boolean
	}
}

function createDestination(id: string, bypassUserSettings: boolean): FakeDestination {
	const emitted: EmittedRecord[] = []
	return {
		id,
		bypassUserSettings,
		emitted,
		shared: {
			id,
			client: {
				meterProvider: null,
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

async function settlePromises(): Promise<void> {
	for (let i = 0; i < 6; i++) {
		await Promise.resolve()
	}
}

describe("telemetry pipeline parity (ENG-2397 double-export regression)", () => {
	beforeEach(() => {
		resetTelemetryPolicyForTests()
		telemetryState.clineTelemetrySetting = "unset"
		telemetryState.hostSetting = Setting.ENABLED
		otelClientMocks.clients = []
	})

	const policyStates = [
		{ name: "host enabled, user opted in", host: Setting.ENABLED, user: "unset" },
		{ name: "host enabled, user opted out", host: Setting.ENABLED, user: "disabled" },
		{ name: "host disabled, user opted in", host: Setting.DISABLED, user: "unset" },
		{ name: "host disabled, user opted out", host: Setting.DISABLED, user: "disabled" },
	] as const

	for (const policy of policyStates) {
		it(`exports ordinary events to the same destinations from both pipelines (${policy.name})`, async () => {
			telemetryState.hostSetting = policy.host
			telemetryState.clineTelemetrySetting = policy.user

			// The same two destinations the production factory builds: the
			// build-time (prod) collector and a runtime CLINE_OTEL_* collector.
			const destinations = [
				createDestination("build-time", false),
				createDestination("runtime-env", RUNTIME_ENV_OTEL_BYPASSES_USER_OPT_OUT),
			]
			otelClientMocks.clients = destinations.map((destination) => destination.shared)

			// Classic pipeline: one provider per shared client, exactly as
			// TelemetryProviderFactory.createProvider wires them.
			const classicProviders = await Promise.all(
				destinations.map((destination) =>
					new OpenTelemetryTelemetryProvider(null, destination.shared.client.loggerProvider as never, {
						name: `classic-${destination.id}`,
						bypassUserSettings: destination.bypassUserSettings,
					}).initialize(),
				),
			)

			// SDK pipeline: the handle binds one adapter per shared client.
			const sdkHandle = createVscodeSdkTelemetryHandle()
			await settlePromises()

			for (const provider of classicProviders) {
				provider.log("classic.event", { source: "classic" })
			}
			sdkHandle.telemetry.capture({ event: "sdk.event", properties: { source: "sdk" } })

			for (const destination of destinations) {
				const classicCount = countEvents(destination, "classic.event")
				const sdkCount = countEvents(destination, "sdk.event")
				expect(
					{ destination: destination.id, classic: classicCount, sdk: sdkCount },
					`pipelines must agree on destination "${destination.id}" under "${policy.name}"`,
				).toEqual({ destination: destination.id, classic: classicCount, sdk: classicCount })
			}

			// The bypass destination is the only one allowed to export when the
			// policy denies ordinary telemetry — and then it must receive BOTH
			// pipelines' events (the pre-unification bug exported only classic).
			const ordinaryAllowed = policy.host === Setting.ENABLED && policy.user !== "disabled"
			for (const destination of destinations) {
				const expected = ordinaryAllowed || destination.bypassUserSettings ? 1 : 0
				expect(countEvents(destination, "classic.event")).toBe(expected)
				expect(countEvents(destination, "sdk.event")).toBe(expected)
			}
		})
	}

	it("required events reach every destination from both pipelines while host telemetry is enabled", async () => {
		telemetryState.clineTelemetrySetting = "disabled"

		const destinations = [
			createDestination("build-time", false),
			createDestination("runtime-env", RUNTIME_ENV_OTEL_BYPASSES_USER_OPT_OUT),
		]
		otelClientMocks.clients = destinations.map((destination) => destination.shared)

		const classicProviders = await Promise.all(
			destinations.map((destination) =>
				new OpenTelemetryTelemetryProvider(null, destination.shared.client.loggerProvider as never, {
					name: `classic-${destination.id}`,
					bypassUserSettings: destination.bypassUserSettings,
				}).initialize(),
			),
		)
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
