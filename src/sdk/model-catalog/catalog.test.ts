import type { ModelInfo } from "@shared/api"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type {
	EffectiveProviderConfig,
	Fingerprint,
	ModelSelection,
	ProviderConfigReader,
	ProviderModelsResult,
} from "./contracts"
import { computeConfigFingerprint } from "./fingerprint"
import { parseProviderId } from "./provider-id"

const mocks = vi.hoisted(() => ({
	resolveProviderConfig: vi.fn(),
}))

vi.mock("@clinebot/core", () => ({
	resolveProviderConfig: mocks.resolveProviderConfig,
}))

const modelInfo: ModelInfo = {
	supportsPromptCache: false,
}

beforeEach(() => {
	mocks.resolveProviderConfig.mockReset()
})

function fingerprint(value: string): Fingerprint {
	const providerId = parseProviderId("fingerprint-test")
	return computeConfigFingerprint(providerId, { providerId, baseUrl: `https://${value}.example.com` })
}

function record(
	providerId = parseProviderId("ollama"),
	configFingerprint = fingerprint("a"),
	modelId = "model-a",
): Extract<ProviderModelsResult, { ok: true }> {
	return {
		ok: true,
		providerId,
		configFingerprint,
		models: new Map([[modelId, modelInfo]]),
		defaultModelId: modelId,
		source: "sdk-dynamic",
		fetchedAt: 1,
	}
}

function makeReader(initialConfig: EffectiveProviderConfig, selection?: ModelSelection): ProviderConfigReader {
	let config = initialConfig
	return {
		read: vi.fn(() => config),
		readSelection: vi.fn(() => selection),
		subscribe: vi.fn(() => ({ dispose: vi.fn() })),
		setConfig(next: EffectiveProviderConfig): void {
			config = next
		},
	} as ProviderConfigReader & { setConfig(next: EffectiveProviderConfig): void }
}

