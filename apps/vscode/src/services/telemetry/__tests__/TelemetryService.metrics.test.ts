import { describe, it } from "bun:test"
import * as assert from "assert"
import { PROVIDER_FAILURE_ERROR_TYPE, PROVIDER_FAILURE_PHASE } from "../../../sdk/provider-failure-telemetry"
import type { ITelemetryProvider, TelemetryProperties, TelemetrySettings } from "../providers/ITelemetryProvider"
import { ROLLOUT_BUNDLE_ACTIVATED_EVENT, ROLLOUT_ERROR_MESSAGE_LIMIT } from "../rollout-metadata"
import { TelemetryMetadata, TelemetryService } from "../TelemetryService"

class FakeProvider implements ITelemetryProvider {
	readonly name = "FakeProvider"
	public logs: Array<{ event: string; properties?: TelemetryProperties }> = []
	public counters: Array<{ name: string; value: number; attributes: TelemetryProperties; description?: string }> = []
	public histograms: Array<{ name: string; value: number; attributes: TelemetryProperties; description?: string }> = []
	public gauges = new Map<string, Map<string, { value: number; attributes: TelemetryProperties; description?: string }>>()

	log(event: string, properties?: TelemetryProperties): void {
		this.logs.push({ event, properties })
	}
	logRequired(event: string, properties?: TelemetryProperties): void {
		this.logs.push({ event, properties })
	}
	identifyUser(): void {}
	isEnabled(): boolean {
		return true
	}
	getSettings(): TelemetrySettings {
		return { hostEnabled: true, level: "all" }
	}
	recordCounter(name: string, value: number, attributes?: TelemetryProperties, description?: string, _required = false): void {
		this.counters.push({ name, value, attributes: attributes ?? {}, description })
	}
	recordHistogram(
		name: string,
		value: number,
		attributes?: TelemetryProperties,
		description?: string,
		_required = false,
	): void {
		this.histograms.push({ name, value, attributes: attributes ?? {}, description })
	}
	recordGauge(
		name: string,
		value: number | null,
		attributes?: TelemetryProperties,
		description?: string,
		_required = false,
	): void {
		const attrKey = JSON.stringify(attributes ?? {})
		const series = this.gauges.get(name)
		if (value === null) {
			series?.delete(attrKey)
			if (series && series.size === 0) {
				this.gauges.delete(name)
			}
			return
		}

		let nextSeries = series
		if (!nextSeries) {
			nextSeries = new Map()
			this.gauges.set(name, nextSeries)
		}

		nextSeries.set(attrKey, { value, attributes: attributes ?? {}, description })
	}
	async forceFlush() {}
	async dispose(): Promise<void> {}
}

function createTelemetryService(provider: FakeProvider, overrides: Partial<TelemetryMetadata> = {}): TelemetryService {
	return new TelemetryService([provider], {
		extension_version: "test",
		cline_type: "cline-unit-tests",
		platform: "test-platform",
		platform_version: "1.0.0",
		os_type: "darwin",
		os_version: "24",
		is_remote_workspace: false,
		is_dev: "true",
		...overrides,
	} as TelemetryMetadata)
}

