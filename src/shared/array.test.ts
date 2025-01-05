import { describe, it, expect } from "vitest"
import { findLastIndex, findLast } from "./array"

describe("Array Utilities", () => {
	describe("findLastIndex", () => {
		it("should return the index of the last element where predicate is true", () => {
			const array = [1, 2, 3, 4, 5]
			const predicate = (value: number) => value % 2 === 0
			expect(findLastIndex(array, predicate)).toBe(3)
		})

		it("should return -1 if no element satisfies the predicate", () => {
			const array = [1, 3, 5, 7, 9]
			const predicate = (value: number) => value % 2 === 0
			expect(findLastIndex(array, predicate)).toBe(-1)
		})

		it("should return the last index if all elements satisfy the predicate", () => {
			const array = [2, 4, 6, 8, 10]
			const predicate = (value: number) => value % 2 === 0
			expect(findLastIndex(array, predicate)).toBe(4)
		})
	})

	describe("findLast", () => {
		it("should return the last element where predicate is true", () => {
			const array = [1, 2, 3, 4, 5]
			const predicate = (value: number) => value % 2 === 0
			expect(findLast(array, predicate)).toBe(4)
		})

		it("should return undefined if no element satisfies the predicate", () => {
			const array = [1, 3, 5, 7, 9]
			const predicate = (value: number) => value % 2 === 0
			expect(findLast(array, predicate)).toBeUndefined()
		})

		it("should return the last element if all elements satisfy the predicate", () => {
			const array = [2, 4, 6, 8, 10]
			const predicate = (value: number) => value % 2 === 0
			expect(findLast(array, predicate)).toBe(10)
		})
	})
})
