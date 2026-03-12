import { strict as assert } from "assert"
import { createCachedTabQuery } from "@/hosts/vscode/hostbridge/window/tabQueryCache"

describe("tabQueryCache", () => {
	it("reuses cached values within the TTL and refreshes after expiry", async () => {
		let now = 0
		let calls = 0
		const query = createCachedTabQuery(
			async () => {
				calls += 1
				return [`value-${calls}`]
			},
			(paths) => paths,
			{
				ttlMs: 50,
				getNow: () => now,
			},
		)

		assert.deepStrictEqual(await query.read(), ["value-1"])
		assert.deepStrictEqual(await query.read(), ["value-1"])
		assert.equal(calls, 1)

		now = 49
		assert.deepStrictEqual(await query.read(), ["value-1"])
		assert.equal(calls, 1)

		now = 50
		assert.deepStrictEqual(await query.read(), ["value-2"])
		assert.equal(calls, 2)
	})

	it("can be reset manually", async () => {
		let calls = 0
		const query = createCachedTabQuery(
			async () => {
				calls += 1
				return [`value-${calls}`]
			},
			(paths) => paths,
		)

		assert.deepStrictEqual(await query.read(), ["value-1"])
		query.reset()
		assert.deepStrictEqual(await query.read(), ["value-2"])
		assert.equal(calls, 2)
	})
})
