import { detectCodeOmission } from '../detect-omission'

describe('detectCodeOmission', () => {
	const originalContent = `function example() {
  // Some code
  const x = 1;
  const y = 2;
  return x + y;
}`

	it('should detect square bracket line range omission', () => {
		const newContent = `[Previous content from line 1-305 remains exactly the same]
const z = 3;`
		expect(detectCodeOmission(originalContent, newContent)).toBe(true)
	})

	it('should detect single-line comment omission', () => {
		const newContent = `// Lines 1-50 remain unchanged
const z = 3;`
		expect(detectCodeOmission(originalContent, newContent)).toBe(true)
	})

	it('should detect multi-line comment omission', () => {
		const newContent = `/* Previous content remains the same */
const z = 3;`
		expect(detectCodeOmission(originalContent, newContent)).toBe(true)
	})

	it('should detect HTML-style comment omission', () => {
		const newContent = `<!-- Existing content unchanged -->
const z = 3;`
		expect(detectCodeOmission(originalContent, newContent)).toBe(true)
	})

	it('should detect JSX-style comment omission', () => {
		const newContent = `{/* Rest of the code remains the same */}
const z = 3;`
		expect(detectCodeOmission(originalContent, newContent)).toBe(true)
	})

	it('should detect Python-style comment omission', () => {
		const newContent = `# Previous content remains unchanged
const z = 3;`
		expect(detectCodeOmission(originalContent, newContent)).toBe(true)
	})

	it('should not detect regular comments without omission keywords', () => {
		const newContent = `// Adding new functionality
const z = 3;`
		expect(detectCodeOmission(originalContent, newContent)).toBe(false)
	})

	it('should not detect when comment is part of original content', () => {
		const originalWithComment = `// Content remains unchanged
${originalContent}`
		const newContent = `// Content remains unchanged
const z = 3;`
		expect(detectCodeOmission(originalWithComment, newContent)).toBe(false)
	})

	it('should not detect code that happens to contain omission keywords', () => {
		const newContent = `const remains = 'some value';
const unchanged = true;`
		expect(detectCodeOmission(originalContent, newContent)).toBe(false)
	})
})