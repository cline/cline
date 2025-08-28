import { expect } from "chai"
import { describe, it } from "mocha"
import { constructNewFileContent as cnfc } from "./diff"

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
			name: "malformed search - mixed symbols",
			original: "line1\nline2\nline3",
			diff: `<<-- SEARCH
line2
=======
replaced
+++++++ REPLACE`,
			shouldThrow: true,
		},
		{
			name: "malformed search - insufficient dashes",
			original: "line1\nline2\nline3",
			diff: `-- SEARCH
line2
=======
replaced
+++++++ REPLACE`,
			shouldThrow: true,
		},
		{
			name: "malformed search - missing space",
			original: "line1\nline2\nline3",
			diff: `-------SEARCH
line2
=======
replaced
+++++++ REPLACE`,
			shouldThrow: true,
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
		{
			name: "malformed diff - missing separator",
			original: "line1\nline2\nline3",
			diff: `------- SEARCH
line2
+++++++ REPLACE
replaced`,
			shouldThrow: true,
		},
		{
			name: "malformed diff - trailing space on separator",
			original: "line1\nline2\nline3",
			diff: `------- SEARCH
line2
======= 
replaced
+++++++ REPLACE`,
			shouldThrow: true,
		},
		{
			name: "malformed diff - double replace markers",
			original: "line1\nline2\nline3",
			diff: `------- SEARCH
line2
+++++++ REPLACE
first replacement
+++++++ REPLACE`,
			shouldThrow: true,
		},
		{
			name: "malformed diff - malformed separator with dashes",
			original: "line1\nline2\nline3",
			diff: `------- SEARCH
line2
------- =======
replaced
+++++++ REPLACE`,
			shouldThrow: true,
		},
	]
	//.filter(({name}) => name === "multiple ordered replacements")
	//.filter(({name}) => name === "delete then replace")
	testCases.forEach(({ name, original, diff, expected, isFinal, shouldThrow }) => {
		it(`should handle ${name} case correctly`, async () => {
			if (shouldThrow) {
				try {
					await cnfc(diff, original, isFinal ?? true)
					expect.fail("Expected an error to be thrown")
				} catch (err) {
					expect(err).to.be.an("error")
				}

				try {
					await cnfc2(diff, original, isFinal ?? true)
					expect.fail("Expected an error to be thrown")
				} catch (err) {
					expect(err).to.be.an("error")
				}
			} else {
				const result1 = await cnfc(diff, original, isFinal ?? true)
				const result2 = await cnfc2(diff, original, isFinal ?? true)
				const _equal = result1 === result2
				const _equal2 = result1 === expected
				// Verify both implementations produce same result
				expect(result1).to.equal(result2)

				// Verify result matches expected
				expect(result1).to.equal(expected)
			}
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

	it("should handle missing final REPLACE marker when isFinal is true", async () => {
		const original = "line1\nline2\nline3"
		const diff = `------- SEARCH
line2
=======
replaced`
		// Note: missing +++++++ REPLACE marker

		const result1 = await cnfc(diff, original, true) // isFinal = true

		// Should still work and replace line2 with "replaced"
		const expected = "line1\nreplaced\nline3"

		expect(result1).to.equal(expected)
	})

	it("should handle missing final REPLACE marker with multiple lines of replacement", async () => {
		const original = "function test() {\n\tconst a = 1;\n\treturn a;\n}"
		const diff = `------- SEARCH
	const a = 1;
	return a;
=======
	const a = 42;
	console.log('updated');
	return a;`
		// Note: missing +++++++ REPLACE marker

		const result1 = await cnfc(diff, original, true) // isFinal = true
		const expected = "function test() {\n\tconst a = 42;\n\tconsole.log('updated');\n\treturn a;\n}"

		expect(result1).to.equal(expected)
	})

	// 	it("should NOT process incomplete replacement when isFinal is false", async () => {
	// 		const original = "line1\nline2\nline3"
	// 		const diff = `------- SEARCH
	// line2
	// =======
	// replaced`
	// 		// Note: missing +++++++ REPLACE marker AND isFinal = false

	// 		const result1 = await cnfc(diff, original, false) // isFinal = false

	// 		// Should not make any changes since the block is incomplete
	// 		const expected = "line1\nline2\nline3"

	// 		expect(result1).to.equal(expected)
	// 	})
})

// Test cases for out-of-order search/replace blocks

describe("Diff Format Out of Order Cases", () => {
	it("should handle out-of-order replacements with different positions", async () => {
		const isFinal = true
		const original = "first\nsecond\nthird\nfourth\n"
		const diff = `------- SEARCH
fourth
=======
new fourth
+++++++ REPLACE
------- SEARCH
second
=======
new second
+++++++ REPLACE`
		const result1 = await cnfc(diff, original, isFinal)
		const expectedResult = "first\nnew second\nthird\nnew fourth\n"
		expect(result1).to.equal(expectedResult)
	})

	it("should handle multiple out-of-order replacements", async () => {
		const isFinal = true
		const original = "one\ntwo\nthree\nfour\nfive\n"
		const diff = `------- SEARCH
four
=======
fourth
+++++++ REPLACE
------- SEARCH
two
=======
second
+++++++ REPLACE
------- SEARCH
five
=======
fifth
+++++++ REPLACE`
		const result1 = await cnfc(diff, original, isFinal)
		const expectedResult = "one\nsecond\nthree\nfourth\nfifth\n"
		expect(result1).to.equal(expectedResult)
	})

	it("should handle out-of-order replacements with indentation", async () => {
		const isFinal = true
		const original = "function test() {\n\tconst a = 1;\n\tconst b = 2;\n\tconst c = 3;\n\n}"
		const diff = `------- SEARCH
	const c = 3;
=======
	const c = 30;
+++++++ REPLACE
------- SEARCH
	const a = 1;
=======
	const a = 10;
+++++++ REPLACE`
		const result1 = await cnfc(diff, original, isFinal)
		const expectedResult = "function test() {\n\tconst a = 10;\n\tconst b = 2;\n\tconst c = 30;\n\n}"
		expect(result1).to.equal(expectedResult)
	})

	it("should handle out-of-order replacements with empty lines", async () => {
		const isFinal = true
		const original = "header\n\nbody\n\nfooter\n"
		const diff = `------- SEARCH
footer
=======
new footer
+++++++ REPLACE
------- SEARCH

body

=======
new body content
+++++++ REPLACE`
		const result1 = await cnfc(diff, original, isFinal)
		const expectedResult = "header\nnew body content\nnew footer\n"
		expect(result1).to.equal(expectedResult)
	})
})
