// npx vitest run src/__tests__/in-chunks-of.test.ts

import { inChunksOf } from "../in-chunks-of.js"

describe("inChunksOf", () => {
	it("should return an array of arrays", () => {
		const result = inChunksOf([1, 2, 3, 4, 5])
		expect(result).toEqual([[1, 2], [3, 4], [5]])
	})

	it("should return an array of arrays with a custom chunk size", () => {
		const result = inChunksOf([1, 2, 3, 4, 5], 3)
		expect(result).toEqual([
			[1, 2, 3],
			[4, 5],
		])
	})
})
