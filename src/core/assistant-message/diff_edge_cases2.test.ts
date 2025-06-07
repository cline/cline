// import { constructNewFileContent as cnfc } from "./diff"
// import { describe, it } from "mocha"
// import { expect } from "chai"

// async function cnfc2(diffContent: string, originalContent: string, isFinal: boolean): Promise<string> {
// 	return cnfc(diffContent, originalContent, isFinal, "v2")
// }

// describe("Diff Format Edge Cases", () => {
// 	it("should handle missing search block", async () => {
// 		const original = "line1\nline2"
// 		const diff = `=======
// new content
// +++++++ REPLACE`
// 		const result1 = await cnfc(diff, original, true)
// 		expect(result1).to.equal("new content\n")
// 		try {
// 			await cnfc2(diff, original, true)
// 			expect.fail("Expected an error to be thrown")
// 		} catch (err) {
// 			expect(err).to.be.an("error")
// 		}
// 	})

// 	it("should handle consecutive search blocks", async () => {
// 		const original = "text"
// 		const diff = `------- SEARCH
// =======
// replaced
// +++++++ REPLACE
// ------- SEARCH
// =======
// another
// +++++++ REPLACE`
// 		const result1 = await cnfc(diff, original, true)
// 		expect(result1).to.equal("replaced\nanother\n")
// 		try {
// 			await cnfc2(diff, original, true)
// 			expect.fail("Expected an error to be thrown")
// 		} catch (err) {
// 			expect(err).to.be.an("error")
// 		}
// 	})

// 	it("should handle reverse markers order", async () => {
// 		const original = "content"
// 		const diff = `+++++++ SEARCH
// =======
// invalid
// ------- REPLACE`
// 		const result1 = await cnfc(diff, original, true)
// 		expect(result1).to.equal("invalid\ncontent")
// 		try {
// 			await cnfc2(diff, original, true)
// 			expect.fail("Expected an error to be thrown")
// 		} catch (err) {
// 			expect(err).to.be.an("error")
// 		}
// 	})

// 	it("should handle incomplete block structure", async () => {
// 		const original = "valid text"
// 		const diff = `------- SEARCH
// text
// +++++++ REPLACE`
// 		const result1 = await cnfc(diff, original, true)
// 		expect(result1).to.equal("t")
// 		try {
// 			await cnfc2(diff, original, true)
// 			expect.fail("Expected an error to be thrown")
// 		} catch (err) {
// 			expect(err).to.be.an("error")
// 		}
// 	})

// 	it("should handle empty search block", async () => {
// 		const original = "any content"
// 		const diff = `------- SEARCH
// =======
// inserted
// +++++++ REPLACE`
// 		const result1 = await cnfc(diff, original, true)
// 		const result2 = await cnfc2(diff, original, true)
// 		expect(result1).to.equal("inserted\n")
// 		expect(result1).to.equal(result2)
// 	})

// 	it("should handle mixed line endings", async () => {
// 		const original = "line1\r\nline2"
// 		const diff = `------- SEARCH
// line1\r
// =======
// line1
// +++++++ REPLACE`
// 		const result1 = await cnfc(diff, original, true)
// 		const result2 = await cnfc2(diff, original, true)
// 		expect(result1).to.equal("line1\nline2")
// 		expect(result1).to.equal(result2)
// 	})

// 	it("should handle special characters in search", async () => {
// 		const original = "text with $^.*\nend"
// 		const diff = `------- SEARCH
// $^.*
// =======
// replaced
// +++++++ REPLACE`
// 		const result1 = await cnfc(diff, original, true)
// 		const result2 = await cnfc2(diff, original, true)
// 		expect(result1).to.equal("text with replaced\nend")
// 		expect(result1).to.equal(result2)
// 	})

// 	it("should handle special regex chars and nested search markers", async () => {
// 		const original = `text with $^.*\n--- SEARCH\nend`
// 		const diff = `------- SEARCH
// $^.*
// =======
// replaced
// +++++++ REPLACE

