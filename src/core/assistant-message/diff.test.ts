import { constructNewFileContent as cnfc } from "./diff"
import { describe, it } from "mocha"
import { expect } from "chai"

async function cnfc2(diffContent: string, originalContent: string, isFinal: boolean): Promise<string> {
	return cnfc(diffContent, originalContent, isFinal, "v2")
}

describe("constructNewFileContent", () => {
	const testCases = [
		{
			name: "empty file",
			original: "",
			diff: `------- SEARCH
=======
new content
+++++++ REPLACE`,
			expected: "new content\n",
			isFinal: true,
		},
		{
			name: "full file replacement",
			original: "old content",
			diff: `------- SEARCH
=======
new content
+++++++ REPLACE`,
			expected: "new content\n",
			isFinal: true,
		},
		{
			name: "exact match replacement",
			original: "line1\nline2\nline3",
			diff: `------- SEARCH
line2
=======
replaced
+++++++ REPLACE`,
			expected: "line1\nreplaced\nline3",
			isFinal: true,
		},
		{
			name: "line-trimmed match replacement",
			original: "line1\n line2 \nline3",
			diff: `------- SEARCH
line2
=======
replaced
+++++++ REPLACE`,
			expected: "line1\nreplaced\nline3",
			isFinal: true,
		},
		{
			name: "block anchor match replacement",
			original: "line1\nstart\nmiddle\nend\nline5",
			diff: `------- SEARCH
start
middle
end
=======
replaced
+++++++ REPLACE`,
			expected: "line1\nreplaced\nline5",
			isFinal: true,
		},
		{
			name: "incremental processing",
			original: "line1\nline2\nline3",
			diff: [
				`------- SEARCH
line2
=======`,
				"replaced\n",
				"+++++++ REPLACE",
			].join("\n"),
			expected: "line1\nreplaced\n\nline3",
			isFinal: true,
		},
		{
			name: "final chunk with remaining content",
			original: "line1\nline2\nline3",
			diff: `------- SEARCH
line2
=======
replaced
+++++++ REPLACE`,
			expected: "line1\nreplaced\nline3",
			isFinal: true,
		},
		{
			name: "multiple ordered replacements",
			original: "First\nSecond\nThird\nFourth",
			diff: `------- SEARCH
First
=======
1st
+++++++ REPLACE

------- SEARCH
Third
=======
3rd
+++++++ REPLACE`,
			expected: "1st\nSecond\n3rd\nFourth",
			isFinal: true,
		},
		{
			name: "replace then delete",
			original: "line1\nline2\nline3\nline4",
			diff: `------- SEARCH
line2
=======
replaced
+++++++ REPLACE

------- SEARCH
line4
=======
+++++++ REPLACE`,
			expected: "line1\nreplaced\nline3\n",
			isFinal: true,
		},
		{
			name: "delete then replace",
			original: "line1\nline2\nline3\nline4",
			diff: `------- SEARCH
line1
=======
+++++++ REPLACE

------- SEARCH
line3
=======
replaced
+++++++ REPLACE`,
			expected: "line2\nreplaced\nline4",
			isFinal: true,
		},
	]
	//.filter(({name}) => name === "multiple ordered replacements")
	//.filter(({name}) => name === "delete then replace")
	testCases.forEach(({ name, original, diff, expected, isFinal }) => {
		it(`should handle ${name} case correctly`, async () => {
			const result1 = await cnfc(diff, original, isFinal)
			const result2 = await cnfc2(diff, original, isFinal)
			const equal = result1 === result2
			const equal2 = result1 === expected
			// Verify both implementations produce same result
			expect(result1).to.equal(result2)

			// Verify result matches expected
			expect(result1).to.equal(expected)
		})
	})

	it("should throw error when no match found", async () => {
		const original = "line1\nline2\nline3"
		const diff = `------- SEARCH
non-existent
=======
replaced
+++++++ REPLACE`

		try {
			await cnfc(diff, original, true)
			expect.fail("Expected an error to be thrown")
		} catch (err) {
			expect(err).to.be.an("error")
		}

		try {
			await cnfc2(diff, original, true)
			expect.fail("Expected an error to be thrown")
		} catch (err) {
			expect(err).to.be.an("error")
		}
	})
})

// Test cases for out-of-order search/replace blocks

