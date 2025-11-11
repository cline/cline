import * as assert from "assert"
import type { ITelemetryProvider, TelemetryProperties, TelemetrySettings } from "../providers/ITelemetryProvider"
import { TelemetryService } from "../TelemetryService"

class FakeProvider implements ITelemetryProvider {
	public counters: Array<{ name: string; value: number; attributes: TelemetryProperties; description?: string }> = []
	public histograms: Array<{ name: string; value: number; attributes: TelemetryProperties; description?: string }> = []
	public gauges = new Map<string, Map<string, { value: number; attributes: TelemetryProperties; description?: string }>>()

	log(): void {}
	logRequired(): void {}
	identifyUser(): void {}
	setOptIn(): void {}
	isEnabled(): boolean {
		return true
	}
	getSettings(): TelemetrySettings {
		return { extensionEnabled: true, hostEnabled: true, level: "all" }
	}
	recordCounter(name: string, value: number, attributes?: TelemetryProperties, description?: string): void {
		this.counters.push({ name, value, attributes: attributes ?? {}, description })
	}
	recordHistogram(name: string, value: number, attributes?: TelemetryProperties, description?: string): void {
		this.histograms.push({ name, value, attributes: attributes ?? {}, description })
	}
	recordGauge(name: string, value: number | null, attributes?: TelemetryProperties, description?: string): void {
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
	async dispose(): Promise<void> {}
}

function createTelemetryService(provider: FakeProvider): TelemetryService {
	return new TelemetryService([provider], {
		extension_version: "test",
		platform: "test-platform",
		platform_version: "1.0.0",
		os_type: "darwin",
		os_version: "24",
		is_dev: "true",
	})
}

describe("TelemetryService metrics", () => {
	it("captureTokenUsage emits token counters and histograms", () => {
		const provider = new FakeProvider()
		const service = createTelemetryService(provider)

		service.captureTokenUsage("task-1", 120, 80, "model-a")

		assert.deepStrictEqual(
			provider.counters.map((entry) => entry.name),
			["cline.tokens.input.total", "cline.tokens.output.total"],
		)
		assert.deepStrictEqual(
			provider.histograms.map((entry) => entry.name),
			["cline.tokens.input.per_response", "cline.tokens.output.per_response"],
		)
		provider.counters.forEach((entry) => {
			assert.strictEqual(entry.attributes.ulid, "task-1")
			assert.strictEqual(entry.attributes.model, "model-a")
			assert.strictEqual(entry.attributes.extension_version, "test")
		})
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
			["cline.turns.total", "cline.cache.write.tokens.total", "cline.cache.read.tokens.total", "cline.cost.total"],
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
				"cline.turns.per_task",
				"cline.cache.write.tokens.per_event",
				"cline.cache.read.tokens.per_event",
				"cline.cost.per_event",
			],
		)
		const turnEntry = provider.histograms.find((entry) => entry.name === "cline.turns.per_task")
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
		assert.strictEqual(entry.name, "cline.errors.total")
		assert.strictEqual(entry.value, 1)
		assert.strictEqual(entry.attributes.ulid, "task-3")
		assert.strictEqual(entry.attributes.provider, "anthropic")
		assert.strictEqual(entry.attributes.model, "claude")
		assert.strictEqual(entry.attributes.error_status, 500)
		assert.strictEqual(provider.histograms.length, 1)
		const errorHistogram = provider.histograms[0]
		assert.strictEqual(errorHistogram.name, "cline.errors.per_task")
		assert.strictEqual(errorHistogram.value, 1)
		assert.strictEqual(errorHistogram.attributes.ulid, "task-3")
		assert.strictEqual(errorHistogram.attributes.provider, "anthropic")
		assert.strictEqual(errorHistogram.attributes.model, "claude")
		assert.strictEqual(errorHistogram.attributes.error_status, 500)
	})
})
