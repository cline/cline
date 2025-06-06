import { constructNewFileContent as cnfc2 } from "./diff"
import { describe, it } from "mocha"
import { expect } from "chai"

async function cnfc(diffContent: string, originalContent: string, isFinal: boolean): Promise<string> {
	return cnfc2(diffContent, originalContent, isFinal, "v1")
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
		expect(result1).to.equal("new content\n")
		expect(result2).to.equal("before\nnew content\nafter")
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
		expect(result1).to.equal("new content\n")
		expect(result2).to.equal("before\nnew content\nafter")
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
		expect(result1).to.equal("r")
		expect(result2).to.equal("before\nnew content\nafter")
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
		expect(result1).to.equal("r")
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
		expect(result1).to.equal("r")
		expect(result2).to.equal("before\nnew content\nafter")
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
		expect(result1).to.equal("r")
		expect(result2).to.equal("before\nnew content\nafter")
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
		expect(result1).to.equal("before\nfirst new content\nsecond new content\n")
		expect(result2).to.equal("before\nfirst new content\nafter\nsecond new content\nend")
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
		expect(result1).to.equal("before\nfirst new content\nd")
		expect(result2).to.equal("before\nfirst new content\nafter\nsecond new content\nend")
	})
})
