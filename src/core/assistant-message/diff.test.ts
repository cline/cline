import { constructNewFileContent } from "./diff"

test("constructNewFileContent with no trailing newline in replacement", async () => {
	console.log("Running test: constructNewFileContent with no trailing newline in replacement")
	const originalContent = `line1
line2
line3`

	const diffContent = `<<<<<<< SEARCH
line2
=======
replacement
>>>>>>> REPLACE`

	const isFinal = true

	const expectedContent = `line1
replacement
line3`

	console.log("Original Content:", originalContent)
	console.log("Diff Content:", diffContent)
	console.log("Expected Content:", expectedContent)

	const result = await constructNewFileContent(diffContent, originalContent, isFinal)

	console.log("Actual Content:", result)
	expect(result).toBe(expectedContent)
})

test("constructNewFileContent with trailing newline in replacement", async () => {
	console.log("Running test: constructNewFileContent with trailing newline in replacement")
	const originalContent = `line1
line2
line3`

	const diffContent = `<<<<<<< SEARCH
line2
=======
replacement
>>>>>>> REPLACE`

	const isFinal = true

	const expectedContent = `line1
replacement
line3`

	console.log("Original Content:", originalContent)
	console.log("Diff Content:", diffContent)
	console.log("Expected Content:", expectedContent)

	const result = await constructNewFileContent(diffContent, originalContent, isFinal)

	console.log("Actual Content:", result)
	expect(result).toBe(expectedContent)
})

test("constructNewFileContent with multiple lines in replacement", async () => {
	console.log("Running test: constructNewFileContent with multiple lines in replacement")
	const originalContent = `line1
line2
line3`

	const diffContent = `<<<<<<< SEARCH
line2
=======
replacement1
replacement2
>>>>>>> REPLACE`

	const isFinal = true

	const expectedContent = `line1
replacement1
replacement2
line3`

	console.log("Original Content:", originalContent)
	console.log("Diff Content:", diffContent)
	console.log("Expected Content:", expectedContent)

	const result = await constructNewFileContent(diffContent, originalContent, isFinal)

	console.log("Actual Content:", result)
	expect(result).toBe(expectedContent)
})
