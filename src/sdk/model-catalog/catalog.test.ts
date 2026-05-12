import type { ModelInfo } from "@shared/api"
import { describe, expect, it } from "vitest"
import { _testing } from "./catalog"
import type { Fingerprint, ProviderModelsResult } from "./contracts"
import { parseProviderId } from "./provider-id"

const modelInfo: ModelInfo = {
	supportsPromptCache: false,
}

function fingerprint(value: string): Fingerprint {
	return `config:v1:${value.padEnd(64, "0")}` as Fingerprint
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

describe("ProviderCatalog Phase 3.1 cache", () => {
	it("returns cache hit only when provider and fingerprint both match", () => {
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

	it("does not collide for different fingerprints", () => {
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

	it("returns undefined and removes expired records", () => {
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
