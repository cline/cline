import { describe, expect, it } from "bun:test"
import { sortTaskItemsByRecency } from "./history-order"

describe("sortTaskItemsByRecency", () => {
	it("puts the newest chat first after native and imported rows are merged", () => {
		const items = [
			{ id: "older", ts: 100 },
			{ id: "newest", ts: 300 },
			{ id: "middle", ts: 200 },
		]

		expect(sortTaskItemsByRecency(items).map((item) => item.id)).toEqual(["newest", "middle", "older"])
	})

	it("supports the explicit oldest sort", () => {
		const items = [
			{ id: "older", ts: 100 },
			{ id: "newest", ts: 300 },
		]

		expect(sortTaskItemsByRecency(items, true).map((item) => item.id)).toEqual(["older", "newest"])
	})
})