describe("TelemetryService metrics", () => {
	it("includes rollout metadata on traditional events and metrics", () => {
		const provider = new FakeProvider()
		const service = createTelemetryService(provider, {
			extension_variant: "next",
		})

		service.captureProviderApiError({
			ulid: "task-rollout",
			model: "model-a",
			errorMessage: "boom",
			provider: "anthropic",
		})

		const errorEvent = provider.logs.find((entry) => entry.event === "task.provider_api_error")
		assert.strictEqual(errorEvent?.properties?.extension_variant, "next")
		assert.ok(provider.counters.length > 0)
		assert.ok(provider.histograms.length > 0)
		for (const entry of [...provider.counters, ...provider.histograms]) {
			assert.strictEqual(entry.attributes.extension_variant, "next")
		}
	})

	it("captures one bounded rollout fallback event for rollout builds", () => {
		const provider = new FakeProvider()
		const service = createTelemetryService(provider, {
			extension_variant: "legacy",
		})

		service.captureRolloutBundleActivated({
			attemptedBundle: "next",
			actualBundle: "legacy",
			fallback: true,
			error: new TypeError("x".repeat(ROLLOUT_ERROR_MESSAGE_LIMIT + 20)),
		})

		const events = provider.logs.filter((entry) => entry.event === ROLLOUT_BUNDLE_ACTIVATED_EVENT)
		assert.strictEqual(events.length, 1)
		assert.strictEqual(events[0].properties?.attempted_bundle, "next")
		assert.strictEqual(events[0].properties?.actual_bundle, "legacy")
		assert.strictEqual(events[0].properties?.fallback, true)
		assert.strictEqual(events[0].properties?.error_type, "TypeError")
		assert.strictEqual((events[0].properties?.error_message as string).length, ROLLOUT_ERROR_MESSAGE_LIMIT)
		assert.strictEqual(events[0].properties?.extension_variant, "legacy")
	})

	it("captures bounded, content-free remote-config rollout signals", () => {
		const provider = new FakeProvider()
		const service = createTelemetryService(provider, { extension_variant: "next" })

		service.captureRemoteConfigRefresh({
			outcome: "applied",
			durationMs: 12.6,
			managed: true,
			configVersion: "v".repeat(120),
		})
		service.captureRemoteConfigSessionGate({ outcome: "last_known_good", durationMs: 4.2, managed: true })

		const refresh = provider.logs.find((entry) => entry.event === "remote_config.refresh")
		assert.strictEqual(refresh?.properties?.outcome, "applied")
		assert.strictEqual(refresh?.properties?.duration_ms, 13)
		assert.strictEqual((refresh?.properties?.config_version as string).length, 100)
		assert.strictEqual(refresh?.properties?.extension_variant, "next")
		assert.strictEqual(refresh?.properties?.organization_id, undefined)
		const gate = provider.logs.find((entry) => entry.event === "remote_config.session_gate")
		assert.strictEqual(gate?.properties?.outcome, "last_known_good")
		assert.strictEqual(gate?.properties?.duration_ms, 4)
		assert.strictEqual(gate?.properties?.extension_variant, "next")
	})

	it("drops unmanaged happy-path remote-config events but keeps failures", () => {
		const provider = new FakeProvider()
		const service = createTelemetryService(provider)
		const remoteConfigEvents = () => provider.logs.filter((entry) => entry.event.startsWith("remote_config."))

		// Unmanaged happy path: the overwhelming majority of installs, no signal.
		service.captureRemoteConfigRefresh({ outcome: "applied", durationMs: 1, managed: false })
		service.captureRemoteConfigRefresh({ outcome: "cleared", durationMs: 1, managed: false })
		service.captureRemoteConfigSessionGate({ outcome: "unmanaged", durationMs: 1, managed: false })
		service.captureRemoteConfigSessionGate({ outcome: "refreshed", durationMs: 1, managed: false })
		assert.strictEqual(remoteConfigEvents().length, 0)

		// Failures and managed-org events are the signal and must still be sent.
		service.captureRemoteConfigRefresh({ outcome: "failed", durationMs: 1, managed: false })
		service.captureRemoteConfigRefresh({ outcome: "cleared", durationMs: 1, managed: true })
		service.captureRemoteConfigSessionGate({ outcome: "blocked", durationMs: 1, managed: true })
		assert.strictEqual(remoteConfigEvents().length, 3)
	})

	it("does not capture rollout activation events for ordinary builds", () => {
		const provider = new FakeProvider()
		const service = createTelemetryService(provider)

		service.captureRolloutBundleActivated({
			attemptedBundle: "legacy",
			actualBundle: "legacy",
			fallback: false,
		})

		assert.strictEqual(
			provider.logs.some((entry) => entry.event === ROLLOUT_BUNDLE_ACTIVATED_EVENT),
			false,
		)
	})

	it("metrics include is_remote_workspace in standard attributes", () => {
		const provider = new FakeProvider()
		const service = createTelemetryService(provider, { is_remote_workspace: true })

		service.captureProviderApiError({
			ulid: "task-remote",
			model: "model-a",
			errorMessage: "boom",
			provider: "anthropic",
		})

		assert.ok(provider.counters.length > 0)
		assert.strictEqual(provider.counters[0].attributes.is_remote_workspace, true)
		assert.strictEqual(provider.histograms[0].attributes.is_remote_workspace, true)
	})

	it("captureLegacyTaskMigrationBacklog records pending and migrated gauges", () => {
		const provider = new FakeProvider()
		const service = createTelemetryService(provider)

		service.captureLegacyTaskMigrationBacklog({
			pendingLegacyTaskCount: 4,
			migratedSdkTaskCount: 7,
			visibleSdkTaskCount: 9,
			visibleTaskCount: 13,
		})

		const pendingSeries = provider.gauges.get(TelemetryService.METRICS.MIGRATION.LEGACY_TASK_PENDING_COUNT)
		assert.ok(pendingSeries)
		const [pendingEntry] = Array.from(pendingSeries.values())
		assert.strictEqual(pendingEntry.value, 4)
		assert.strictEqual(pendingEntry.attributes.migration_type, "legacy_task_to_sdk_session")

		const migratedSeries = provider.gauges.get(TelemetryService.METRICS.MIGRATION.LEGACY_TASK_MIGRATED_COUNT)
		assert.ok(migratedSeries)
		const [migratedEntry] = Array.from(migratedSeries.values())
		assert.strictEqual(migratedEntry.value, 7)

		const backlogEvent = provider.logs.find((entry) => entry.event === "task.legacy_task_migration")
		assert.ok(backlogEvent)
		assert.strictEqual(backlogEvent?.properties?.outcome, "backlog")
		assert.strictEqual(backlogEvent?.properties?.pendingLegacyTaskCount, 4)
	})

	it("captureLegacyTaskMigrationBacklog emits the backlog event only on state transitions", () => {
		const provider = new FakeProvider()
		const service = createTelemetryService(provider)
		const backlogEvents = () => provider.logs.filter((entry) => entry.properties?.outcome === "backlog")

		// No legacy history at all: gauges only, no event.
		service.captureLegacyTaskMigrationBacklog({
			pendingLegacyTaskCount: 0,
			migratedSdkTaskCount: 0,
			visibleSdkTaskCount: 5,
			visibleTaskCount: 5,
		})
		assert.strictEqual(backlogEvents().length, 0)
		assert.ok(provider.gauges.get(TelemetryService.METRICS.MIGRATION.LEGACY_TASK_PENDING_COUNT))

		// Unchanged backlog (including unrelated new-task churn): reported once.
		const snapshot = { pendingLegacyTaskCount: 4, migratedSdkTaskCount: 7, visibleSdkTaskCount: 9, visibleTaskCount: 13 }
		service.captureLegacyTaskMigrationBacklog(snapshot)
		service.captureLegacyTaskMigrationBacklog(snapshot)
		service.captureLegacyTaskMigrationBacklog({ ...snapshot, visibleSdkTaskCount: 10, visibleTaskCount: 14 })
		assert.strictEqual(backlogEvents().length, 1)

		// A migrated legacy task is a transition and is reported.
		service.captureLegacyTaskMigrationBacklog({ ...snapshot, pendingLegacyTaskCount: 3, migratedSdkTaskCount: 8 })
		assert.strictEqual(backlogEvents().length, 2)
		assert.strictEqual(backlogEvents()[1].properties?.pendingLegacyTaskCount, 3)
	})

	it("captureLegacyTaskMigration emits event and migration metrics", () => {
		const provider = new FakeProvider()
		const service = createTelemetryService(provider)

		service.captureLegacyTaskMigration({
			taskId: "legacy-task",
			outcome: "success",
			reason: "migrated",
			durationMs: 250,
			legacyApiHistoryLength: 3,
			convertedMessageCount: 2,
			hasFavorite: true,
			hasCost: true,
			hasTokenUsage: true,
			hasCwd: true,
		})

		const event = provider.logs.find((entry) => entry.event === "task.legacy_task_migration")
		assert.ok(event)
		assert.strictEqual(event?.properties?.ulid, "legacy-task")
		assert.strictEqual(event?.properties?.outcome, "success")
		assert.strictEqual(event?.properties?.legacyApiHistoryLength, 3)

		assert.deepStrictEqual(
			provider.counters.map((entry) => entry.name),
			[
				TelemetryService.METRICS.MIGRATION.LEGACY_TASK_ATTEMPTS_TOTAL,
				TelemetryService.METRICS.MIGRATION.LEGACY_TASK_SUCCESS_TOTAL,
			],
		)
		assert.deepStrictEqual(
			provider.histograms.map((entry) => entry.name),
			[
				TelemetryService.METRICS.MIGRATION.LEGACY_TASK_DURATION_SECONDS,
				TelemetryService.METRICS.MIGRATION.LEGACY_TASK_LEGACY_MESSAGES_COUNT,
				TelemetryService.METRICS.MIGRATION.LEGACY_TASK_CONVERTED_MESSAGES_COUNT,
			],
		)
		assert.strictEqual(provider.histograms[0].value, 0.25)
		assert.strictEqual(provider.histograms[0].attributes.migration_type, "legacy_task_to_sdk_session")
		assert.strictEqual(provider.histograms[0].attributes.reason, "migrated")
	})

	it("captureProviderApiError increments error counter", () => {
		const provider = new FakeProvider()
		const service = createTelemetryService(provider)

		service.captureProviderApiError({
			ulid: "task-3",
			model: "claude",
			errorMessage: "boom",
			provider: "anthropic",
			errorStatus: 500,
			errorType: PROVIDER_FAILURE_ERROR_TYPE.SDK_AGENT_DONE_ERROR,
			failurePhase: PROVIDER_FAILURE_PHASE.STREAMING,
		})

		assert.strictEqual(provider.counters.length, 1)
		const entry = provider.counters[0]
		assert.strictEqual(entry.name, TelemetryService.METRICS.ERRORS.TOTAL)
		assert.strictEqual(entry.value, 1)
		assert.strictEqual(entry.attributes.ulid, "task-3")
		assert.strictEqual(entry.attributes.provider, "anthropic")
		assert.strictEqual(entry.attributes.model, "claude")
		assert.strictEqual(entry.attributes.error_status, 500)
		assert.strictEqual(entry.attributes.error_type, PROVIDER_FAILURE_ERROR_TYPE.SDK_AGENT_DONE_ERROR)
		assert.strictEqual(entry.attributes.failure_phase, PROVIDER_FAILURE_PHASE.STREAMING)
		assert.strictEqual(provider.histograms.length, 1)
		const errorHistogram = provider.histograms[0]
		assert.strictEqual(errorHistogram.name, TelemetryService.METRICS.ERRORS.PER_TASK)
		assert.strictEqual(errorHistogram.value, 1)
		assert.strictEqual(errorHistogram.attributes.ulid, "task-3")
		assert.strictEqual(errorHistogram.attributes.provider, "anthropic")
		assert.strictEqual(errorHistogram.attributes.model, "claude")
		assert.strictEqual(errorHistogram.attributes.error_status, 500)
		assert.strictEqual(errorHistogram.attributes.error_type, PROVIDER_FAILURE_ERROR_TYPE.SDK_AGENT_DONE_ERROR)
		assert.strictEqual(errorHistogram.attributes.failure_phase, PROVIDER_FAILURE_PHASE.STREAMING)
	})

	it("captureGrpcResponseSize records histogram with correct name, value, and attributes", () => {
		const provider = new FakeProvider()
		const service = createTelemetryService(provider)

		service.captureGrpcResponseSize(123456, "cline.StateService", "subscribeToState")

		assert.strictEqual(provider.histograms.length, 1)
		const entry = provider.histograms[0]
		assert.strictEqual(entry.name, TelemetryService.METRICS.GRPC.RESPONSE_SIZE_BYTES)
		assert.strictEqual(entry.value, 123456)
		assert.strictEqual(entry.attributes.service, "cline.StateService")
		assert.strictEqual(entry.attributes.method, "subscribeToState")
		assert.strictEqual(entry.description, "Size of gRPC response messages in bytes")
		// Should not have request_id when not provided
		assert.strictEqual(entry.attributes.request_id, undefined)
	})

	it("captureGrpcResponseSize includes request_id when provided", () => {
		const provider = new FakeProvider()
		const service = createTelemetryService(provider)

		service.captureGrpcResponseSize(5000, "cline.StateService", "subscribeToState", "req-42")

		assert.strictEqual(provider.histograms.length, 1)
		const entry = provider.histograms[0]
		assert.strictEqual(entry.attributes.request_id, "req-42")
	})

	it("captureGrpcResponseSize includes standard metadata attributes", () => {
		const provider = new FakeProvider()
		const service = createTelemetryService(provider)

		service.captureGrpcResponseSize(1000, "cline.StateService", "subscribeToState")

		const entry = provider.histograms[0]
		assert.strictEqual(entry.attributes.extension_version, "test")
		assert.strictEqual(entry.attributes.platform, "test-platform")
	})
})