// ------- SEARCH
// --- SEARCH
// =======
// before
// +++++++ REPLACE`
// 		const result1 = await cnfc(diff, original, true)
// 		const result2 = await cnfc2(diff, original, true)
// 		expect(result1).to.equal("text with replaced\nbefore\nend")
// 		expect(result1).to.equal(result2)
// 	})

// 	it("cnfc2 should handle invalid search marker format", async () => {
// 		const original = `text with $^.*\n--- SEARCH\nend`
// 		const diff = `--- SEARCH
// $^.*
// =======
// replaced
// +++++++ REPLACE

// ------- SEARCH
// --- SEARCH
// =======
// before
// +++++++ REPLACE`
// 		try {
// 			await cnfc(diff, original, true)
// 			expect.fail("Expected an error to be thrown")
// 		} catch (err) {
// 			expect(err).to.be.an("error")
// 		}
// 		const result2 = await cnfc2(diff, original, true)
// 		expect(result2).to.equal("text with replaced\nbefore\nend")
// 	})

// 	it("cnfc2 should throw error for incomplete search marker", async () => {
// 		const original = `text with $^.*\n--- SEARCH\nend`
// 		const diff = `--- SEARCH
// $^.*
// =======
// replaced
// +++++++ REPLACE

// ------ SEARCH
// --- SEARCH
// =======
// before
// +++++++ REPLACE`
// 		const result1 = await cnfc(diff, original, true)
// 		expect(result1).to.equal("replaced\nbefore\n")
// 		try {
// 			await cnfc2(diff, original, true)
// 			expect.fail("Expected an error to be thrown")
// 		} catch (err) {
// 			expect(err).to.be.an("error")
// 		}
// 	})

// 	it("cnfc2 should handle custom nested search markers", async () => {
// 		const original = `text with $^.*\n--- SEARCH2\nend`
// 		const diff = `--- SEARCH
// $^.*
// =======
// replaced
// +++++++ REPLACE

// ------ SEARCH
// --- SEARCH2
// =======
// before
// +++++++ REPLACE`
// 		const result1 = await cnfc(diff, original, true)
// 		const result2 = await cnfc2(diff, original, true)
// 		expect(result1).to.equal("replaced\nbefore\n")
// 		expect(result2).to.equal("text with replaced\nbefore\nend")
// 	})

// 	it("cnfc2 should handle text containing nested search markers", async () => {
// 		const original = `text with $^.*\ntext with --- SEARCH2\nend`
// 		const diff = `--- SEARCH
// $^.*
// =======
// replaced
// +++++++ REPLACE

// ------ SEARCH
// text with --- SEARCH2
// =======
// before
// +++++++ REPLACE`
// 		const result1 = await cnfc(diff, original, true)
// 		const result2 = await cnfc2(diff, original, true)
// 		expect(result1).to.equal("replaced\nbefore\n")
// 		expect(result2).to.equal("text with replaced\nbefore\nend")
// 	})

// 	it("cnfc2 should handle missing replacement marker in lenient mode", async () => {
// 		const original = `text with $^.*\ntext with --- SEARCH2\nend`
// 		const diff = `--- SEARCH
// $^.*
// =======
// replaced
// +++++++ REPLACE

// ------ SEARCH
// text with --- SEARCH2
// =======
// before`
// 		const result1 = await cnfc(diff, original, false)
// 		const result2 = await cnfc2(diff, original, false)
// 		expect(result1).to.equal("replaced\nbefore\n")
// 		expect(result2).to.equal("text with replaced\nbefore\n")
// 	})

// 	it("cnfc2 should throw error for missing replacement marker in strict mode", async () => {
// 		const original = `text with $^.*\ntext with --- SEARCH2\nend`
// 		const diff = `--- SEARCH
// $^.*
// =======
// replaced
// +++++++ REPLACE

