import type { ModelInfo } from "@shared/api"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type {
	EffectiveProviderConfig,
	Fingerprint,
	ProviderConfigChange,
	ProviderConfigReader,
	ProviderModelsResult,
	ResolvedModelSelection,
} from "./contracts"
import { computeConfigFingerprint } from "./fingerprint"
import { parseProviderId } from "./provider-id"

const mocks = vi.hoisted(() => ({
	resolveProviderConfig: vi.fn(),
	listLocalProviders: vi.fn(),
	getBooleanFlagEnabled: vi.fn(() => false),
	pollFeatureFlags: vi.fn(async (): Promise<void> => undefined),
	getProviderSettings: vi.fn((): any => undefined),
}))

vi.mock("@cline/core", async (importOriginal: any) => {
	const actual = await importOriginal()
	return {
		...actual,
		resolveProviderConfig: mocks.resolveProviderConfig,
		listLocalProviders: mocks.listLocalProviders,
	}
})

vi.mock("@/services/feature-flags", () => ({
	getFeatureFlagsService: () => ({
		getBooleanFlagEnabled: mocks.getBooleanFlagEnabled,
		poll: mocks.pollFeatureFlags,
	}),
}))

vi.mock("@/services/logging/distinctId", () => ({
	setDistinctId: vi.fn(),
}))

vi.mock("../provider-migration", () => ({
	getProviderSettingsManager: () => ({
		getProviderSettings: mocks.getProviderSettings,
	}),
}))

const modelInfo: ModelInfo = {
	supportsPromptCache: false,
}

type TestReader = ProviderConfigReader & {
	setConfig(next: EffectiveProviderConfig): void
	emit(event: ProviderConfigChange): void
}

// Warm the catalog module graph once before any test runs. catalog.ts statically
// pulls in @cline/core, @cline/llms and @cline/shared, so the first test to call
// `await import("./catalog")` otherwise pays the entire (>5s on CI) import cost
// inside its own 5s test timeout and flakily fails. Importing here moves that cost
// outside any per-test clock (hooks get a generous timeout of their own).
beforeAll(async () => {
	await import("./catalog")
}, 60_000)

