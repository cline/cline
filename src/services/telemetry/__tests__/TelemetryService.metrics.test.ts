import { ApiFormat } from "@shared/proto/cline/models"
import * as assert from "assert"
import type { ITelemetryProvider, TelemetryProperties, TelemetrySettings } from "../providers/ITelemetryProvider"
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

function createTelemetryService(provider: FakeProvider): TelemetryService {
	return new TelemetryService([provider], {
		extension_version: "test",
		cline_type: "cline-unit-tests",
		platform: "test-platform",
		platform_version: "1.0.0",
		os_type: "darwin",
		os_version: "24",
		is_dev: "true",
	} as TelemetryMetadata)
}

describe("TelemetryService metrics", () => {
	it("captureTokenUsage emits token counters and histograms", () => {
		const provider = new FakeProvider()
		const service = createTelemetryService(provider)

		service.captureTokenUsage("task-1", 120, 80, "anthropic", "model-a")

		assert.deepStrictEqual(
			provider.counters.map((entry) => entry.name),
			[TelemetryService.METRICS.TASK.TOKENS_INPUT_TOTAL, TelemetryService.METRICS.TASK.TOKENS_OUTPUT_TOTAL],
		)
		assert.deepStrictEqual(
			provider.histograms.map((entry) => entry.name),
			[TelemetryService.METRICS.TASK.TOKENS_INPUT_PER_RESPONSE, TelemetryService.METRICS.TASK.TOKENS_OUTPUT_PER_RESPONSE],
		)
		;[...provider.counters, ...provider.histograms].forEach((entry) => {
			assert.strictEqual(entry.attributes.ulid, "task-1")
			assert.strictEqual(entry.attributes.provider, "anthropic")
			assert.strictEqual(entry.attributes.model, "model-a")
			assert.strictEqual(entry.attributes.extension_version, "test")
		})
	})

	it("captureTokenUsage emits cache and cost metrics when options provided", () => {
		const provider = new FakeProvider()
		const service = createTelemetryService(provider)

		service.captureTokenUsage("task-1", 120, 80, "anthropic", "model-a", {
			cacheWriteTokens: 50,
			cacheReadTokens: 30,
			totalCost: 0.42,
		})

		assert.deepStrictEqual(
			provider.counters.map((entry) => entry.name),
			[
				TelemetryService.METRICS.TASK.TOKENS_INPUT_TOTAL,
				TelemetryService.METRICS.TASK.TOKENS_OUTPUT_TOTAL,
				TelemetryService.METRICS.CACHE.WRITE_TOTAL,
				TelemetryService.METRICS.CACHE.READ_TOTAL,
				TelemetryService.METRICS.TASK.COST_TOTAL,
			],
		)
		assert.deepStrictEqual(
			provider.histograms.map((entry) => entry.name),
			[
				TelemetryService.METRICS.TASK.TOKENS_INPUT_PER_RESPONSE,
				TelemetryService.METRICS.TASK.TOKENS_OUTPUT_PER_RESPONSE,
				TelemetryService.METRICS.CACHE.WRITE_PER_EVENT,
				TelemetryService.METRICS.CACHE.READ_PER_EVENT,
				TelemetryService.METRICS.TASK.COST_PER_EVENT,
			],
		)
		const cacheWriteCounter = provider.counters.find((entry) => entry.name === TelemetryService.METRICS.CACHE.WRITE_TOTAL)
		assert.ok(cacheWriteCounter)
		assert.strictEqual(cacheWriteCounter?.value, 50)
		assert.strictEqual(cacheWriteCounter?.attributes.ulid, "task-1")
		assert.strictEqual(cacheWriteCounter?.attributes.model, "model-a")

		const cacheReadCounter = provider.counters.find((entry) => entry.name === TelemetryService.METRICS.CACHE.READ_TOTAL)
		assert.ok(cacheReadCounter)
		assert.strictEqual(cacheReadCounter?.value, 30)

		const costCounter = provider.counters.find((entry) => entry.name === TelemetryService.METRICS.TASK.COST_TOTAL)
		assert.ok(costCounter)
		assert.strictEqual(costCounter?.value, 0.42)
		assert.strictEqual(costCounter?.attributes.ulid, "task-1")
		assert.strictEqual(costCounter?.attributes.model, "model-a")
		assert.strictEqual(costCounter?.attributes.currency, "USD")

		const cacheWriteHist = provider.histograms.find((entry) => entry.name === TelemetryService.METRICS.CACHE.WRITE_PER_EVENT)
		assert.ok(cacheWriteHist)
		assert.strictEqual(cacheWriteHist?.value, 50)

		const cacheReadHist = provider.histograms.find((entry) => entry.name === TelemetryService.METRICS.CACHE.READ_PER_EVENT)
		assert.ok(cacheReadHist)
		assert.strictEqual(cacheReadHist?.value, 30)

		const costHist = provider.histograms.find((entry) => entry.name === TelemetryService.METRICS.TASK.COST_PER_EVENT)
		assert.ok(costHist)
		assert.strictEqual(costHist?.value, 0.42)
	})

	it("captureTokenUsage skips cache/cost metrics when options fields are undefined", () => {
		const provider = new FakeProvider()
		const service = createTelemetryService(provider)

		service.captureTokenUsage("task-1", 120, 80, "anthropic", "model-a", {})

		assert.deepStrictEqual(
			provider.counters.map((entry) => entry.name),
			[TelemetryService.METRICS.TASK.TOKENS_INPUT_TOTAL, TelemetryService.METRICS.TASK.TOKENS_OUTPUT_TOTAL],
		)
		assert.deepStrictEqual(
			provider.histograms.map((entry) => entry.name),
			[TelemetryService.METRICS.TASK.TOKENS_INPUT_PER_RESPONSE, TelemetryService.METRICS.TASK.TOKENS_OUTPUT_PER_RESPONSE],
		)
	})

	it("captureTokenUsage includes options in event properties", () => {
		const provider = new FakeProvider()
		const service = createTelemetryService(provider)

		service.captureTokenUsage("task-1", 120, 80, "anthropic", "model-a", {
			cacheWriteTokens: 50,
			cacheReadTokens: 30,
			totalCost: 0.42,
		})

		const tokenEvent = provider.logs.find((entry) => entry.event === "task.tokens")
		assert.ok(tokenEvent)
		assert.strictEqual(tokenEvent?.properties?.provider, "anthropic")
		assert.strictEqual(tokenEvent?.properties?.model, "model-a")
		assert.strictEqual(tokenEvent?.properties?.cacheWriteTokens, 50)
		assert.strictEqual(tokenEvent?.properties?.cacheReadTokens, 30)
		assert.strictEqual(tokenEvent?.properties?.totalCost, 0.42)
	})

	it("captureConversationTurnEvent emits counters with cache and cost", () => {
		const provider = new FakeProvider()
		const service = createTelemetryService(provider)
		service.identifyAccount({ id: "user-1" } as any)

		service.captureConversationTurnEvent("task-2", "openai", "gpt-4", "assistant", "plan", {
			tokensIn: 150,
			tokensOut: 200,
			cacheWriteTokens: 40,
			cacheReadTokens: 20,
			totalCost: 1.23,
		})

		assert.deepStrictEqual(
			provider.counters.map((entry) => entry.name),
			[
				TelemetryService.METRICS.TASK.TURNS_TOTAL,
				TelemetryService.METRICS.CACHE.WRITE_TOTAL,
				TelemetryService.METRICS.CACHE.READ_TOTAL,
				TelemetryService.METRICS.TASK.COST_TOTAL,
			],
		)
		const costEntry = provider.counters.find((entry) => entry.name === "cline.cost.total")
		assert.ok(costEntry)
		assert.strictEqual(costEntry?.attributes.ulid, "task-2")
		assert.strictEqual(costEntry?.attributes.provider, "openai")
		assert.strictEqual(costEntry?.attributes.model, "gpt-4")
		assert.strictEqual(costEntry?.attributes.mode, "plan")
		assert.strictEqual(costEntry?.attributes.currency, "USD")
		assert.deepStrictEqual(
			provider.histograms.map((entry) => entry.name),
			[
				TelemetryService.METRICS.TASK.TURNS_PER_TASK,
				TelemetryService.METRICS.CACHE.WRITE_PER_EVENT,
				TelemetryService.METRICS.CACHE.READ_PER_EVENT,
				TelemetryService.METRICS.TASK.COST_PER_EVENT,
			],
		)
		const turnEntry = provider.histograms.find((entry) => entry.name === TelemetryService.METRICS.TASK.TURNS_PER_TASK)
		assert.ok(turnEntry)
		assert.strictEqual(turnEntry?.value, 1)
		assert.strictEqual(turnEntry?.attributes.ulid, "task-2")
		assert.strictEqual(turnEntry?.attributes.provider, "openai")
		assert.strictEqual(turnEntry?.attributes.model, "gpt-4")
		assert.strictEqual(turnEntry?.attributes.source, "assistant")
		assert.strictEqual(turnEntry?.attributes.mode, "plan")
	})

	it("captureWorkspaceInitialized emits gauge and retires previous series", () => {
		const provider = new FakeProvider()
		const service = createTelemetryService(provider)

		service.captureWorkspaceInitialized(3, ["Git"], 500)
		const initialSeries = provider.gauges.get("cline.workspace.active_roots")
		assert.ok(initialSeries)
		assert.strictEqual(initialSeries.size, 1)
		const [initialEntry] = Array.from(initialSeries.values())
		assert.strictEqual(initialEntry.value, 3)
		assert.strictEqual(initialEntry.attributes.is_multi_root, true)
		assert.strictEqual(initialEntry.attributes.extension_version, "test")

		service.captureWorkspaceInitialized(1, ["Git"], 200)
		const updatedSeries = provider.gauges.get("cline.workspace.active_roots")
		assert.ok(updatedSeries)
		assert.strictEqual(updatedSeries.size, 1)
		const [updatedEntry] = Array.from(updatedSeries.values())
		assert.strictEqual(updatedEntry.value, 1)
		assert.strictEqual(updatedEntry.attributes.is_multi_root, false)
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
		})

		assert.strictEqual(provider.counters.length, 1)
		const entry = provider.counters[0]
		assert.strictEqual(entry.name, TelemetryService.METRICS.ERRORS.TOTAL)
		assert.strictEqual(entry.value, 1)
		assert.strictEqual(entry.attributes.ulid, "task-3")
		assert.strictEqual(entry.attributes.provider, "anthropic")
		assert.strictEqual(entry.attributes.model, "claude")
		assert.strictEqual(entry.attributes.error_status, 500)
		assert.strictEqual(provider.histograms.length, 1)
		const errorHistogram = provider.histograms[0]
		assert.strictEqual(errorHistogram.name, TelemetryService.METRICS.ERRORS.PER_TASK)
		assert.strictEqual(errorHistogram.value, 1)
		assert.strictEqual(errorHistogram.attributes.ulid, "task-3")
		assert.strictEqual(errorHistogram.attributes.provider, "anthropic")
		assert.strictEqual(errorHistogram.attributes.model, "claude")
		assert.strictEqual(errorHistogram.attributes.error_status, 500)
	})

	it("captureTaskCompleted records completion payload with TTFT and duration histograms", () => {
		const provider = new FakeProvider()
		const service = createTelemetryService(provider)

		service.captureTaskCompleted("task-4", {
			provider: "openai-native",
			modelId: "gpt-5",
			apiFormat: ApiFormat.OPENAI_RESPONSES,
			timeToFirstTokenMs: 350,
			durationMs: 2100,
			mode: "act",
		})

		const completionEvent = provider.logs.find((entry) => entry.event === "task.completed")
		assert.ok(completionEvent)
		assert.ok(completionEvent?.properties)
		assert.strictEqual(completionEvent?.properties?.ulid, "task-4")
		assert.strictEqual(completionEvent?.properties?.provider, "openai-native")
		assert.strictEqual(completionEvent?.properties?.modelId, "gpt-5")
		assert.strictEqual(completionEvent?.properties?.apiFormat, ApiFormat.OPENAI_RESPONSES)
		assert.strictEqual(completionEvent?.properties?.apiFormatName, "OPENAI_RESPONSES")
		assert.strictEqual(completionEvent?.properties?.timeToFirstTokenMs, 350)
		assert.strictEqual(completionEvent?.properties?.durationMs, 2100)

		const ttftMetric = provider.histograms.find((entry) => entry.name === TelemetryService.METRICS.API.TTFT_SECONDS)
		assert.ok(ttftMetric)
		assert.strictEqual(ttftMetric?.value, 0.35)
		assert.strictEqual(ttftMetric?.attributes.ulid, "task-4")
		assert.strictEqual(ttftMetric?.attributes.provider, "openai-native")
		assert.strictEqual(ttftMetric?.attributes.model, "gpt-5")
		assert.strictEqual(ttftMetric?.attributes.apiFormat, "OPENAI_RESPONSES")

		const durationMetric = provider.histograms.find((entry) => entry.name === TelemetryService.METRICS.API.DURATION_SECONDS)
		assert.ok(durationMetric)
		assert.strictEqual(durationMetric?.value, 2.1)
		assert.strictEqual(durationMetric?.attributes.scope, "task")
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

	it("captureTaskLatencyMetrics records presentation, persistence, and chunk-to-webview histograms", () => {
		const provider = new FakeProvider()
		const service = createTelemetryService(provider)

		service.captureTaskLatencyMetrics({
			ulid: "task-latency",
			requestIndex: 2,
			isRemoteWorkspace: true,
			presentationInvocationCount: 4,
			presentationDurationMs: 120,
			presentationTrigger: "text",
			statePostCount: 3,
			statePostBuildDurationMs: 25,
			statePostSerializedBytes: 4096,
			statePostSendDurationMs: 35,
			partialMessageCount: 7,
			partialMessagePayloadBytes: 2048,
			partialMessageBroadcastDurationMs: 15,
			persistenceFlushCount: 2,
			persistenceSaveMessagesDurationMs: 40,
			persistenceSaveConversationDurationMs: 10,
			persistenceUpdateHistoryDurationMs: 20,
			chunkToWebviewMedianMs: 80,
			chunkToWebviewP95Ms: 150,
		})

		const latencyEvent = provider.logs.find((entry) => entry.event === "task.latency_metrics")
		assert.ok(latencyEvent)
		assert.strictEqual(latencyEvent?.properties?.ulid, "task-latency")
		assert.strictEqual(latencyEvent?.properties?.isRemoteWorkspace, true)

		const presentationMetric = provider.histograms.find(
			(entry) => entry.name === TelemetryService.METRICS.API.PRESENTATION_DURATION_SECONDS,
		)
		assert.ok(presentationMetric)
		assert.strictEqual(presentationMetric?.value, 0.12)

		const presentationCountMetric = provider.histograms.find(
			(entry) => entry.name === TelemetryService.METRICS.API.PRESENTATION_INVOCATIONS_PER_REQUEST,
		)
		assert.ok(presentationCountMetric)
		assert.strictEqual(presentationCountMetric?.value, 4)

		const statePostCountMetric = provider.histograms.find(
			(entry) => entry.name === TelemetryService.METRICS.API.STATE_POSTS_PER_REQUEST,
		)
		assert.ok(statePostCountMetric)
		assert.strictEqual(statePostCountMetric?.value, 3)

		const persistenceMetric = provider.histograms.find(
			(entry) => entry.name === TelemetryService.METRICS.API.PERSISTENCE_DURATION_SECONDS,
		)
		assert.ok(persistenceMetric)
		assert.strictEqual(persistenceMetric?.value, 0.07)

		const stateBuildMetric = provider.histograms.find(
			(entry) => entry.name === TelemetryService.METRICS.API.STATE_BUILD_DURATION_SECONDS,
		)
		assert.ok(stateBuildMetric)
		assert.strictEqual(stateBuildMetric?.value, 0.025)

		const statePayloadMetric = provider.histograms.find(
			(entry) => entry.name === TelemetryService.METRICS.API.STATE_PAYLOAD_BYTES,
		)
		assert.ok(statePayloadMetric)
		assert.strictEqual(statePayloadMetric?.value, 4096)

		const stateSendMetric = provider.histograms.find(
			(entry) => entry.name === TelemetryService.METRICS.API.STATE_SEND_DURATION_SECONDS,
		)
		assert.ok(stateSendMetric)
		assert.strictEqual(stateSendMetric?.value, 0.035)

		const partialMessageCountMetric = provider.histograms.find(
			(entry) => entry.name === TelemetryService.METRICS.API.PARTIAL_MESSAGES_PER_REQUEST,
		)
		assert.ok(partialMessageCountMetric)
		assert.strictEqual(partialMessageCountMetric?.value, 7)

		const partialMessagePayloadMetric = provider.histograms.find(
			(entry) => entry.name === TelemetryService.METRICS.API.PARTIAL_MESSAGE_PAYLOAD_BYTES,
		)
		assert.ok(partialMessagePayloadMetric)
		assert.strictEqual(partialMessagePayloadMetric?.value, 2048)

		const partialMessageBroadcastMetric = provider.histograms.find(
			(entry) => entry.name === TelemetryService.METRICS.API.PARTIAL_MESSAGE_BROADCAST_DURATION_SECONDS,
		)
		assert.ok(partialMessageBroadcastMetric)
		assert.strictEqual(partialMessageBroadcastMetric?.value, 0.015)

		const persistenceFlushCountMetric = provider.histograms.find(
			(entry) => entry.name === TelemetryService.METRICS.API.PERSISTENCE_FLUSHES_PER_REQUEST,
		)
		assert.ok(persistenceFlushCountMetric)
		assert.strictEqual(persistenceFlushCountMetric?.value, 2)

		const chunkMetrics = provider.histograms.filter(
			(entry) => entry.name === TelemetryService.METRICS.API.CHUNK_TO_WEBVIEW_SECONDS,
		)
		assert.strictEqual(chunkMetrics.length, 2)
		assert.deepStrictEqual(chunkMetrics.map((entry) => entry.attributes.percentile).sort(), ["p50", "p95"])
	})
})