function deferred<T>() {
	let resolve!: (value: T) => void
	let reject!: (reason?: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

describe("ProviderCatalog Phase 3.1 cache", () => {
	it("returns cache hit only when provider and fingerprint both match", async () => {
		const { _testing } = await import("./catalog")
		let now = 100
		const cache = _testing.createProviderModelsCache({ ttlMs: 50, now: () => now })
		const ollama = parseProviderId("ollama")
		const lmstudio = parseProviderId("lmstudio")
		const fpA = fingerprint("a")
		const fpB = fingerprint("b")
		const cached = record(ollama, fpA)

		cache.set(cached)

		expect(cache.get(ollama, fpA)).toBe(cached)
		expect(cache.get(ollama, fpB)).toBeUndefined()
		expect(cache.get(lmstudio, fpA)).toBeUndefined()
		now = 120
		expect(cache.get(ollama, fpA)).toBe(cached)
	})

	it("does not collide for different fingerprints", async () => {
		const { _testing } = await import("./catalog")
		const cache = _testing.createProviderModelsCache({ ttlMs: 50, now: () => 100 })
		const providerId = parseProviderId("ollama")
		const fpA = fingerprint("a")
		const fpB = fingerprint("b")
		const recordA = record(providerId, fpA, "model-a")
		const recordB = record(providerId, fpB, "model-b")

		cache.set(recordA)
		cache.set(recordB)

		expect(cache.get(providerId, fpA)).toBe(recordA)
		expect(cache.get(providerId, fpB)).toBe(recordB)
		expect(cache._cacheSize()).toBe(2)
	})

	it("reuses in-flight promise only when provider and fingerprint both match", async () => {
		const { _testing } = await import("./catalog")
		const cache = _testing.createProviderModelsCache({ ttlMs: 50, now: () => 100 })
		const ollama = parseProviderId("ollama")
		const lmstudio = parseProviderId("lmstudio")
		const fpA = fingerprint("a")
		const fpB = fingerprint("b")
		let loadCount = 0
		const load = async (nextRecord: ReturnType<typeof record>) => {
			loadCount++
			await Promise.resolve()
			return nextRecord
		}

		const first = cache.resolve({ providerId: ollama, fingerprint: fpA, load: () => load(record(ollama, fpA)) })
		const second = cache.resolve({ providerId: ollama, fingerprint: fpA, load: () => load(record(ollama, fpA, "other")) })
		const third = cache.resolve({ providerId: ollama, fingerprint: fpB, load: () => load(record(ollama, fpB)) })
		const fourth = cache.resolve({ providerId: lmstudio, fingerprint: fpA, load: () => load(record(lmstudio, fpA)) })

		expect(second).toBe(first)
		expect(cache._inFlightSize()).toBe(3)
		await Promise.all([first, second, third, fourth])
		expect(loadCount).toBe(3)
		expect(cache._inFlightSize()).toBe(0)
	})

	it("returns undefined and removes expired records", async () => {
		const { _testing } = await import("./catalog")
		let now = 100
		const cache = _testing.createProviderModelsCache({ ttlMs: 10, now: () => now })
		const providerId = parseProviderId("ollama")
		const fp = fingerprint("a")
		cache.set(record(providerId, fp))

		now = 109
		expect(cache.get(providerId, fp)).toBeDefined()
		now = 110
		expect(cache.get(providerId, fp)).toBeUndefined()
		expect(cache._cacheSize()).toBe(0)
	})
})

describe("ProviderCatalog Phase 3.2 resolveModels happy path", () => {
	it("resolves SDK knownModels, adapts model info, and uses SDK default when present", async () => {
		const { createProviderCatalog } = await import("./catalog")
		mocks.resolveProviderConfig.mockResolvedValue({
			modelId: "sdk-default",
			baseUrl: "https://provider.example.com",
			knownModels: {
				"sdk-default": { id: "sdk-default", name: "Default", capabilities: ["images", "prompt-cache"] },
				other: { id: "other", name: "Other" },
			},
		})
		const providerId = parseProviderId("openrouter")
		const config: EffectiveProviderConfig = { providerId, apiKey: "secret", baseUrl: "https://provider.example.com" }
		const selection: ModelSelection = { providerId, modelId: "selected", modelInfo }
		const reader = makeReader(config, selection)
		const catalog = createProviderCatalog(reader)

		const result = await catalog.resolveModels(providerId)

		expect(result.ok).toBe(true)
		if (!result.ok) throw new Error("expected success")
		expect(result.providerId).toBe(providerId)
		expect(result.configFingerprint).toBe(computeConfigFingerprint(providerId, config))
		expect(result.defaultModelId).toBe("sdk-default")
		expect(result.source).toBe("sdk-dynamic")
		expect(result.models.get("sdk-default")).toMatchObject({
			name: "Default",
			supportsImages: true,
			supportsPromptCache: true,
		})
		expect(mocks.resolveProviderConfig).toHaveBeenCalledTimes(1)
		expect(mocks.resolveProviderConfig).toHaveBeenCalledWith(
			providerId,
			expect.objectContaining({ loadLatestOnInit: true, loadPrivateOnAuth: true, failOnError: false }),
			expect.objectContaining({
				providerId,
				modelId: "selected",
				apiKey: "secret",
				baseUrl: "https://provider.example.com",
			}),
		)
	})

	it("falls back to first model when SDK default is absent", async () => {
		const { createProviderCatalog } = await import("./catalog")
		mocks.resolveProviderConfig.mockResolvedValue({
			modelId: "missing-default",
			baseUrl: "https://provider.example.com",
			knownModels: {
				first: { id: "first", name: "First" },
				second: { id: "second", name: "Second" },
			},
		})
		const providerId = parseProviderId("deepseek")
		const reader = makeReader({ providerId })
		const result = await createProviderCatalog(reader).resolveModels(providerId)

		expect(result.ok).toBe(true)
		if (!result.ok) throw new Error("expected success")
		expect(result.defaultModelId).toBe("first")
	})

	it("returns cached result without calling SDK again for the same fingerprint", async () => {
		const { createProviderCatalog } = await import("./catalog")
		mocks.resolveProviderConfig.mockResolvedValue({
			modelId: "m",
			baseUrl: "https://provider.example.com",
			knownModels: { m: { id: "m", name: "M" } },
		})
		const providerId = parseProviderId("openrouter")
		const catalog = createProviderCatalog(makeReader({ providerId, apiKey: "same" }))

		const first = await catalog.resolveModels(providerId)
		const second = await catalog.resolveModels(providerId)

		expect(first).toBe(second)
		expect(mocks.resolveProviderConfig).toHaveBeenCalledTimes(1)
	})

	it("forceRefresh bypasses cache but still uses current fingerprint", async () => {
		const { createProviderCatalog } = await import("./catalog")
		mocks.resolveProviderConfig
			.mockResolvedValueOnce({ modelId: "m1", knownModels: { m1: { id: "m1" } } })
			.mockResolvedValueOnce({ modelId: "m2", knownModels: { m2: { id: "m2" } } })
		const providerId = parseProviderId("openrouter")
		const config: EffectiveProviderConfig = { providerId, apiKey: "same" }
		const catalog = createProviderCatalog(makeReader(config))

		const first = await catalog.resolveModels(providerId)
		const second = await catalog.resolveModels(providerId, { forceRefresh: true })

		expect(first.ok && first.defaultModelId).toBe("m1")
		expect(second.ok && second.defaultModelId).toBe("m2")
		expect(mocks.resolveProviderConfig).toHaveBeenCalledTimes(2)
	})

	it("concurrent calls with the same provider and fingerprint share one SDK call", async () => {
		const { createProviderCatalog } = await import("./catalog")
		const pending = deferred<{ modelId: string; knownModels: Record<string, unknown> }>()
		mocks.resolveProviderConfig.mockReturnValue(pending.promise)
		const providerId = parseProviderId("openrouter")
		const catalog = createProviderCatalog(makeReader({ providerId, apiKey: "same" }))

		const first = catalog.resolveModels(providerId)
		const second = catalog.resolveModels(providerId)
		expect(mocks.resolveProviderConfig).toHaveBeenCalledTimes(1)
		pending.resolve({ modelId: "m", knownModels: { m: { id: "m" } } })

		expect(await second).toBe(await first)
	})

	it("concurrent calls with different fingerprints make separate SDK calls", async () => {
		const { createProviderCatalog } = await import("./catalog")
		const firstPending = deferred<{ modelId: string; knownModels: Record<string, unknown> }>()
		const secondPending = deferred<{ modelId: string; knownModels: Record<string, unknown> }>()
		mocks.resolveProviderConfig.mockReturnValueOnce(firstPending.promise).mockReturnValueOnce(secondPending.promise)
		const providerId = parseProviderId("openrouter")
		const reader = makeReader({ providerId, apiKey: "a" }) as ProviderConfigReader & {
			setConfig(next: EffectiveProviderConfig): void
		}
		const catalog = createProviderCatalog(reader)

		const first = catalog.resolveModels(providerId)
		reader.setConfig({ providerId, apiKey: "b" })
		const second = catalog.resolveModels(providerId)

		expect(mocks.resolveProviderConfig).toHaveBeenCalledTimes(2)
		firstPending.resolve({ modelId: "a", knownModels: { a: { id: "a" } } })
		secondPending.resolve({ modelId: "b", knownModels: { b: { id: "b" } } })
		const firstResult = await first
		const secondResult = await second
		expect(firstResult.ok).toBe(true)
		expect(secondResult.ok).toBe(true)
		if (!firstResult.ok || !secondResult.ok) throw new Error("expected success")
		expect(firstResult.defaultModelId).toBe("a")
		expect(secondResult.defaultModelId).toBe("b")
	})

	it("throws before caching if loaded record does not match requested key", async () => {
		const { _testing } = await import("./catalog")
		const providerId = parseProviderId("openrouter")
		const otherProviderId = parseProviderId("deepseek")
		const fp = fingerprint("a")
		expect(() => _testing.assertRecordMatchesRequest(record(otherProviderId, fp), providerId, fp)).toThrow(
			/cache invariant failed/,
		)
	})
})