beforeEach(() => {
	mocks.resolveProviderConfig.mockReset()
	mocks.listLocalProviders.mockReset()
	mocks.getBooleanFlagEnabled.mockReset()
	mocks.getBooleanFlagEnabled.mockReturnValue(false)
	mocks.pollFeatureFlags.mockReset()
	mocks.pollFeatureFlags.mockResolvedValue(undefined)
	mocks.getProviderSettings.mockReset()
	mocks.getProviderSettings.mockReturnValue(undefined)
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

function makeReader(initialConfig: EffectiveProviderConfig, selection?: ResolvedModelSelection): TestReader {
	let config = initialConfig
	const listeners = new Set<(event: ProviderConfigChange) => void>()
	return {
		read: vi.fn(() => config),
		readSelection: vi.fn(() => selection),
		subscribe: vi.fn((listener: (event: ProviderConfigChange) => void) => {
			listeners.add(listener)
			return { dispose: () => listeners.delete(listener) }
		}),
		setConfig(next: EffectiveProviderConfig): void {
			config = next
		},
		emit(event: ProviderConfigChange): void {
			for (const listener of listeners) {
				listener(event)
			}
		},
	} as TestReader
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
	it("keeps lowercase nousresearch in extension results while using SDK casing at the SDK boundary", async () => {
		const { createProviderCatalog } = await import("./catalog")
		mocks.resolveProviderConfig.mockResolvedValue({
			modelId: "DeepHermes-3-Llama-3-3-70B-Preview",
			knownModels: {
				"DeepHermes-3-Llama-3-3-70B-Preview": { id: "DeepHermes-3-Llama-3-3-70B-Preview" },
			},
		})
		const providerId = parseProviderId("nousResearch")
		const result = await createProviderCatalog(makeReader({ providerId })).resolveModels(providerId)

		expect(providerId).toBe("nousresearch")
		expect(result.ok).toBe(true)
		if (!result.ok) throw new Error("expected success")
		expect(result.providerId).toBe("nousresearch")
		expect(result.defaultModelId).toBe("DeepHermes-3-Llama-3-3-70B-Preview")
		expect(mocks.resolveProviderConfig).toHaveBeenCalledWith(
			"nousResearch",
			expect.anything(),
			expect.objectContaining({ providerId: "nousResearch" }),
		)
	})

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
		const selection: ResolvedModelSelection = { providerId, modelId: "selected", modelInfo }
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

describe("ProviderCatalog Phase 3.3 error path", () => {
	it("SDK rejection produces an error arm", async () => {
		const { createProviderCatalog } = await import("./catalog")
		mocks.resolveProviderConfig.mockRejectedValue(new Error("sdk unavailable"))
		const providerId = parseProviderId("openrouter")
		const config: EffectiveProviderConfig = { providerId, apiKey: "same" }
		const result = await createProviderCatalog(makeReader(config)).resolveModels(providerId)

		expect(result.ok).toBe(false)
		if (result.ok) throw new Error("expected error")
		expect(result.providerId).toBe(providerId)
		expect(result.configFingerprint).toBe(computeConfigFingerprint(providerId, config))
		expect(result.error).toEqual({ kind: "unknown", message: "sdk unavailable" })
		expect(result.fetchedAt).toEqual(expect.any(Number))
	})

	it("shape validation failure produces a shape error arm", async () => {
		const { createProviderCatalog } = await import("./catalog")
		mocks.resolveProviderConfig.mockResolvedValue({
			modelId: "bad",
			knownModels: { bad: { name: "missing id" } },
		})
		const providerId = parseProviderId("deepseek")
		const result = await createProviderCatalog(makeReader({ providerId })).resolveModels(providerId)

		expect(result.ok).toBe(false)
		if (result.ok) throw new Error("expected error")
		expect(result.error.kind).toBe("shape")
		expect(result.error.message).toMatch(/id/i)
	})

	it("does not cache errors; same fingerprint retries after failure", async () => {
		const { createProviderCatalog } = await import("./catalog")
		mocks.resolveProviderConfig
			.mockRejectedValueOnce(new Error("transient"))
			.mockResolvedValueOnce({ modelId: "m", knownModels: { m: { id: "m", name: "M" } } })
		const providerId = parseProviderId("openrouter")
		const catalog = createProviderCatalog(makeReader({ providerId, apiKey: "same" }))

		const first = await catalog.resolveModels(providerId)
		const second = await catalog.resolveModels(providerId)

		expect(first.ok).toBe(false)
		expect(second.ok).toBe(true)
		if (!second.ok) throw new Error("expected success")
		expect(second.defaultModelId).toBe("m")
		expect(mocks.resolveProviderConfig).toHaveBeenCalledTimes(2)
	})

	it("does not cache shape errors; same fingerprint retries after malformed response", async () => {
		const { createProviderCatalog } = await import("./catalog")
		mocks.resolveProviderConfig
			.mockResolvedValueOnce({ modelId: "bad", knownModels: { bad: { name: "missing id" } } })
			.mockResolvedValueOnce({ modelId: "good", knownModels: { good: { id: "good", name: "Good" } } })
		const providerId = parseProviderId("deepseek")
		const catalog = createProviderCatalog(makeReader({ providerId }))

		const first = await catalog.resolveModels(providerId)
		const second = await catalog.resolveModels(providerId)

		expect(first.ok).toBe(false)
		expect(second.ok).toBe(true)
		if (!second.ok) throw new Error("expected success")
		expect(second.defaultModelId).toBe("good")
		expect(mocks.resolveProviderConfig).toHaveBeenCalledTimes(2)
	})
})

describe("ProviderCatalog Phase 3.4 store-driven invalidation", () => {
	it("fields change invalidates old-fingerprint cache and leaves the new fingerprint empty", async () => {
		const { createProviderCatalog } = await import("./catalog")
		mocks.resolveProviderConfig
			.mockResolvedValueOnce({ modelId: "old", knownModels: { old: { id: "old", name: "Old" } } })
			.mockResolvedValueOnce({ modelId: "new", knownModels: { new: { id: "new", name: "New" } } })
		const providerId = parseProviderId("ollama")
		const reader = makeReader({ providerId, baseUrl: "http://old.example/v1" })
		const catalog = createProviderCatalog(reader)

		const oldResult = await catalog.resolveModels(providerId)
		reader.setConfig({ providerId, baseUrl: "http://new.example/v1" })
		reader.emit({ kind: "fields", providerId, config: { providerId, baseUrl: "http://new.example/v1" } })
		const newResult = await catalog.resolveModels(providerId)

		expect(oldResult.ok && oldResult.defaultModelId).toBe("old")
		expect(newResult.ok && newResult.defaultModelId).toBe("new")
		expect(mocks.resolveProviderConfig).toHaveBeenCalledTimes(2)
	})

	it("fields change preserves cache record for the latest fingerprint", async () => {
		const { createProviderCatalog } = await import("./catalog")
		mocks.resolveProviderConfig.mockResolvedValue({ modelId: "current", knownModels: { current: { id: "current" } } })
		const providerId = parseProviderId("ollama")
		const config: EffectiveProviderConfig = { providerId, baseUrl: "http://current.example/v1" }
		const reader = makeReader(config)
		const catalog = createProviderCatalog(reader)

		const first = await catalog.resolveModels(providerId)
		reader.emit({ kind: "fields", providerId, config })
		const second = await catalog.resolveModels(providerId)

		expect(second).toBe(first)
		expect(mocks.resolveProviderConfig).toHaveBeenCalledTimes(1)
	})

	it("fields change for one provider does not invalidate another provider", async () => {
		const { createProviderCatalog } = await import("./catalog")
		mocks.resolveProviderConfig.mockResolvedValue({
			modelId: "openrouter-model",
			knownModels: { "openrouter-model": { id: "openrouter-model" } },
		})
		const openrouter = parseProviderId("openrouter")
		const ollama = parseProviderId("ollama")
		const reader = makeReader({ providerId: openrouter, apiKey: "key" })
		const catalog = createProviderCatalog(reader)

		const first = await catalog.resolveModels(openrouter)
		reader.setConfig({ providerId: openrouter, apiKey: "key" })
		reader.emit({ kind: "fields", providerId: ollama, config: { providerId: ollama, baseUrl: "http://new.example/v1" } })
		const second = await catalog.resolveModels(openrouter)

		expect(second).toBe(first)
		expect(mocks.resolveProviderConfig).toHaveBeenCalledTimes(1)
	})

	it("selection change does not invalidate model-list cache", async () => {
		const { createProviderCatalog } = await import("./catalog")
		mocks.resolveProviderConfig.mockResolvedValue({ modelId: "cached", knownModels: { cached: { id: "cached" } } })
		const providerId = parseProviderId("openrouter")
		const reader = makeReader({ providerId, apiKey: "same" })
		const catalog = createProviderCatalog(reader)
		const selection: ResolvedModelSelection = { providerId, modelId: "different", modelInfo }

		const first = await catalog.resolveModels(providerId)
		reader.emit({ kind: "selection", providerId, mode: "act", selection })
		const second = await catalog.resolveModels(providerId)

		expect(second).toBe(first)
		expect(mocks.resolveProviderConfig).toHaveBeenCalledTimes(1)
	})
})

describe("ProviderCatalog Phase 3.5 listProviders", () => {
	it("returns SDK provider listings with top-level picker metadata", async () => {
		const { createProviderCatalog } = await import("./catalog")
		mocks.listLocalProviders.mockResolvedValue({
			providers: [
				{
					id: "openrouter",
					name: "OpenRouter",
					authDescription: "OpenRouter AI platform",
					protocol: "openai-chat",
					client: "openai-compatible",
					defaultModelId: "anthropic/claude-sonnet-4.6",
					source: "system",
				},
			],
		})
		const providerId = parseProviderId("openrouter")
		const catalog = createProviderCatalog(makeReader({ providerId }))

		const listings = await catalog.listProviders()

		expect(listings).toHaveLength(1)
		expect(listings[0]).toEqual({
			id: providerId,
			name: "OpenRouter",
			defaultModelId: "anthropic/claude-sonnet-4.6",
			protocol: "openai-chat",
			authDescription: "OpenRouter AI platform",
			allowsCustomModelIds: false,
			usageCostDisplay: "show",
		})
		expect(listings[0]).not.toHaveProperty("models")
		expect(mocks.listLocalProviders).toHaveBeenCalledTimes(1)
		expect(mocks.listLocalProviders).toHaveBeenCalledWith(expect.anything(), { isClinePassEnabled: false })
	})

	it("caches provider listings per catalog instance without reading provider config", async () => {
		const { createProviderCatalog } = await import("./catalog")
		mocks.listLocalProviders.mockResolvedValue({
			providers: [
				{
					id: "ollama",
					name: "Ollama",
					authDescription: "Ollama Cloud and local LLM hosting",
					protocol: "openai-chat",
					client: "openai-compatible",
					defaultModelId: "default",
					source: "system",
				},
			],
		})
		const reader = makeReader({ providerId: parseProviderId("ollama") })
		const catalog = createProviderCatalog(reader)

		const first = await catalog.listProviders()
		const second = await catalog.listProviders()

		expect(second).toBe(first)
		expect(first[0]).toMatchObject({
			id: parseProviderId("ollama"),
			name: "Ollama",
			defaultModelId: "default",
			allowsCustomModelIds: true,
		})
		expect(mocks.listLocalProviders).toHaveBeenCalledTimes(1)
		expect(reader.read).not.toHaveBeenCalled()
		expect(reader.readSelection).not.toHaveBeenCalled()
	})

	it("refetches provider listings after explicit invalidation", async () => {
		const { createProviderCatalog } = await import("./catalog")
		mocks.listLocalProviders
			.mockResolvedValueOnce({
				providers: [{ id: "cline", name: "Cline", protocol: "anthropic", client: "anthropic", source: "system" }],
			})
			.mockResolvedValueOnce({
				providers: [
					{ id: "cline-pass", name: "ClinePass", protocol: "anthropic", client: "anthropic", source: "system" },
				],
			})
		const catalog = createProviderCatalog(makeReader({ providerId: parseProviderId("cline") }))

		const first = await catalog.listProviders()
		catalog.invalidateProviderListings()
		const second = await catalog.listProviders()

		expect(first[0]?.id).toBe("cline")
		expect(second[0]?.id).toBe("cline-pass")
		expect(mocks.listLocalProviders).toHaveBeenCalledTimes(2)
	})

	it("retries provider listing after an SDK listing failure", async () => {
		const { createProviderCatalog } = await import("./catalog")
		mocks.listLocalProviders.mockRejectedValueOnce(new Error("temporary catalog failure")).mockResolvedValueOnce({
			providers: [
				{
					id: "deepseek",
					name: "DeepSeek",
					protocol: "openai-chat",
					client: "openai-compatible",
					defaultModelId: "deepseek-v4-flash",
					source: "system",
				},
			],
		})
		const providerId = parseProviderId("deepseek")
		const catalog = createProviderCatalog(makeReader({ providerId }))

		await expect(catalog.listProviders()).rejects.toThrow("temporary catalog failure")
		await expect(catalog.listProviders()).resolves.toMatchObject([
			{
				id: providerId,
				name: "DeepSeek",
				defaultModelId: "deepseek-v4-flash",
				allowsCustomModelIds: false,
			},
		])
		expect(mocks.listLocalProviders).toHaveBeenCalledTimes(2)
	})
})

describe("ProviderCatalog Phase 3.6 subscribe", () => {
	it("fires the provider listener after resolveModels completes", async () => {
		const { createProviderCatalog } = await import("./catalog")
		mocks.resolveProviderConfig.mockResolvedValue({ modelId: "model-a", knownModels: { "model-a": { id: "model-a" } } })
		const providerId = parseProviderId("deepseek")
		const catalog = createProviderCatalog(makeReader({ providerId, apiKey: "key" }))
		const listener = vi.fn()
		catalog.subscribe(providerId, listener)

		const result = await catalog.resolveModels(providerId)

		expect(listener).toHaveBeenCalledTimes(1)
		expect(listener).toHaveBeenCalledWith({ providerId, result })
	})

	it("fires after a cache-hit resolveModels result", async () => {
		const { createProviderCatalog } = await import("./catalog")
		mocks.resolveProviderConfig.mockResolvedValue({ modelId: "cached", knownModels: { cached: { id: "cached" } } })
		const providerId = parseProviderId("openrouter")
		const catalog = createProviderCatalog(makeReader({ providerId, apiKey: "same" }))
		const listener = vi.fn()
		catalog.subscribe(providerId, listener)

		const first = await catalog.resolveModels(providerId)
		const second = await catalog.resolveModels(providerId)

		expect(second).toBe(first)
		expect(mocks.resolveProviderConfig).toHaveBeenCalledTimes(1)
		expect(listener).toHaveBeenCalledTimes(2)
		expect(listener).toHaveBeenNthCalledWith(1, { providerId, result: first })
		expect(listener).toHaveBeenNthCalledWith(2, { providerId, result: second })
	})

	it("does not fire provider listener for another provider", async () => {
		const { createProviderCatalog } = await import("./catalog")
		mocks.resolveProviderConfig.mockResolvedValue({ modelId: "model-a", knownModels: { "model-a": { id: "model-a" } } })
		const subscribedProvider = parseProviderId("deepseek")
		const resolvedProvider = parseProviderId("openrouter")
		const catalog = createProviderCatalog(makeReader({ providerId: resolvedProvider, apiKey: "key" }))
		const listener = vi.fn()
		catalog.subscribe(subscribedProvider, listener)

		await catalog.resolveModels(resolvedProvider)

		expect(listener).not.toHaveBeenCalled()
	})

	it("does not fire model-list listener when only commitSelection happens", async () => {
		const { createProviderCatalog } = await import("./catalog")
		const providerId = parseProviderId("ollama")
		const reader = makeReader({ providerId, baseUrl: "http://localhost:11434/v1" })
		const catalog = createProviderCatalog(reader)
		const listener = vi.fn()
		const selection: ResolvedModelSelection = { providerId, modelId: "custom:latest", modelInfo }
		catalog.subscribe(providerId, listener)

		reader.emit({ kind: "selection", providerId, mode: "act", selection })

		expect(listener).not.toHaveBeenCalled()
	})

	it("disposable unregisters the provider listener", async () => {
		const { createProviderCatalog } = await import("./catalog")
		mocks.resolveProviderConfig.mockResolvedValue({ modelId: "model-a", knownModels: { "model-a": { id: "model-a" } } })
		const providerId = parseProviderId("deepseek")
		const catalog = createProviderCatalog(makeReader({ providerId, apiKey: "key" }))
		const listener = vi.fn()
		const disposable = catalog.subscribe(providerId, listener)

		disposable.dispose()
		await catalog.resolveModels(providerId)

		expect(listener).not.toHaveBeenCalled()
	})
})
