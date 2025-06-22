import { describe, it } from "mocha"
import "should"
import { isDataValidJSON, validateThinkingBudget } from "./validation" // Assuming validateThinkingBudget is also in validation.ts

describe("isDataValidJSON", () => {
	it("should return true for valid JSON-serializable objects", () => {
		isDataValidJSON({ a: 1, b: "hello", c: [1, 2, 3] }).should.be.true()
		isDataValidJSON([{ x: true }, { y: null }]).should.be.true()
		isDataValidJSON("string").should.be.true()
		isDataValidJSON(123).should.be.true()
		isDataValidJSON(true).should.be.true()
		isDataValidJSON(null).should.be.true()
	})

	it("should return false for objects with circular references", () => {
		const obj: any = { a: 1 }
		obj.b = obj // Circular reference
		isDataValidJSON(obj).should.be.false()
	})

	it("should return false for BigInt by default (requires custom replacer)", () => {
		// JSON.stringify throws for BigInt unless a replacer is used
		isDataValidJSON({ val: BigInt(123) }).should.be.false()
	})

	it("should return true for objects containing undefined (as they are handled by JSON.stringify)", () => {
		// JSON.stringify omits object properties with undefined values
		// and converts undefined in arrays to null.
		isDataValidJSON({ a: undefined, b: 1 }).should.be.true()
		isDataValidJSON([1, undefined, 2]).should.be.true()
	})

	it("should return true for functions (as they are handled by JSON.stringify)", () => {
		// JSON.stringify converts functions to null in arrays or omits them in objects.
		isDataValidJSON({ func: () => console.log("hello") }).should.be.true()
		isDataValidJSON([() => 1, 2]).should.be.true()
	})

	it("should return true for an empty object and empty array", () => {
		isDataValidJSON({}).should.be.true()
		isDataValidJSON([]).should.be.true()
	})
})

// Basic placeholder test for validateThinkingBudget if it's in the same file
// This should be expanded based on its actual logic if testing thoroughly
describe("validateThinkingBudget", () => {
	it("should return 0 if input is 0", () => {
		validateThinkingBudget(0, 200000).should.equal(0)
	})
	it("should handle other cases of validateThinkingBudget (add more tests if needed)", () => {
		validateThinkingBudget(500, 200000).should.equal(1024) // less than min
		validateThinkingBudget(1500, 200000).should.equal(1500) // valid
		validateThinkingBudget(180000, 200000).should.equal(160000) //  Math.floor(200000 * 0.8)
	})
})
