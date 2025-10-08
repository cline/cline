import { expect } from "chai"
import { describe, it } from "mocha"
import { evaluateIdleResponseState } from "./utils"

describe("evaluateIdleResponseState", () => {
	it("resets the counter when real work was performed", () => {
		const result = evaluateIdleResponseState({
			performedRealWork: true,
			currentCount: 5,
			mode: "act",
			maxCount: 3,
		})

		expect(result).to.deep.equal({ nextCount: 0, shouldHalt: false })
	})

	it("ignores idle counts outside act mode", () => {
		const result = evaluateIdleResponseState({
			performedRealWork: false,
			currentCount: 2,
			mode: "plan",
			maxCount: 3,
		})

		expect(result).to.deep.equal({ nextCount: 0, shouldHalt: false })
	})

	it("increments and signals halt when idle limit is reached in act mode", () => {
		const penultimate = evaluateIdleResponseState({
			performedRealWork: false,
			currentCount: 1,
			mode: "act",
			maxCount: 3,
		})

		expect(penultimate).to.deep.equal({ nextCount: 2, shouldHalt: false })

		const final = evaluateIdleResponseState({
			performedRealWork: false,
			currentCount: penultimate.nextCount,
			mode: "act",
			maxCount: 3,
		})

		expect(final).to.deep.equal({ nextCount: 3, shouldHalt: true })
	})
})
