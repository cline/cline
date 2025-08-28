import { isEmpty } from "../object"

describe("isEmpty", () => {
	describe("should return true for empty values", () => {
		it.each([
			["empty object", {}],
			["empty array", []],
			["null", null],
			["undefined", undefined],
			["string", "string"],
			["number", 123],
			["boolean true", true],
			["boolean false", false],
		])("%s", (_, value) => {
			expect(isEmpty(value)).toBe(true)
		})
	})

	describe("should return false for non-empty values", () => {
		it.each([
			["object with properties", { a: 1 }],
			["object with multiple properties", { a: 1, b: 2 }],
			["array with one item", [1]],
			["array with multiple items", [1, 2, 3]],
		])("%s", (_, value) => {
			expect(isEmpty(value)).toBe(false)
		})
	})

	it("should handle objects with null prototype", () => {
		const obj = Object.create(null)
		expect(isEmpty(obj)).toBe(true)

		obj.prop = "value"
		expect(isEmpty(obj)).toBe(false)
	})
})
