import { expect } from "chai"
import { describe, it } from "mocha"
import { constructNewFileContent as cnfc } from "./diff"

async function cnfc2(diffContent: string, originalContent: string, isFinal: boolean): Promise<string> {
	return cnfc(diffContent, originalContent, isFinal, "v2")
}

describe("Diff Format Edge Cases", () => {
	it("should handle SEARCH prefix symbols - less than 7", async () => {
		const isFinal = true
		const original = "before\ncontent\nafter"
		const diff = `----- SEARCH
content
=======
new content
+++++++ REPLACE`
		const result1 = await cnfc(diff, original, isFinal)
		const result2 = await cnfc2(diff, original, isFinal)
		const expectedResult = "before\nnew content\nafter"
		expect(result1).to.equal(expectedResult)
		expect(result2).to.equal(expectedResult)
	})

	it("should handle SEARCH prefix symbols - more than 7", async () => {
		const isFinal = true
		const original = "before\ncontent\nafter"
		const diff = `----------- SEARCH
content
=======
new content
+++++++ REPLACE`
		const result1 = await cnfc(diff, original, isFinal)
		const result2 = await cnfc2(diff, original, isFinal)
		const expectedResult = "before\nnew content\nafter"
		expect(result1).to.equal(expectedResult)
		expect(result2).to.equal(expectedResult)
	})

	it("should handle SEARCH - less than 7 and REPLACE = less than 7", async () => {
		const isFinal = true
		const original = "before\ncontent\nafter"
		const diff = `----- SEARCH
content
=====
new content
+++++++ REPLACE`
		const result1 = await cnfc(diff, original, isFinal)
		const result2 = await cnfc2(diff, original, isFinal)
		const expectedResult = "before\nnew content\nafter"
		expect(result1).to.equal(expectedResult)
		expect(result2).to.equal(expectedResult)
	})

	it("should handle SEARCH - less than 7 and REPLACE = more than 7", async () => {
		const isFinal = true
		const original = "before\ncontent\nafter"
		const diff = `----- SEARCH
content
========
new content
+++++++ REPLACE`
		const result1 = await cnfc(diff, original, isFinal)
		const result2 = await cnfc2(diff, original, isFinal)
		expect(result1).to.equal("before\nnew content\nafter")
		expect(result2).to.equal("before\nnew content\nafter")
	})

	it("should handle SEARCH - more than 7 and REPLACE = more than 7", async () => {
		const isFinal = true
		const original = "before\ncontent\nafter"
		const diff = `----------- SEARCH
content
==========
new content
+++++++ REPLACE`
		const result1 = await cnfc(diff, original, isFinal)
		const result2 = await cnfc2(diff, original, isFinal)
		const expectedResult = "before\nnew content\nafter"
		expect(result1).to.equal(expectedResult)
		expect(result2).to.equal(expectedResult)
	})

	it("should handle SEARCH - more than 7 and REPLACE = less than 7", async () => {
		const isFinal = true
		const original = "before\ncontent\nafter"
		const diff = `----------- SEARCH
content
=====
new content
+++++++ REPLACE`
		const result1 = await cnfc(diff, original, isFinal)
		const result2 = await cnfc2(diff, original, isFinal)
		const expectedResult = "before\nnew content\nafter"
		expect(result1).to.equal(expectedResult)
		expect(result2).to.equal(expectedResult)
	})

	it("should handle consecutive SEARCH-REPLACE with second block SEARCH - less than 7", async () => {
		const isFinal = true
		const original = "before\nfirst content\nafter\nsecond content\nend"
		const diff = `------- SEARCH
first content
=======
first new content
+++++++ REPLACE
----- SEARCH
second content
=======
second new content
+++++++ REPLACE`
		const result1 = await cnfc(diff, original, isFinal)
		const result2 = await cnfc2(diff, original, isFinal)
		const expectedResult = "before\nfirst new content\nafter\nsecond new content\nend"
		expect(result1).to.equal(expectedResult)
		expect(result2).to.equal(expectedResult)
	})

	it("should handle consecutive SEARCH-REPLACE with second block SEARCH - less than 7 and REPLACE = less than 7", async () => {
		const isFinal = true
		const original = "before\nfirst content\nafter\nsecond content\nend"
		const diff = `------- SEARCH
first content
=======
first new content
+++++++ REPLACE
----- SEARCH
second content
=====
second new content
+++++++ REPLACE`
		const result1 = await cnfc(diff, original, isFinal)
		const result2 = await cnfc2(diff, original, isFinal)
		const expectedResult = "before\nfirst new content\nafter\nsecond new content\nend"
		expect(result1).to.equal(expectedResult)
		expect(result2).to.equal(expectedResult)
	})
})
