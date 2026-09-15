import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import * as sinon from "sinon"

const client = { meterProvider: null, loggerProvider: null, tracerProvider: {} as object | null, dispose: mock(async () => {}) }
const constructClient = mock(() => client)
mock.module("@/services/telemetry/providers/opentelemetry/OpenTelemetryClientProvider", () => ({
	OpenTelemetryClientProvider: class {
		constructor() {
			return constructClient()
		}
	},
}))
const removeProvider = mock(async (_name: string) => {})
const addProvider = mock((_provider: unknown) => {})
mock.module("@/services/telemetry", () => ({ telemetryService: { removeProvider, addProvider } }))
const state = {
	getRemoteConfigSettings: () => ({}),
	getGlobalStateKey: () => ({}),
	getApiConfiguration: () => ({}),
	setGlobalState: mock(() => {}),
	setSecret: mock(() => {}),
	setRemoteConfigField: mock(() => {}),
	replaceRemoteConfig: mock(() => {}),
	clearRemoteConfig: mock(() => {}),
}
mock.module("@/core/storage/StateManager", () => ({ StateManager: { get: () => state } }))
mock.module("@/services/auth/AuthService", () => ({
	AuthService: { getInstance: () => ({ getActiveOrganizationId: () => undefined }) },
}))
mock.module("@/core/storage/remote-config/syncRemoteMcpServers", () => ({ syncRemoteMcpServersToSettings: async () => {} }))

import { OpenTelemetryTelemetryProvider } from "@/services/telemetry/providers/opentelemetry/OpenTelemetryTelemetryProvider"
import { NoOpTelemetryProvider, TelemetryProviderFactory } from "@/services/telemetry/TelemetryProviderFactory"
import { RemoteConfigSchema } from "@/shared/remote-config/schema"
import { remoteConfigToOtelConfig } from "@/shared/services/config/otel-config"
import {
	applyRemoteConfig,
	clearRemoteConfig,
	REMOTE_CONFIG_OTEL_PROVIDER_ID,
	transformRemoteConfigToStateShape,
} from "../remote-config/utils"

const config = {
	version: "v1",
	openTelemetryEnabled: true,
	openTelemetryMetricsExporter: "none",
	openTelemetryLogsExporter: "none",
	openTelemetryTracesExporter: "otlp",
	openTelemetryOtlpEndpoint: "http://localhost:4318",
}
const mcpHub = { getMcpSettingsFilePath: async () => "/tmp/unused-mcp.json" }

beforeEach(() => {
	client.tracerProvider = {}
	client.dispose.mockClear()
	constructClient.mockClear()
	removeProvider.mockReset()
	removeProvider.mockImplementation(async () => {})
	addProvider.mockClear()
})
afterEach(() => sinon.restore())

describe("remote config telemetry ownership", () => {
	it("preserves the trace exporter through schema validation and state mapping", () => {
		const transformed = transformRemoteConfigToStateShape(RemoteConfigSchema.parse(config))
		expect(transformed.openTelemetryTracesExporter).toBe("otlp")
		expect(transformRemoteConfigToStateShape({ version: "v1" }).openTelemetryTracesExporter).toBeUndefined()
	})

	it("awaits removal before retaining a trace-only replacement and its owner", async () => {
		let release!: () => void
		removeProvider.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					release = resolve
				}),
		)
		const applying = applyRemoteConfig(config, {}, mcpHub as never)
		expect(removeProvider).toHaveBeenCalledWith(REMOTE_CONFIG_OTEL_PROVIDER_ID)
		expect(constructClient).not.toHaveBeenCalled()
		release()
		await applying
		expect(addProvider).toHaveBeenCalledTimes(1)
		expect(client.dispose).not.toHaveBeenCalled()
		await (addProvider.mock.calls[0][0] as OpenTelemetryTelemetryProvider).dispose()
		expect(client.dispose).toHaveBeenCalledTimes(1)
	})

	it("awaits provider removal when clearing remote config", async () => {
		let release!: () => void
		removeProvider.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					release = resolve
				}),
		)
		let finished = false
		const clearing = clearRemoteConfig().then(() => {
			finished = true
		})
		await Promise.resolve()
		expect(finished).toBe(false)
		release()
		await clearing
		expect(finished).toBe(true)
	})

	it("disposes a client when wrapper initialization fails", async () => {
		sinon.stub(OpenTelemetryTelemetryProvider.prototype, "initialize").rejects(new Error("init failed"))
		await applyRemoteConfig(config, {}, mcpHub as never)
		expect(client.dispose).toHaveBeenCalledTimes(1)
		expect(addProvider).not.toHaveBeenCalled()
	})

	it("disposes a client with no available signals", async () => {
		client.tracerProvider = null
		await applyRemoteConfig(config, {}, mcpHub as never)
		expect(client.dispose).toHaveBeenCalledTimes(1)
		expect(addProvider).not.toHaveBeenCalled()
	})
})

describe("TelemetryProviderFactory ownership", () => {
	beforeEach(() => {
		sinon.stub(TelemetryProviderFactory, "getDefaultConfigs").returns([
			{
				type: "opentelemetry",
				config: remoteConfigToOtelConfig(config) as never,
				bypassUserSettings: true,
			},
		])
	})

	it("retains trace-only clients until the wrapper is disposed", async () => {
		const [provider] = await TelemetryProviderFactory.createProviders()
		expect(provider).toBeInstanceOf(OpenTelemetryTelemetryProvider)
		expect(client.dispose).not.toHaveBeenCalled()
		await provider.dispose()
		expect(client.dispose).toHaveBeenCalledTimes(1)
	})

	it("disposes clients when initialization fails", async () => {
		sinon.stub(OpenTelemetryTelemetryProvider.prototype, "initialize").rejects(new Error("init failed"))
		const [provider] = await TelemetryProviderFactory.createProviders()
		expect(provider).toBeInstanceOf(NoOpTelemetryProvider)
		expect(client.dispose).toHaveBeenCalledTimes(1)
	})

	it("disposes clients with no available signals", async () => {
		client.tracerProvider = null
		const [provider] = await TelemetryProviderFactory.createProviders()
		expect(provider).toBeInstanceOf(NoOpTelemetryProvider)
		expect(client.dispose).toHaveBeenCalledTimes(1)
	})
})
