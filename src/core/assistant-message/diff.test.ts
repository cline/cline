import { constructNewFileContent as cnfc2 } from "./diff"
import { describe, it } from "mocha"
import { expect } from "chai"

async function cnfc(diffContent: string, originalContent: string, isFinal: boolean): Promise<string> {
	return cnfc2(diffContent, originalContent, isFinal, "v1")
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
