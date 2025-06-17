import { detectCodeOmission } from "../detect-omission"

describe("detectCodeOmission", () => {
	const originalContent = `function example() {
  // Some code
  const x = 1;
  const y = 2;
  return x + y;
}`

	const generateLongContent = (commentLine: string, length: number = 90) => {
		return `${commentLine}
	${Array.from({ length }, (_, i) => `const x${i} = ${i};`).join("\n")}
	const y = 2;`
	}

	it("should skip comment checks for files under 100 lines", () => {
		const newContent = `// Lines 1-50 remain unchanged
const z = 3;`
		const predictedLineCount = 50
		expect(detectCodeOmission(originalContent, newContent, predictedLineCount)).toBe(false)
	})

	it("should not detect regular comments without omission keywords", () => {
		const newContent = generateLongContent("// Adding new functionality")
		const predictedLineCount = 150
		expect(detectCodeOmission(originalContent, newContent, predictedLineCount)).toBe(false)
	})

	it("should not detect when comment is part of original content", () => {
		const originalWithComment = `// Content remains unchanged
${originalContent}`
		const newContent = generateLongContent("// Content remains unchanged")
		const predictedLineCount = 150
		expect(detectCodeOmission(originalWithComment, newContent, predictedLineCount)).toBe(false)
	})

	it("should not detect code that happens to contain omission keywords", () => {
		const newContent = generateLongContent(`const remains = 'some value';
const unchanged = true;`)
		const predictedLineCount = 150
		expect(detectCodeOmission(originalContent, newContent, predictedLineCount)).toBe(false)
	})

	it("should detect suspicious single-line comment when content is more than 20% shorter", () => {
		const newContent = generateLongContent("// Previous content remains here\nconst x = 1;")
		const predictedLineCount = 150
		expect(detectCodeOmission(originalContent, newContent, predictedLineCount)).toBe(true)
	})

	it("should not flag suspicious single-line comment when content is less than 20% shorter", () => {
		const newContent = generateLongContent("// Previous content remains here", 130)
		const predictedLineCount = 150
		expect(detectCodeOmission(originalContent, newContent, predictedLineCount)).toBe(false)
	})

	it("should detect suspicious Python-style comment when content is more than 20% shorter", () => {
		const newContent = generateLongContent("# Previous content remains here\nconst x = 1;")
		const predictedLineCount = 150
		expect(detectCodeOmission(originalContent, newContent, predictedLineCount)).toBe(true)
	})

	it("should not flag suspicious Python-style comment when content is less than 20% shorter", () => {
		const newContent = generateLongContent("# Previous content remains here", 130)
		const predictedLineCount = 150
		expect(detectCodeOmission(originalContent, newContent, predictedLineCount)).toBe(false)
	})

	it("should detect suspicious multi-line comment when content is more than 20% shorter", () => {
		const newContent = generateLongContent("/* Previous content remains the same */\nconst x = 1;")
		const predictedLineCount = 150
		expect(detectCodeOmission(originalContent, newContent, predictedLineCount)).toBe(true)
	})

	it("should not flag suspicious multi-line comment when content is less than 20% shorter", () => {
		const newContent = generateLongContent("/* Previous content remains the same */", 130)
		const predictedLineCount = 150
		expect(detectCodeOmission(originalContent, newContent, predictedLineCount)).toBe(false)
	})

	it("should detect suspicious JSX comment when content is more than 20% shorter", () => {
		const newContent = generateLongContent("{/* Rest of the code remains the same */}\nconst x = 1;")
		const predictedLineCount = 150
		expect(detectCodeOmission(originalContent, newContent, predictedLineCount)).toBe(true)
	})

	it("should not flag suspicious JSX comment when content is less than 20% shorter", () => {
		const newContent = generateLongContent("{/* Rest of the code remains the same */}", 130)
		const predictedLineCount = 150
		expect(detectCodeOmission(originalContent, newContent, predictedLineCount)).toBe(false)
	})

	it("should detect suspicious HTML comment when content is more than 20% shorter", () => {
		const newContent = generateLongContent("<!-- Existing content unchanged -->\nconst x = 1;")
		const predictedLineCount = 150
		expect(detectCodeOmission(originalContent, newContent, predictedLineCount)).toBe(true)
	})

	it("should not flag suspicious HTML comment when content is less than 20% shorter", () => {
		const newContent = generateLongContent("<!-- Existing content unchanged -->", 130)
		const predictedLineCount = 150
		expect(detectCodeOmission(originalContent, newContent, predictedLineCount)).toBe(false)
	})

	it("should detect suspicious square bracket notation when content is more than 20% shorter", () => {
		const newContent = generateLongContent(
			"[Previous content from line 1-305 remains exactly the same]\nconst x = 1;",
		)
		const predictedLineCount = 150
		expect(detectCodeOmission(originalContent, newContent, predictedLineCount)).toBe(true)
	})

	it("should not flag suspicious square bracket notation when content is less than 20% shorter", () => {
		const newContent = generateLongContent("[Previous content from line 1-305 remains exactly the same]", 130)
		const predictedLineCount = 150
		expect(detectCodeOmission(originalContent, newContent, predictedLineCount)).toBe(false)
	})

	it("should not flag content very close to predicted length", () => {
		const newContent = generateLongContent(
			`const x = 1;
const y = 2;
// This is a legitimate comment that remains here`,
			130,
		)
		const predictedLineCount = 150
		expect(detectCodeOmission(originalContent, newContent, predictedLineCount)).toBe(false)
	})

	it("should not flag when content is longer than predicted", () => {
		const newContent = generateLongContent(
			`const x = 1;
const y = 2;
// Previous content remains here but we added more
const z = 3;
const w = 4;`,
			160,
		)
		const predictedLineCount = 150
		expect(detectCodeOmission(originalContent, newContent, predictedLineCount)).toBe(false)
	})
})