describe("out-of-order search/replace blocks", () => {
	it("should handle out-of-order replacements correctly", async () => {
		const original = "First\nSecond\nThird\nFourth\nFifth"
		const diff = `------- SEARCH
  Fourth
  =======
  4th
  +++++++ REPLACE
  
  ------- SEARCH
  Second
  =======
  2nd
  +++++++ REPLACE`
		const expected = "First\n2nd\nThird\n4th\nFifth"

		const result = await cnfc(diff, original, true)
		expect(result).to.equal(expected)
	})

	it("should handle complex out-of-order replacements", async () => {
		const original = `function test() {
	const a = 1;
	const b = 2;
	const c = 3;
	const d = 4;
	return a + b + c + d;
  }`

		const diff = `------- SEARCH
	const d = 4;
  =======
	const d = 40;
  +++++++ REPLACE
  
  ------- SEARCH
	const b = 2;
  =======
	const b = 20;
  +++++++ REPLACE
  
  ------- SEARCH
	const c = 3;
  =======
	const c = 30;
  +++++++ REPLACE`

		const expected = `function test() {
	const a = 1;
	const b = 20;
	const c = 30;
	const d = 40;
	return a + b + c + d;
  }`

		const result = await cnfc(diff, original, true)
		expect(result).to.equal(expected)
	})

	it("should handle out-of-order replacements with overlapping content", async () => {
		const original = `class Example {
	constructor() {
	  this.value = 10;
	}
	
	method1() {
	  return this.value * 2;
	}
	
	method2() {
	  return this.value * 3;
	}
  }`

		const diff = `------- SEARCH
	method2() {
	  return this.value * 3;
	}
  =======
	method2() {
	  return this.value * 4;
	}
	
	method3() {
	  return this.value * 5;
	}
  +++++++ REPLACE
  
  ------- SEARCH
	constructor() {
	  this.value = 10;
	}
  =======
	constructor() {
	  this.value = 100;
	}
  +++++++ REPLACE`

		const expected = `class Example {
	constructor() {
	  this.value = 100;
	}
	
	method1() {
	  return this.value * 2;
	}
	
	method2() {
	  return this.value * 4;
	}
	
	method3() {
	  return this.value * 5;
	}
  }`

		const result = await cnfc(diff, original, true)
		expect(result).to.equal(expected)
	})

	it("should handle out-of-order replacements with deletions", async () => {
		const original = "Line1\nLine2\nLine3\nLine4\nLine5"
		const diff = `------- SEARCH
  Line4
  =======
  +++++++ REPLACE
  
  ------- SEARCH
  Line2
  =======
  Line2-Modified
  +++++++ REPLACE`

		const expected = "Line1\nLine2-Modified\nLine3\n\nLine5"

		const result = await cnfc(diff, original, true)
		expect(result).to.equal(expected)
	})

	it("should handle many out-of-order replacements", async () => {
		const original = "A\nB\nC\nD\nE\nF\nG\nH\nI\nJ"
		const diff = `------- SEARCH
  I
  =======
  I-Modified
  +++++++ REPLACE
  
  ------- SEARCH
  C
  =======
  C-Modified
  +++++++ REPLACE
  
  ------- SEARCH
  G
  =======
  G-Modified
  +++++++ REPLACE
  
  ------- SEARCH
  A
  =======
  A-Modified
  +++++++ REPLACE
  
  ------- SEARCH
  E
  =======
  E-Modified
  +++++++ REPLACE`

		const expected = "A-Modified\nB\nC-Modified\nD\nE-Modified\nF\nG-Modified\nH\nI-Modified\nJ"

		const result = await cnfc(diff, original, true)
		expect(result).to.equal(expected)
	})

	it("should correctly identify the error type for truly missing content", async () => {
		const original = "Line1\nLine2\nLine3"
		const diff = `------- SEARCH
  Line2
  =======
  Line2-Modified
  +++++++ REPLACE
  
  ------- SEARCH
  NonExistentLine
  =======
  Something
  +++++++ REPLACE`

		try {
			await cnfc(diff, original, true)
			expect.fail("Expected an error to be thrown")
		} catch (err) {
			expect(err).to.be.an("error")
			expect(err.message).to.include("does not match anything in the file")
			// The error message should no longer include "or was searched out of order"
			expect(err.message).to.not.include("out of order")
		}
	})
})
