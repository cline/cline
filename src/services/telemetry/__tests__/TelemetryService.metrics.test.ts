import * as assert from "assert"
import type { ITelemetryProvider, TelemetryProperties, TelemetrySettings } from "../providers/ITelemetryProvider"
import { TelemetryService } from "../TelemetryService"

class FakeProvider implements ITelemetryProvider {
	public counters: Array<{ name: string; value: number; attributes: TelemetryProperties }> = []
	public histograms: Array<{ name: string; value: number; attributes: TelemetryProperties }> = []
	public gauges: Array<{ name: string; value: number; attributes: TelemetryProperties }> = []

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
	recordCounter(name: string, value: number, attributes?: TelemetryProperties): void {
		this.counters.push({ name, value, attributes: attributes ?? {} })
	}
	recordHistogram(name: string, value: number, attributes?: TelemetryProperties): void {
		this.histograms.push({ name, value, attributes: attributes ?? {} })
	}
	recordGauge(name: string, value: number, attributes?: TelemetryProperties): void {
		this.gauges.push({ name, value, attributes: attributes ?? {} })
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
		service.identifyAccount({ id: "user-1", email: "user@example.com" } as any)

		service.captureConversationTurnEvent("task-2", "openai", "gpt-4", "assistant", {
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
		assert.strictEqual(costEntry?.attributes.currency, "USD")
		assert.strictEqual(costEntry?.attributes.email, "user@example.com")
	})

	it("captureWorkspaceInitialized emits gauge", () => {
		const provider = new FakeProvider()
		const service = createTelemetryService(provider)

		service.captureWorkspaceInitialized(3, ["Git"], 500)

		assert.strictEqual(provider.gauges.length, 1)
		assert.strictEqual(provider.gauges[0].name, "cline.workspace.active_roots")
		assert.strictEqual(provider.gauges[0].value, 3)
		assert.strictEqual(provider.gauges[0].attributes.is_multi_root, true)
		assert.strictEqual(provider.gauges[0].attributes.extension_version, "test")
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
	})
})
