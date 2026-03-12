import { strict as assert } from "assert"
import { RequestBoundaryCache } from "../RequestBoundaryCache"

describe("RequestBoundaryCache", () => {
	it("reuses cached values within the TTL and refreshes after expiry", async () => {
		let now = 0
		let loads = 0
		const cache = new RequestBoundaryCache({
			load: async () => {
				loads += 1
				return `value-${loads}`
			},
			ttlMs: 50,
			getNow: () => now,
		})

		assert.equal(await cache.get(), "value-1")
		assert.equal(await cache.get(), "value-1")
		assert.equal(loads, 1)

		now = 49
		assert.equal(await cache.get(), "value-1")
		assert.equal(loads, 1)

		now = 50
		assert.equal(await cache.get(), "value-2")
		assert.equal(loads, 2)
	})

	it("shares in-flight loads across callers", async () => {
		let loads = 0
		let resolveLoad: ((value: string) => void) | undefined
		const cache = new RequestBoundaryCache({
			load: () => {
				loads += 1
				return new Promise<string>((resolve) => {
					resolveLoad = resolve
				})
			},
			ttlMs: 50,
		})

		const first = cache.get()
		const second = cache.get()
		assert.equal(loads, 1)

		resolveLoad?.("shared-value")
		assert.equal(await first, "shared-value")
		assert.equal(await second, "shared-value")
	})

	it("can be cleared manually", async () => {
		let loads = 0
		const cache = new RequestBoundaryCache({
			load: async () => {
				loads += 1
				return `value-${loads}`
			},
			ttlMs: 500,
		})

		assert.equal(await cache.get(), "value-1")
		cache.clear()
		assert.equal(await cache.get(), "value-2")
	})
})