// ------ SEARCH
// text with --- SEARCH2
// =======
// before`
// 		const result1 = await cnfc(diff, original, true)
// 		expect(result1).to.equal("replaced\nbefore\n")
// 		try {
// 			await cnfc2(diff, original, true)
// 			expect.fail("Expected an error to be thrown")
// 		} catch (err) {
// 			expect(err).to.be.an("error")
// 		}
// 	})

// 	it("cnfc2 should handle long text with multiple search-replace blocks", async () => {
// 		const original = `This is a long text with multiple sections.
// Section 1: Lorem ipsum dolor sit amet
// Section 2: consectetur adipiscing elit
// Section 3: sed do eiusmod tempor
// Section 4: incididunt ut labore
// Section 5: et dolore magna aliqua`

// 		const diff = `--- SEARCH
// Section 1: Lorem ipsum dolor sit amet
// =======
// Section 1: Replaced text
// +++++++ REPLACE

// ------- SEARCH
// Section 3: sed do eiusmod tempor
// =======
// Section 3: Modified content
// +++++++ REPLACE

// ------- SEARCH
// Section 5: et dolore magna aliqua
// =======
// Section 5: Final replacement
// +++++++ REPLACE`

// 		const expected = `This is a long text with multiple sections.
// Section 1: Replaced text
// Section 2: consectetur adipiscing elit
// Section 3: Modified content
// Section 4: incididunt ut labore
// Section 5: Final replacement
// `

// 		const result = await cnfc2(diff, original, true)
// 		expect(result).to.equal(expected)
// 	})

// 	// Test diff containing special regex characters and nested search markers
// 	const diff = `--- SEARCH
// $^.*
// =======
// replaced
// +++++++ REPLACE

// ------ SEARCH
// --- SEARCH
// =======
// before
// +++++++ REPLACE`
// 	// expected1 shows the incremental results when processing the diff line by line
// 	// Each element represents the result after processing that line number
// 	const expected1 = [
// 		"",
// 		"",
// 		"",
// 		"replaced\n",
// 		"replaced\n",
// 		"replaced\n",
// 		"replaced\n",
// 		"replaced\n",
// 		"replaced\n",
// 		"replaced\nbefore\n",
// 	]
// 	// expected2 shows the results when processing with original content
// 	// Each element represents the result after processing that line number
// 	const expected2 = [
// 		"",
// 		"",
// 		"text with ",
// 		"text with replaced\n",
// 		"text with replaced\n",
// 		"text with replaced\n",
// 		"text with replaced\n",
// 		"text with replaced\n",
// 		new Error(),
// 		new Error(),
// 	]
// 	const diffLines = diff.split("\n")
// 	for (let i = 1; i < diffLines.length; i++) {
// 		it(`cnfc2 should handle partial diff configuration (line ${i})`, async () => {
// 			const original = `text with $^.*\n--- SEARCH\nend`
// 			const result1 = await cnfc(diffLines.slice(0, i).join("\n"), original, i === diffLines.length - 1)
// 			expect(result1).to.equal(expected1[i - 1])
// 		})
// 	}

// 	for (let i = 1; i < diffLines.length; i++) {
// 		it(`cnfc2 should handle partial diff configuration (line ${i})`, async () => {
// 			const original = `text with $^.*\n--- SEARCH\nend`
// 			let expected = expected2[i - 1]
// 			if (expected instanceof Error) {
// 				try {
// 					await cnfc2(diffLines.slice(0, i).join("\n"), original, true)
// 					expect.fail("Expected an error to be thrown")
// 				} catch (err) {
// 					expect(err).to.be.an("error")
// 				}
// 			} else {
// 				const result2 = await cnfc2(diffLines.slice(0, i).join("\n"), original, i === diffLines.length - 1)
// 				expect(result2).to.equal(expected)
// 			}
// 		})
// 	}
// })
